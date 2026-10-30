import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../../lib/firebase.js";
import { authenticateApiKey } from "../../../lib/apiKey.js";
import { checkOrder, orderJson, subscriptionActive } from "../../../lib/orders.js";
import { searchRecentPaymentEmails, GmailNotConnectedError } from "../../../lib/gmail.js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return reply(res, 405, { success: false, message: "Method not allowed" });
  }

  try {
    const db = getDatabase(getFirebaseApp());

    const uid = await authenticateApiKey(req, db);
    if (!uid) return reply(res, 401, { success: false, message: "Invalid API key" });

    if (!(await subscriptionActive(db, uid))) {
      return reply(res, 402, { success: false, message: "Subscription inactive. Renew to keep checking orders." });
    }

    const id = String(req.query.id || "");
    if (!/^ord_[a-f0-9]{12}$/.test(id)) {
      return reply(res, 400, { success: false, message: "order id is invalid" });
    }

    const now = Date.now();
    const order = await checkOrder({
      db,
      uid,
      id,
      now,
      fetchEmails: (afterMs) => searchRecentPaymentEmails(uid, afterMs)
    });
    if (!order) return reply(res, 404, { success: false, message: "Order not found" });

    return reply(res, 200, orderJson(id, order, now));
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      return reply(res, 500, { success: false, message: "Gmail is not connected for this account" });
    }
    console.error("Order check failed:", error.message);
    return reply(res, 500, { success: false, message: "Could not check the order" });
  }
}
