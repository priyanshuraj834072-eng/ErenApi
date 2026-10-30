import { randomBytes, randomInt } from "node:crypto";
import { parseFamPayEmail } from "./emailParser.js";

// After an order expires its paise amount stays reserved, so a late payment can never match a newer order
export const RESERVE_MS = 10 * 60 * 1000;
const GRACE_MS = 60 * 1000; // payment emails only show the minute
const THROTTLE_MS = 3000; // inbox is checked at most once per 3 seconds per order

export function publicStatus(order, now = Date.now()) {
  return order.status === "pending" && now > order.expiresAt ? "expired" : order.status;
}

// UPI link and QR image link for an order
export function buildLinks(origin, saved, payAmount, orderId) {
  const upi = [`pa=${encodeURIComponent(saved.id)}`];
  if (saved.name) upi.push(`pn=${encodeURIComponent(saved.name)}`);
  upi.push(`am=${payAmount.toFixed(2)}`, "cu=INR", `tn=${encodeURIComponent(orderId)}`);

  const qr = new URLSearchParams({ upi_id: saved.id, amount: payAmount.toFixed(2), note: orderId, format: "png" });
  if (saved.name) qr.set("name", saved.name);

  return { upi_link: `upi://pay?${upi.join("&")}`, qr_url: `${origin}/api/v1/qr?${qr}` };
}

// Creates an order and reserves its own paise amount (like 28.37 for 28)
export async function createOrder({ db, uid, amount, minutes, reference, now = Date.now(), rand = randomInt }) {
  const amountPaise = Math.round(amount * 100);
  const orderId = "ord_" + randomBytes(6).toString("hex");
  const expiresAt = now + minutes * 60000;
  const until = expiresAt + RESERVE_MS;

  const tried = new Set();
  let payPaise = null;
  for (let i = 0; i < 800 && tried.size < 99; i++) {
    const offset = rand(1, 100); // 1..99 paise
    if (tried.has(offset)) continue;
    tried.add(offset);
    const candidate = amountPaise + offset;
    const tx = await db.ref(`orderSlots/${uid}/${candidate}`).transaction((cur) => {
      if (cur && cur.until > now) return undefined; // taken
      return { orderId, until };
    });
    if (tx.committed) { payPaise = candidate; break; }
  }
  if (payPaise === null) return null;

  const order = {
    amount: amountPaise / 100,
    payAmount: payPaise / 100,
    status: "pending",
    createdAt: now,
    expiresAt,
    reference: reference || null,
    lastCheckedAt: 0
  };
  await db.ref(`orders/${uid}/${orderId}`).set(order);
  return { orderId, order };
}

