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

type ServicePhotoFactoryInput = {
  serviceId: string;
  url?: string;
  sortOrder?: number;
};

type PhotoFactoryInput = {
  userId: string;
  url?: string;
  sortOrder?: number;
};

type LocationFactoryInput = {
  userId: string;
  lat: number;
  lng: number;
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

export async function createServicePhoto(pool: Pool, input: ServicePhotoFactoryInput) {
  const photoId = randomUUID();

  await pool.query(
    `
    INSERT INTO service_photos (id, service_id, url, sort_order)
    VALUES ($1, $2, $3, $4)
    `,
    [
      photoId,
      input.serviceId,
      input.url ?? `https://example.com/service-${photoId}.jpg`,
      input.sortOrder ?? 0
    ]
  );

  return { photoId };
}

export async function createPhoto(pool: Pool, input: PhotoFactoryInput) {
  const photoId = randomUUID();

  await pool.query(
    `
    INSERT INTO user_photos (id, user_id, url, sort_order)
    VALUES ($1, $2, $3, $4)
    `,
    [
      photoId,
      input.userId,
      input.url ?? `https://example.com/${photoId}.jpg`,
      input.sortOrder ?? 0
    ]
  );

  return { photoId };
}

export async function createLocation(pool: Pool, input: LocationFactoryInput) {
  await pool.query(
    `
    INSERT INTO user_locations (user_id, location)
    VALUES ($1, ST_MakePoint($2, $3)::geography)
    ON CONFLICT (user_id)
    DO UPDATE SET location = EXCLUDED.location, updated_at = now()
    `,
    [input.userId, input.lng, input.lat]
  );
}
