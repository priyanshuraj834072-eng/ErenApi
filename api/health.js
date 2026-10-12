import { initializeApp, cert, getApps } from "firebase-admin/app";

export default async function handler(req, res) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      return res.status(500).json({
        success: false,
        error: "Firebase environment variables are missing"
      });
    }

    const existingApps = getApps();

    if (existingApps.length === 0) {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKey.replace(/\\n/g, "\n")
        }),
        databaseURL:
          "https://erenapi-default-rtdb.firebaseio.com"
      });
    }

    return res.status(200).json({
      success: true,
      service: "ErenApi",
      firebaseAdmin: "initialized"
    });

  } catch (error) {
    console.error("Firebase initialization failed");

    return res.status(500).json({
      success: false,
      error: "Firebase initialization failed"
    });
  }
}
