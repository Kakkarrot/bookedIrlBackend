import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireUser } from "../lib/auth";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function isAtLeast18(birthday: string) {
  const [year, month, day] = birthday.split("-").map(Number);
  if (!year || !month || !day) return false;
  const birthUTC = Date.UTC(year, month - 1, day);
  if (Number.isNaN(birthUTC)) return false;
  const now = new Date();
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const ageDate = new Date(nowUTC - birthUTC);
  return ageDate.getUTCFullYear() - 1970 >= 18;
}

const updateUserSchema = z.object({
  displayName: z.string().min(2).max(64).optional(),
  username: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9]+$/)
    .transform((value) => value.toLowerCase())
    .optional(),
  headline: z
    .string()
    .min(1)
    .max(30)
    .transform((value) => value.trim())
    .optional(),
  bio: z.string().max(500).optional(),
  birthday: z
    .string()
    .regex(dateRegex)
    .refine(isAtLeast18, { message: "must_be_18_or_older" })
    .optional(),
  onboardingStep: z.string().max(32).optional(),
  intentLooking: z.boolean().optional(),
  intentOffering: z.boolean().optional(),
  photos: z.array(z.string().url()).max(3).optional(),
  socialLinks: z.array(z.string().url()).max(10).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
    .optional()
});

const updatePhotosSchema = z.object({
  photos: z.array(z.string().url()).max(3)
});

const listPhotosSchema = z.object({
  userIds: z.string()
});

type NearbyUserRow = { id: string };
type PhotoRow = { user_id: string; url: string; sort_order: number };
type ServiceRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  price_dollars: number;
  duration_minutes: number;
  is_active: boolean;
};
type ServicePhotoRow = { service_id: string; url: string; sort_order: number };

const userIdParamsSchema = z.object({
  userId: z.string().uuid()
});

const listUsersSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).max(10000).default(0),
  query: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
});

