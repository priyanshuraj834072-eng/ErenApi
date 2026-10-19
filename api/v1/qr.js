import QRCode from "qrcode";
import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";
import { authenticateApiKey } from "../../lib/apiKey.js";

const UPI_ID = /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z]{2,64}$/;

function bad(res, message) {
  return res.status(400).json({ success: false, message });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    const { amount, note } = req.query;
    let upi = typeof req.query.upi_id === "string" ? req.query.upi_id : null;
    let name = typeof req.query.name === "string" ? req.query.name : null;
    let usedSaved = false;

    if (!upi) {
      // No upi_id sent: use the UPI ID saved in the merchant's dashboard (needs the API key)
      const db = getDatabase(getFirebaseApp());
      const uid = await authenticateApiKey(req, db);
      if (!uid) {
        return bad(res, "Send upi_id, or send your API key to use your saved UPI ID");
      }
      const saved = (await db.ref(`merchantSettings/${uid}/upi`).get()).val();
      if (!saved || !saved.id) {
        return bad(res, "No saved UPI ID. Save one in your dashboard first");
      }
      upi = saved.id;
      if (!name && saved.name) name = saved.name;
      usedSaved = true;
    }

    if (!UPI_ID.test(upi)) {
      return bad(res, "upi_id is missing or invalid");
    }

    const params = [`pa=${encodeURIComponent(upi)}`];

    if (name) {
      if (name.length > 50) return bad(res, "name is too long");
      params.push(`pn=${encodeURIComponent(name)}`);
    }

    if (amount) {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0 || value > 1000000) {
        return bad(res, "amount must be a positive number");
      }
      params.push(`am=${value.toFixed(2)}`);
    }

    params.push("cu=INR");

    if (note) {
      if (typeof note !== "string" || note.length > 50) return bad(res, "note is too long");
      params.push(`tn=${encodeURIComponent(note)}`);
    }

    const svg = await QRCode.toString(`upi://pay?${params.join("&")}`, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2
    });

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", usedSaved ? "private, no-store" : "public, max-age=3600");
    return res.status(200).send(svg);
  } catch (error) {
    console.error("QR generation failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not generate QR" });
  }
}
