import { createHash, timingSafeEqual } from "node:crypto";

// Key format: er_live_<uid>_<64 hex characters>
// Returns the merchant uid when the Bearer API key is valid, otherwise null.
export async function authenticateApiKey(req, db) {
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
