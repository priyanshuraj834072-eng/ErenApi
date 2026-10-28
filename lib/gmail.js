import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "./firebase.js";
import { decrypt } from "./crypto.js";

export class GmailNotConnectedError extends Error {}

// Only emails sent from these domains are trusted as payment emails
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "famapp.in,fampay.in")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function senderAllowed(fromHeader) {
  const m = String(fromHeader || "").match(/<([^>]+)>/);
  const address = (m ? m[1] : String(fromHeader || "")).trim().toLowerCase();
  const domain = address.split("@").pop();
  return ALLOWED_SENDERS.some((d) => domain === d || domain.endsWith("." + d));
}

function header(msg, name) {
  const list = (msg.payload && msg.payload.headers) || [];
  const h = list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// Finds the readable body (text or html) inside a Gmail message
export function extractBody(payload) {
  if (!payload) return "";
  const found = [];
  (function walk(p) {
    if (p.parts) p.parts.forEach(walk);
    else if (p.body && p.body.data && /^text\/(plain|html)/.test(p.mimeType || "")) {
      found.push({ type: p.mimeType, data: p.body.data });
    }
  })(payload);
  const pick = found.find((x) => x.type.startsWith("text/plain")) || found[0];
  return pick ? Buffer.from(pick.data, "base64url").toString("utf8") : "";
}

async function accessToken(uid) {
  const node = (
    await getDatabase(getFirebaseApp()).ref(`merchantSettings/${uid}/gmail`).get()
  ).val();
  if (!node || !node.refreshToken) {
    throw new GmailNotConnectedError("Gmail is not connected for this account");
  }

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(node.refreshToken),
      grant_type: "refresh_token"
    })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (j.error === "invalid_grant") {
      throw new GmailNotConnectedError("Gmail connection expired, connect again");
    }
    throw new Error("Could not refresh Gmail access");
  }
  return j.access_token;
}

async function gmailGet(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail request failed (${r.status})`);
  return r.json();
}

// Returns the text of payment emails that contain the given UTR or transaction ID
export async function searchPaymentEmails(uid, { utr, transactionId }) {
  const token = await accessToken(uid);
  const term = transactionId || utr;
  const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

  const list = await gmailGet(
    `${base}?${new URLSearchParams({ q: `newer_than:2d "${term}"`, maxResults: "5" })}`,
    token
  );

  const bodies = [];
  for (const m of list.messages || []) {
    const msg = await gmailGet(`${base}/${m.id}?format=full`, token);
    if (!senderAllowed(header(msg, "From"))) continue;
    const body = extractBody(msg.payload);
    if (body) bodies.push(body);
  }
  return bodies;
}
