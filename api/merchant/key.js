import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv
} from "node:crypto";

function getFirebaseApp() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase configuration is missing");
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n")
    }),
    databaseURL: "https://erenapi-default-rtdb.firebaseio.com"
  });
}

// Encrypts the key so it can be shown again to its owner.
// Needs KEY_ENCRYPTION_SECRET (random, 32+ characters) in Vercel env vars.
function encryptionKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("KEY_ENCRYPTION_SECRET is missing or too short");
  }
  return createHash("sha256").update(secret).digest();
}

function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
}

function decrypt(box) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(box.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64")),
    decipher.final()
  ]).toString("utf8");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const app = getFirebaseApp();

    const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Firebase login token required"
      });
    }

    const decoded = await getAuth(app).verifyIdToken(match[1]);
    const uid = decoded.uid;
    const keyRef = getDatabase(app).ref(`merchantApiKeys/${uid}`);
    const existing = (await keyRef.get()).val();

    // GET: return the merchant's current key so it stays visible after re-login
    if (req.method === "GET") {
      if (existing && existing.encryptedKey && existing.status === "active") {
        return res.status(200).json({
          success: true,
          hasKey: true,
          apiKey: decrypt(existing.encryptedKey)
        });
      }
      return res.status(200).json({
        success: true,
        hasKey: false,
        hasOldKey: Boolean(existing)
      });
    }

    // POST: create a new key (replaces the old one)
    if (existing && existing.createdAt && Date.now() - existing.createdAt < 10000) {
      return res.status(429).json({
        success: false,
        error: "Please wait a few seconds before generating another key"
      });
    }

    const apiKey = `er_live_${uid}_${randomBytes(32).toString("hex")}`;
    const keyHash = createHash("sha256").update(apiKey).digest("hex");

    await keyRef.set({
      keyHash,
      encryptedKey: encrypt(apiKey),
      createdAt: Date.now(),
      status: "active"
    });

    return res.status(201).json({
      success: true,
      message: "API key generated successfully",
      apiKey
    });
  } catch (error) {
    console.error("Merchant API key request failed:", error.message);
    return res.status(500).json({
      success: false,
      error: "Unable to process API key request"
    });
  }
}
