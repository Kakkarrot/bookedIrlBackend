import { randomUUID } from "crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { pool } from "./pool";

const allowedProviders = new Set(["google.com", "apple.com"]);

export async function getOrCreateUserId(token: DecodedIdToken) {
  const provider = token.firebase?.sign_in_provider ?? "firebase";
  if (!allowedProviders.has(provider)) {
    throw new Error("unsupported_auth_provider");
  }
  const providerUserId = token.uid;

  const identityResult = await pool.query(
    "SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId]
  );

  if (identityResult.rowCount) {
    const userId = identityResult.rows[0].user_id as string;

    if (token.email) {
      await pool.query("UPDATE users SET email = COALESCE(email, $1) WHERE id = $2", [
        token.email,
        userId
      ]);
      await pool.query(
        "UPDATE auth_identities SET email = COALESCE(email, $1) WHERE provider = $2 AND provider_user_id = $3",
        [token.email, provider, providerUserId]
      );
    }

    return userId;
  }

  const userId = randomUUID();

  await pool.query(
    "INSERT INTO users (id, display_name, username, email, onboarding_step) VALUES ($1, $2, $3, $4, $5)",
    [userId, null, null, token.email ?? null, "BIRTHDAY"]
  );

  await pool.query(
    "INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email) VALUES ($1, $2, $3, $4, $5)",
    [randomUUID(), userId, provider, providerUserId, token.email ?? null]
  );

  return userId;
}
