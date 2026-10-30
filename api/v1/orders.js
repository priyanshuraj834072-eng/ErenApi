import { getDatabase } from "firebase-admin/database";
import { getFirebaseApp } from "../../lib/firebase.js";
import { authenticateApiKey } from "../../lib/apiKey.js";
import { createOrder, orderJson, buildLinks, subscriptionActive } from "../../lib/orders.js";

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { success: false, message: "Method not allowed" });
  }

  try {
    const db = getDatabase(getFirebaseApp());

    const uid = await authenticateApiKey(req, db);
    if (!uid) return reply(res, 401, { success: false, message: "Invalid API key" });

    if (!(await subscriptionActive(db, uid))) {
      return reply(res, 402, { success: false, message: "Subscription inactive. Renew to keep creating orders." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      return reply(res, 400, { success: false, message: "Request body must be valid JSON" });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return reply(res, 400, { success: false, message: "amount must be a number from 1 to 100000" });
    }

    const minutes = body.expires_in_minutes == null ? 5 : Number(body.expires_in_minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) {
      return reply(res, 400, { success: false, message: "expires_in_minutes must be from 1 to 30" });
    }

    const reference = body.reference == null ? null : String(body.reference).trim().slice(0, 100) || null;

    const saved = (await db.ref(`merchantSettings/${uid}/upi`).get()).val();
    if (!saved || !saved.id) {
      return reply(res, 400, { success: false, message: "Save your UPI ID in the dashboard first" });
    }

    const made = await createOrder({ db, uid, amount, minutes, reference });
    if (!made) {
      return reply(res, 429, {
        success: false,
        message: "Too many open orders for this amount. Try again in a few minutes"
      });
    }

    const origin = `https://${req.headers.host}`;
    const out = orderJson(made.orderId, made.order);
    return reply(res, 201, { ...out, ...buildLinks(origin, saved, made.order.payAmount, made.orderId) });
  } catch (error) {
    console.error("Order creation failed:", error.message);
    return reply(res, 500, { success: false, message: "Could not create the order" });
  }
}
