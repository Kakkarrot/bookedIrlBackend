import { randomUUID } from "crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import { pool } from "./pool";

function deriveDisplayName(token: DecodedIdToken) {
  if (token.name) return token.name;
  if (token.email) return token.email.split("@")[0];
  if (token.phone_number) return token.phone_number;
  return "New user";
}

export async function getOrCreateUserId(token: DecodedIdToken) {
  const provider = token.firebase?.sign_in_provider ?? "firebase";
  const providerUserId = token.uid;

  const identityResult = await pool.query(
    "SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_user_id = $2",
    [provider, providerUserId]
  );

  if (identityResult.rowCount) {
    return identityResult.rows[0].user_id as string;
  }

  const userId = randomUUID();
  const displayName = deriveDisplayName(token);

  await pool.query(
    "INSERT INTO users (id, display_name, username, email, phone) VALUES ($1, $2, $3, $4, $5)",
    [userId, displayName, token.name ?? null, token.email ?? null, token.phone_number ?? null]
  );

  await pool.query(
    "INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email, phone) VALUES ($1, $2, $3, $4, $5, $6)",
    [randomUUID(), userId, provider, providerUserId, token.email ?? null, token.phone_number ?? null]
  );

  return userId;
}