export async function userRoutes(app: FastifyInstance) {
  const db = app.dbPool;

  async function replaceUserPhotos(
    client: import("pg").PoolClient,
    userId: string,
    photos: string[]
  ) {
    await client.query("DELETE FROM user_photos WHERE user_id = $1", [userId]);
    for (const [index, url] of photos.entries()) {
      await client.query(
        "INSERT INTO user_photos (id, user_id, url, sort_order) VALUES ($1, $2, $3, $4)",
        [randomUUID(), userId, url, index]
      );
    }
  }

  async function attachServicePhotos(rows: ServiceRow[]) {
    if (!rows.length) {
      return [];
    }

    const serviceIds = rows.map((row) => row.id);
    const photoResult = await db.query(
      "SELECT service_id, url, sort_order FROM service_photos WHERE service_id = ANY($1::uuid[]) ORDER BY service_id, sort_order",
      [serviceIds]
    );

    const photosByService = new Map<string, Array<{ url: string; sort_order: number }>>();
    for (const row of photoResult.rows as ServicePhotoRow[]) {
      const list = photosByService.get(row.service_id) ?? [];
      list.push({ url: row.url, sort_order: row.sort_order });
      photosByService.set(row.service_id, list);
    }

    return rows.map((row) => ({
      ...row,
      photos: photosByService.get(row.id) ?? []
    }));
  }

  app.get("/user/me", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const userResult = await db.query(
      "SELECT id, display_name, username, email, headline, bio, birthday, onboarding_step, intent_looking, intent_offering FROM users WHERE id = $1",
      [auth.userId]
    );

    if (!userResult.rowCount) {
      reply.code(404).send({ error: "user_not_found" });
      return;
    }

    const [photos, socialLinks, services] = await Promise.all([
      db.query(
        "SELECT url, sort_order FROM user_photos WHERE user_id = $1 ORDER BY sort_order",
        [auth.userId]
      ),
      db.query(
        "SELECT url, sort_order FROM user_social_links WHERE user_id = $1 ORDER BY sort_order",
        [auth.userId]
      ),
      db.query(
        "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC",
        [auth.userId]
      )
    ]);

    reply.send({
      ...userResult.rows[0],
      photos: photos.rows,
      socialLinks: socialLinks.rows,
      services: await attachServicePhotos(services.rows as ServiceRow[])
    });
  });

  app.get("/users/:userId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);

    const userResult = await db.query(
        "SELECT id, display_name, username, email, headline, bio, birthday, onboarding_step, intent_looking, intent_offering FROM users WHERE id = $1",
      [params.userId]
    );

    if (!userResult.rowCount) {
      reply.code(404).send({ error: "user_not_found" });
      return;
    }

    const baseUser = userResult.rows[0];
    const isSelf = auth.userId === params.userId;

    const [photos, socialLinks, services] = await Promise.all([
      db.query(
        "SELECT url, sort_order FROM user_photos WHERE user_id = $1 ORDER BY sort_order",
        [params.userId]
      ),
      db.query(
        "SELECT url, sort_order FROM user_social_links WHERE user_id = $1 ORDER BY sort_order",
        [params.userId]
      ),
      db.query(
        isSelf
          ? "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC"
          : "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC",
        [params.userId]
      )
    ]);

    if (isSelf) {
      reply.send({
        ...baseUser,
        photos: photos.rows,
        socialLinks: socialLinks.rows,
        services: await attachServicePhotos(services.rows as ServiceRow[])
      });
      return;
    }

    const { email: _email, ...publicUser } = baseUser;
    reply.send({
      ...publicUser,
      photos: photos.rows,
      socialLinks: socialLinks.rows,
      services: await attachServicePhotos(services.rows as ServiceRow[])
    });
  });

  app.post("/user", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = updateUserSchema.parse(request.body);
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      try {
      await client.query(
        `UPDATE users
         SET display_name = COALESCE($1, display_name),
             username = COALESCE(LOWER($2), username),
             headline = COALESCE($3, headline),
             bio = COALESCE($4, bio),
             birthday = COALESCE($5, birthday),
             onboarding_step = COALESCE($6, onboarding_step),
             intent_looking = COALESCE($7, intent_looking),
             intent_offering = COALESCE($8, intent_offering),
             updated_at = now()
         WHERE id = $9`,
        [
          payload.displayName ?? null,
          payload.username ?? null,
          payload.headline ?? null,
          payload.bio ?? null,
          payload.birthday ?? null,
          payload.onboardingStep ?? null,
          payload.intentLooking ?? null,
          payload.intentOffering ?? null,
          auth.userId
        ]
      );
      } catch (error: any) {
        if (
          error?.code === "23505" &&
          (error?.constraint === "users_username_lower_idx" ||
            String(error?.detail ?? "").includes("username"))
        ) {
          reply.code(409).send({ error: "username_taken" });
          await client.query("ROLLBACK");
          return;
        }
        throw error;
      }

      if (payload.photos) {
        await replaceUserPhotos(client, auth.userId, payload.photos);
      }

      if (payload.socialLinks) {
        await client.query("DELETE FROM user_social_links WHERE user_id = $1", [auth.userId]);
        for (const [index, url] of payload.socialLinks.entries()) {
          await client.query(
            "INSERT INTO user_social_links (id, user_id, url, sort_order) VALUES ($1, $2, $3, $4)",
            [randomUUID(), auth.userId, url, index]
          );
        }
      }

      if (payload.location) {
        await client.query(
          "INSERT INTO user_locations (user_id, location) VALUES ($1, ST_MakePoint($2, $3)::geography) ON CONFLICT (user_id) DO UPDATE SET location = EXCLUDED.location, updated_at = now()",
          [auth.userId, payload.location.lng, payload.location.lat]
        );
      }

      await client.query("COMMIT");
      reply.send({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post("/user/photos", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = updatePhotosSchema.parse(request.body);
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await replaceUserPhotos(client, auth.userId, payload.photos);
      await client.query("COMMIT");
      reply.send({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.get("/users", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listUsersSchema.parse(request.query);
    const searchPattern = query.query ? `%${query.query}%` : null;

    const locationResult = await db.query(
      "SELECT location FROM user_locations WHERE user_id = $1",
      [auth.userId]
    );

    if (!locationResult.rowCount) {
      reply.code(400).send({ error: "user_location_missing" });
      return;
    }

    const nearbyResult = await db.query(
      `
        WITH me AS (
          SELECT location
          FROM user_locations
          WHERE user_id = $1
        )
        SELECT u.id,
               u.display_name,
               u.username,
               u.headline,
               u.bio,
               CASE
                 WHEN ul.location IS NOT NULL THEN ST_Distance(ul.location, me.location)
                 ELSE NULL
               END AS distance_meters
        FROM me
        JOIN users u ON u.id <> $1
        LEFT JOIN user_locations ul ON ul.user_id = u.id
        WHERE u.id <> $1
          AND EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = u.id)
          AND EXISTS (
            SELECT 1
            FROM services s
            WHERE s.user_id = u.id
              AND s.is_active = true
          )
          AND (
            $4::text IS NULL
            OR u.display_name ILIKE $4
            OR COALESCE(u.username, '') ILIKE $4
            OR COALESCE(u.headline, '') ILIKE $4
            OR COALESCE(u.bio, '') ILIKE $4
            OR EXISTS (
              SELECT 1
              FROM services s
              WHERE s.user_id = u.id
                AND s.is_active = true
                AND (
                  s.title ILIKE $4
                  OR COALESCE(s.description, '') ILIKE $4
                )
            )
          )
        ORDER BY distance_meters ASC NULLS LAST, u.created_at DESC, u.id
        LIMIT $2 OFFSET $3
      `,
      [auth.userId, query.limit, query.offset, searchPattern]
    );

    const userIds = (nearbyResult.rows as NearbyUserRow[]).map((row) => row.id);
    const photosResult = userIds.length
      ? await db.query(
          "SELECT user_id, url, sort_order FROM user_photos WHERE user_id = ANY($1::uuid[]) ORDER BY sort_order",
          [userIds]
        )
      : { rows: [] as PhotoRow[] };

    const photosByUser = new Map<string, PhotoRow[]>();
    for (const row of photosResult.rows as PhotoRow[]) {
      const list = photosByUser.get(row.user_id) ?? [];
      list.push({ url: row.url, sort_order: row.sort_order, user_id: row.user_id });
      photosByUser.set(row.user_id, list);
    }

    reply.send(
      (nearbyResult.rows as NearbyUserRow[]).map((row) => ({
        ...row,
        photos: photosByUser.get(row.id) ?? []
      }))
    );
  });

  app.get("/user/photos", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listPhotosSchema.parse(request.query);
    const userIds = query.userIds.split(",").map((id) => id.trim()).filter(Boolean);

    if (!userIds.length) {
      reply.send([]);
      return;
    }

    const photosResult = await db.query(
      `
        SELECT up.user_id, up.url, up.sort_order
        FROM user_photos up
        WHERE up.user_id = ANY($1::uuid[])
          AND EXISTS (
            SELECT 1
            FROM services s
            WHERE s.user_id = up.user_id
              AND s.is_active = true
          )
        ORDER BY up.sort_order
      `,
      [userIds]
    );

    reply.send(photosResult.rows);
  });
}
