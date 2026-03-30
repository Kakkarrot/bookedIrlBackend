import admin from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { env } from "../config/env";

if (!admin.apps.length) {
  const privateKey = env.FIREBASE_PRIVATE_KEY_BASE64
    ? Buffer.from(env.FIREBASE_PRIVATE_KEY_BASE64, "base64").toString("utf8")
    : env.FIREBASE_PRIVATE_KEY;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey?.replace(/\\n/g, "\n") ?? ""
    })
  });
}

export type TokenVerifier = (token: string) => Promise<DecodedIdToken>;

export async function verifyFirebaseToken(token: string) {
  return admin.auth().verifyIdToken(token);
}
