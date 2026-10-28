import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

// Both helpers use KEY_ENCRYPTION_SECRET (random, 32+ characters) from Vercel env vars.
function secret() {
  const s = process.env.KEY_ENCRYPTION_SECRET;
  if (!s || s.length < 32) throw new Error("KEY_ENCRYPTION_SECRET is missing or too short");
  return s;
}

const encKey = () => createHash("sha256").update(secret()).digest();
const stateKey = () => createHash("sha256").update(secret() + ":state").digest();

export function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
}

export function decrypt(box) {
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(box.iv, "base64"));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64")),
    decipher.final()
  ]).toString("utf8");
}

// Signed "state" for the Google login round trip, so the callback knows which merchant it is for
export function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state) {
  if (typeof state !== "string") return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", stateKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.uid || !p.exp || Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}
