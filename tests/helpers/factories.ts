import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

type UserFactoryInput = {
  uid?: string;
  email?: string;
  displayName?: string | null;
  username?: string | null;
  onboardingStep?: string;
};

type ServiceFactoryInput = {
  userId: string;
  title?: string;
  description?: string | null;
  priceDollars?: number;
  durationMinutes?: number;
  isActive?: boolean;
};

export async function createUserWithIdentity(pool: Pool, input: UserFactoryInput = {}) {
  const userId = randomUUID();
  const uid = input.uid ?? randomUUID();
  const email = input.email ?? `${uid}@example.com`;

  await pool.query(
    `
    INSERT INTO users (id, display_name, username, email, onboarding_step)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [
      userId,
      input.displayName ?? null,
      input.username ?? null,
      email,
      input.onboardingStep ?? "BIRTHDAY"
    ]
  );

  await pool.query(
    `
    INSERT INTO auth_identities (id, user_id, provider, provider_user_id, email)
    VALUES ($1, $2, 'google.com', $3, $4)
    `,
    [randomUUID(), userId, uid, email]
  );

  return { userId, uid, email };
}

export async function createService(pool: Pool, input: ServiceFactoryInput) {
  const serviceId = randomUUID();

  await pool.query(
    `
    INSERT INTO services (id, user_id, title, description, price_dollars, duration_minutes, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      serviceId,
      input.userId,
      input.title ?? "Test Service",
      input.description ?? null,
      input.priceDollars ?? 120,
      input.durationMinutes ?? 60,
      input.isActive ?? true
    ]
  );

  return { serviceId };
}
