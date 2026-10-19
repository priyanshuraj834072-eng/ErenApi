import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";

const UPI_ID = /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z]{2,64}$/;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PUT", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const app = getFirebaseApp();

    const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ success: false, error: "Firebase login token required" });
    }

    const decoded = await getAuth(app).verifyIdToken(match[1]);
    const ref = getDatabase(app).ref(`merchantSettings/${decoded.uid}/upi`);

    if (req.method === "GET") {
      const v = (await ref.get()).val();
      return res.status(200).json({
        success: true,
        upi: v ? { id: v.id, name: v.name || null } : null
      });
    }

    if (req.method === "DELETE") {
      await ref.remove();
      return res.status(200).json({ success: true });
    }

    // PUT: save or change the UPI ID
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const id = body && body.upi_id != null ? String(body.upi_id).trim() : "";
    const name = body && body.name != null ? String(body.name).trim() : "";

    if (!UPI_ID.test(id)) {
      return res.status(400).json({ success: false, error: "UPI ID looks invalid (example: name@fam)" });
    }
    if (name.length > 50) {
      return res.status(400).json({ success: false, error: "Payee name is too long (max 50)" });
    }

    await ref.set({ id, name: name || null, updatedAt: Date.now() });
    return res.status(200).json({ success: true, upi: { id, name: name || null } });
  } catch (error) {
    console.error("UPI settings failed:", error.code || "", error.message);
    return res.status(500).json({ success: false, error: "Unable to process UPI request" });
  }
}
