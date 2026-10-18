import { getDatabase } from "firebase-admin/database";
import { createHash, timingSafeEqual } from "node:crypto";
import { getFirebaseApp } from "../../../lib/firebase.js";
import { parseFamPayEmail } from "../../../lib/emailParser.js";
import { searchPaymentEmails, GmailNotConnectedError } from "../../../lib/gmail.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function reply(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

// Key format: er_live_<uid>_<64 hex characters>
async function authenticate(req, db) {
  const m = (req.headers.authorization || "").match(/^Bearer (er_live_(.+)_([0-9a-f]{64}))$/);
  if (!m) return null;
  const apiKey = m[1];
  const uid = m[2];

  const record = (await db.ref(`merchantApiKeys/${uid}`).get()).val();
  if (!record || record.status !== "active" || !record.keyHash) return null;

  const given = Buffer.from(createHash("sha256").update(apiKey).digest("hex"));
  const stored = Buffer.from(String(record.keyHash));
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return uid;
}

async function subscriptionActive(db, uid) {
  if (process.env.SKIP_SUBSCRIPTION_CHECK === "true") return true; // testing only
  const sub = (await db.ref(`merchants/${uid}/subscription`).get()).val();
  return Boolean(sub && Number(sub.expiresAt) > Date.now());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { success: false, message: "Method not allowed" });
  }

  try {
    const db = getDatabase(getFirebaseApp());

    const uid = await authenticate(req, db);
    if (!uid) return reply(res, 401, { success: false, message: "Invalid API key" });

    if (!(await subscriptionActive(db, uid))) {
      return reply(res, 402, { success: false, message: "Subscription inactive. Renew to keep verifying payments." });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      return reply(res, 400, { success: false, message: "Request body must be valid JSON" });
    }

    const utr = body.utr == null ? null : String(body.utr).trim().toUpperCase();
    const transactionId = body.transaction_id == null ? null : String(body.transaction_id).trim().toUpperCase();
    const amount = body.amount == null ? null : Number(body.amount);

    if (!utr && !transactionId) {
      return reply(res, 400, { success: false, message: "Send utr or transaction_id" });
    }
    if (utr && !/^[A-Z0-9]{8,30}$/.test(utr)) {
      return reply(res, 400, { success: false, message: "utr format is invalid" });
    }
    if (transactionId && !/^[A-Z0-9]{8,40}$/.test(transactionId)) {
      return reply(res, 400, { success: false, message: "transaction_id format is invalid" });
    }
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      return reply(res, 400, { success: false, message: "amount must be a positive number" });
    }

    // Look in the merchant's own inbox
    const emails = await searchPaymentEmails(uid, { utr, transactionId });

    const now = Date.now();
    let match = null;
    let amountMismatch = false;

    for (const raw of emails) {
      const p = parseFamPayEmail(raw);
      if (!p) continue;
      if (utr && p.utr !== utr) continue;
      if (transactionId && p.transactionId !== transactionId) continue;
      if (p.date && now - new Date(p.date).getTime() > DAY_MS) continue;
      if (amount !== null && Math.abs(p.amount - amount) > 0.001) { amountMismatch = true; continue; }
      match = p;
      break;
    }

    if (!match) {
      return reply(res, 200, {
        success: true,
        received: false,
        message: amountMismatch
          ? "A payment was found but the amount does not match"
          : "No matching payment found in the last 24 hours"
      });
    }

    // Duplicate protection: only the first verification of a payment succeeds
    const paymentKey = (match.transactionId || match.utr).replace(/[.#$/\[\]]/g, "_");
    const result = await db.ref(`verifiedPayments/${uid}/${paymentKey}`).transaction((current) => {
      if (current) return undefined; // already exists: abort
      return { verifiedAt: Date.now(), amount: match.amount, utr: match.utr };
    });

    if (!result.committed) {
      return reply(res, 200, {
        success: true,
        received: false,
        already_verified: true,
        message: "Payment was already verified"
      });
    }

    return reply(res, 200, {
      success: true,
      received: true,
      amount: match.amount,
      currency: "INR",
      transaction_id: match.transactionId,
      utr: match.utr,
      sender_name: match.senderName,
      date: match.date,
      message: "Payment received successfully"
    });
  } catch (error) {
    if (error instanceof GmailNotConnectedError) {
      return reply(res, 500, { success: false, message: "Gmail is not connected for this account" });
    }
    console.error("Payment verification failed:", error.message);
    return reply(res, 500, { success: false, message: "Verification failed on our side" });
  }
}