// Looks for the payment of an order in the inbox, and updates the order
export async function checkOrder({ db, uid, id, now = Date.now(), fetchEmails }) {
  const ref = db.ref(`orders/${uid}/${id}`);
  let order = (await ref.get()).val();
  if (!order) return null;

  const until = order.expiresAt + RESERVE_MS;
  const open = order.status === "pending" || (order.status === "expired" && !order.latePayment);

  if (open && now <= until && now - (order.lastCheckedAt || 0) >= THROTTLE_MS) {
    await ref.update({ lastCheckedAt: now });
    const emails = await fetchEmails(order.createdAt - 120000);

    for (const raw of emails) {
      const p = parseFamPayEmail(raw);
      if (!p) continue;
      if (Math.abs(p.amount - order.payAmount) > 0.001) continue;

      const rec = String(raw).match(/Gmail-Received:\s*(\S+)/);
      const when = rec ? Date.parse(rec[1]) : p.date ? Date.parse(p.date) : NaN;
      if (!Number.isFinite(when) || when < order.createdAt - GRACE_MS) continue;

      const onTime = when <= order.expiresAt + GRACE_MS;
      if (!onTime && when > until) continue;

      const key = String(p.transactionId || p.utr || "").replace(/[.#$/\[\]]/g, "_");
      if (!key) continue;

      // one payment can only ever be used once
      const tx = await db.ref(`verifiedPayments/${uid}/${key}`).transaction((cur) =>
        cur
          ? undefined
          : {
              verifiedAt: now,
              amount: p.amount,
              utr: p.utr,
              transactionId: p.transactionId,
              senderName: p.senderName,
              paymentDate: p.date,
              source: onTime ? "order" : "late_order",
              orderId: id
            }
      );
      if (!tx.committed) continue;

      const info = {
        utr: p.utr,
        transactionId: p.transactionId,
        senderName: p.senderName,
        date: p.date,
        amount: p.amount
      };
      if (onTime) await ref.update({ status: "paid", paidAt: now, payment: info });
      else await ref.update({ status: "expired", latePayment: info });
      break;
    }
  }

  order = (await ref.get()).val();
  if (order.status === "pending" && now > order.expiresAt) {
    await ref.update({ status: "expired" });
    order.status = "expired";
  }
  return order;
}

// The JSON the API sends back for an order
export function orderJson(id, o, now = Date.now()) {
  const status = publicStatus(o, now);
  const out = {
    success: true,
    order_id: id,
    status,
    amount: o.amount,
    pay_amount: o.payAmount,
    currency: "INR",
    reference: o.reference || null,
    created_at: new Date(o.createdAt).toISOString(),
    expires_at: new Date(o.expiresAt).toISOString(),
    expires_in_seconds: Math.max(0, Math.round((o.expiresAt - now) / 1000))
  };
  if (status === "paid" && o.payment) {
    out.paid_at = new Date(o.paidAt).toISOString();
    out.credit_amount = o.amount;
    out.payment = {
      amount: o.payment.amount,
      transaction_id: o.payment.transactionId,
      utr: o.payment.utr,
      sender_name: o.payment.senderName,
      date: o.payment.date
    };
    out.message = "Payment received. Credit the customer.";
  } else if (status === "expired" && o.latePayment) {
    out.late_payment = {
      amount: o.latePayment.amount,
      transaction_id: o.latePayment.transactionId,
      utr: o.latePayment.utr,
      sender_name: o.latePayment.senderName,
      date: o.latePayment.date
    };
    out.message = "A payment arrived after the order expired. Do not credit it.";
  } else if (status === "expired") {
    out.message = "Order expired.";
  } else {
    out.message = "Waiting for payment.";
  }
  return out;
}

// ---------- subscription ----------
// Is the merchant's paid plan active?
export async function subscriptionActive(db, uid) {
  if (process.env.SKIP_SUBSCRIPTION_CHECK === "true") return true; // testing only
  const sub = (await db.ref(`merchants/${uid}/subscription`).get()).val();
  return Boolean(sub && Number(sub.expiresAt) > Date.now());
}

// ---------- payment totals (India time) ----------
const IST = 19800000; // India time is UTC+5:30

export const istDayStart = (ms) => Math.floor((ms + IST) / 86400000) * 86400000 - IST;

export function istMonthStart(ms) {
  const d = new Date(ms + IST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST;
}

const round2 = (n) => Math.round(n * 100) / 100;

// items: [{ amount, t }] where t is the payment time in ms
export function computeStats(items, now = Date.now()) {
  const today = istDayStart(now);
  const yesterday = today - 86400000;
  const week = today - 6 * 86400000; // today and the 6 days before it
  const month = istMonthStart(now);

  const s = {
    today: { total: 0, count: 0 },
    yesterday: { total: 0, count: 0 },
    week: { total: 0, count: 0 },
    month: { total: 0, count: 0 },
    all: { total: 0, count: 0 }
  };
  const add = (k, a) => { s[k].total += a; s[k].count += 1; };

  for (const { amount, t } of items) {
    const a = Number(amount) || 0;
    add("all", a);
    if (t >= today) add("today", a);
    else if (t >= yesterday) add("yesterday", a);
    if (t >= week) add("week", a);
    if (t >= month) add("month", a);
  }
  for (const k of Object.keys(s)) s[k].total = round2(s[k].total);
  return s;
}
