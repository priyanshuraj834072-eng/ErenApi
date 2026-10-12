import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { randomBytes, createHash } from "node:crypto";

function getFirebaseApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }

  try {
    const app = getFirebaseApp();

    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer (.+)$/);

    if (!match) {
      return res.status(401).json({
        success: false,
        error: "Firebase login token required"
      });
    }

    const decoded = await getAuth(app).verifyIdToken(match[1]);
    const uid = decoded.uid;

    const secret = randomBytes(32).toString("hex");
    const apiKey = `er_live_${uid}_${secret}`;

    const keyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const db = getDatabase(app);

    await db.ref(`merchantApiKeys/${uid}`).set({
      keyHash,
      createdAt: Date.now(),
      status: "active"
    });

    return res.status(201).json({
      success: true,
      message: "API key generated successfully",
      apiKey
    });

  } catch (error) {
    console.error("Merchant API key generation failed");

    return res.status(500).json({
      success: false,
      error: "Unable to generate API key"
    });
  }
}
