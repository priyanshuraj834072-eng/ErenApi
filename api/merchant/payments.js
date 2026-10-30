import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";
import { computeStats, publicStatus } from "../../lib/orders.js";

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
    const db = getDatabase(app);
    const now = Date.now();

    // Verified payments of this merchant only
    const snap = await db.ref(`verifiedPayments/${uid}`).get();
    const all = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      const t = Date.parse(v.paymentDate) || v.verifiedAt || 0;
      all.push({
        id: child.key,
        amount: v.amount,
        utr: v.utr || null,
        transaction_id: v.transactionId || null,
        sender_name: v.senderName || null,
        date: v.paymentDate || null,
        verified_at: v.verifiedAt || null,
        source: v.source || "api",
        t
      });
    });
    all.sort((a, b) => b.t - a.t);

    const stats = computeStats(all, now);
    const payments = all.slice(0, 50).map(({ t, ...rest }) => rest);

    // Latest orders
    const osnap = await db.ref(`orders/${uid}`).get();
    const orders = [];
    osnap.forEach((child) => {
      const o = child.val() || {};
      orders.push({
        id: child.key,
        amount: o.amount,
        pay_amount: o.payAmount,
        status: publicStatus(o, now),
        reference: o.reference || null,
        created_at: o.createdAt,
        late: Boolean(o.latePayment)
      });
    });
    orders.sort((a, b) => b.created_at - a.created_at);

    return res.status(200).json({ success: true, stats, payments, orders: orders.slice(0, 20) });
  } catch (error) {
    console.error("Payments list failed:", error.code || "", error.message);
    return res.status(500).json({ success: false, error: "Unable to load payments" });
  }
}
