import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";
import { encrypt, decrypt, signState, verifyState } from "../../lib/crypto.js";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const REDIRECT_URI =
  process.env.GMAIL_REDIRECT_URI || "https://fampayerenapi.vercel.app/api/gmail/callback";

function json(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function redirect(res, to) {
  res.setHeader("Cache-Control", "no-store");
  res.writeHead(302, { Location: to });
  return res.end();
}

async function postForm(url, data) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function merchantUid(req, app) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    return (await getAuth(app).verifyIdToken(m[1])).uid;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const action = req.query.action;

  try {
    const app = getFirebaseApp();
    const db = getDatabase(app);

    // 1. The dashboard asks for the Google permission link
    if (action === "start") {
      if (req.method !== "POST") return json(res, 405, { success: false, error: "Method not allowed" });
      const uid = await merchantUid(req, app);
      if (!uid) return json(res, 401, { success: false, error: "Login required" });
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return json(res, 500, { success: false, error: "Gmail is not configured on the server" });
      }

      const state = signState({ uid, exp: Date.now() + 10 * 60 * 1000 });
      const url =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          response_type: "code",
          scope: SCOPE,
          access_type: "offline",
          prompt: "consent",
          state
        });
      return json(res, 200, { success: true, url });
    }

    // 2. Google sends the merchant back here after they allow access
    if (action === "callback") {
      if (req.method !== "GET") return json(res, 405, { success: false, error: "Method not allowed" });
      if (req.query.error) return redirect(res, "/?gmail=denied#get-started");

      const st = verifyState(req.query.state);
      const code = req.query.code;
      if (!st || typeof code !== "string") return redirect(res, "/?gmail=error#get-started");

      const tokens = await postForm("https://oauth2.googleapis.com/token", {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code"
      });

      if (!tokens.refresh_token) return redirect(res, "/?gmail=error#get-started");
      if (!String(tokens.scope || "").includes("gmail.readonly")) {
        return redirect(res, "/?gmail=noscope#get-started");
      }

      const pr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const profile = await pr.json().catch(() => ({}));
      if (!pr.ok || !profile.emailAddress) return redirect(res, "/?gmail=error#get-started");

      await db.ref(`merchantSettings/${st.uid}/gmail`).set({
        email: profile.emailAddress,
        refreshToken: encrypt(tokens.refresh_token),
        connectedAt: Date.now()
      });
      return redirect(res, "/?gmail=connected#get-started");
    }

    // 3. Is Gmail connected? (for the dashboard)
    if (action === "status") {
      if (req.method !== "GET") return json(res, 405, { success: false, error: "Method not allowed" });
      const uid = await merchantUid(req, app);
      if (!uid) return json(res, 401, { success: false, error: "Login required" });
      const v = (await db.ref(`merchantSettings/${uid}/gmail`).get()).val();
      return json(res, 200, {
        success: true,
        connected: Boolean(v && v.refreshToken),
        email: v ? v.email : null,
        connected_at: v ? v.connectedAt : null
      });
    }

    // 4. Disconnect
    if (action === "disconnect") {
      if (req.method !== "POST") return json(res, 405, { success: false, error: "Method not allowed" });
      const uid = await merchantUid(req, app);
      if (!uid) return json(res, 401, { success: false, error: "Login required" });
      const ref = db.ref(`merchantSettings/${uid}/gmail`);
      const v = (await ref.get()).val();
      if (v && v.refreshToken) {
        try {
          await postForm("https://oauth2.googleapis.com/revoke", { token: decrypt(v.refreshToken) });
        } catch {
          // revoking is best effort; the stored token is deleted below either way
        }
      }
      await ref.remove();
      return json(res, 200, { success: true });
    }

    return json(res, 404, { success: false, error: "Not found" });
  } catch (error) {
    console.error("Gmail action failed:", action, error.message);
    if (action === "callback") return redirect(res, "/?gmail=error#get-started");
    return json(res, 500, { success: false, error: "Gmail request failed" });
  }
}
