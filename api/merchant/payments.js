import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const app = getFirebaseApp();

    const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ success: false, error: "Firebase login token required" });
    }

    const decoded = await getAuth(app).verifyIdToken(match[1]);
    const uid = decoded.uid;

    // Latest 50 verified payments of this merchant only
    const snap = await getDatabase(app)
      .ref(`verifiedPayments/${uid}`)
      .orderByChild("verifiedAt")
      .limitToLast(50)
      .get();

    const payments = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      payments.push({
        id: child.key,
        amount: v.amount,
        utr: v.utr || null,
        sender_name: v.senderName || null,
        date: v.paymentDate || null,
        verified_at: v.verifiedAt || null
      });
    });
    payments.sort((a, b) => (b.verified_at || 0) - (a.verified_at || 0));

    return res.status(200).json({ success: true, payments });
  } catch (error) {
    console.error("Payments list failed:", error.message);
    return res.status(500).json({ success: false, error: "Unable to load payments" });
  }
}
