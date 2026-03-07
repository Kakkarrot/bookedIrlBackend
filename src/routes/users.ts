import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";

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
  intentLooking: z.boolean().optional(),
  intentOffering: z.boolean().optional(),
  photos: z.array(z.string().url()).max(6).optional(),
  socialLinks: z.array(z.string().url()).max(10).optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
    .optional()
});

const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(1).max(200).default(25),
  limit: z.coerce.number().min(1).max(100).default(20)
});

const listPhotosSchema = z.object({
  userIds: z.string()
});

type NearbyUserRow = { id: string };
type PhotoRow = { user_id: string; url: string; sort_order: number };

const userIdParamsSchema = z.object({
  userId: z.string().uuid()
});

const qualifiedNearbySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20)
});

export async function userRoutes(app: FastifyInstance) {
  app.get("/users/me", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const userResult = await pool.query(
      "SELECT id, display_name, username, email, phone, headline, bio, intent_looking, intent_offering FROM users WHERE id = $1",
      [auth.userId]
    );

    if (!userResult.rowCount) {
      reply.code(404).send({ error: "user_not_found" });
      return;
    }

    const [photos, socialLinks, services] = await Promise.all([
      pool.query(
        "SELECT url, sort_order FROM user_photos WHERE user_id = $1 ORDER BY sort_order",
        [auth.userId]
      ),
      pool.query(
        "SELECT url, sort_order FROM user_social_links WHERE user_id = $1 ORDER BY sort_order",
        [auth.userId]
      ),
      pool.query(
        "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC",
        [auth.userId]
      )
    ]);

    reply.send({
      ...userResult.rows[0],
      photos: photos.rows,
      socialLinks: socialLinks.rows,
      services: services.rows
    });
  });

  app.get("/users/:userId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);

    const userResult = await pool.query(
        "SELECT id, display_name, username, email, phone, headline, bio, intent_looking, intent_offering FROM users WHERE id = $1",
      [params.userId]
    );

    if (!userResult.rowCount) {
      reply.code(404).send({ error: "user_not_found" });
      return;
    }

    const baseUser = userResult.rows[0];
    const isSelf = auth.userId === params.userId;
    if (!isSelf) {
      const discoverableResult = await pool.query(
        `
          SELECT EXISTS (
            SELECT 1
            FROM user_photos up
            WHERE up.user_id = $1
          ) AS has_photos,
          EXISTS (
            SELECT 1
            FROM services s
            WHERE s.user_id = $1
              AND s.is_active = true
          ) AS has_bookable_services
        `,
        [params.userId]
      );

      const { has_photos, has_bookable_services } = discoverableResult.rows[0];
      if (!has_photos || !has_bookable_services) {
        reply.code(404).send({ error: "user_not_found" });
        return;
      }
    }

    const [photos, socialLinks, services] = await Promise.all([
      pool.query(
        "SELECT url, sort_order FROM user_photos WHERE user_id = $1 ORDER BY sort_order",
        [params.userId]
      ),
      pool.query(
        "SELECT url, sort_order FROM user_social_links WHERE user_id = $1 ORDER BY sort_order",
        [params.userId]
      ),
      pool.query(
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
        services: services.rows
      });
      return;
    }

    const { email: _email, phone: _phone, ...publicUser } = baseUser;
    reply.send({
      ...publicUser,
      photos: photos.rows,
      socialLinks: socialLinks.rows,
      services: services.rows
    });
  });

  app.post("/users", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = updateUserSchema.parse(request.body);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      try {
      await client.query(
        `UPDATE users
         SET display_name = COALESCE($1, display_name),
             username = COALESCE(LOWER($2), username),
             headline = COALESCE($3, headline),
             bio = COALESCE($4, bio),
             intent_looking = COALESCE($5, intent_looking),
             intent_offering = COALESCE($6, intent_offering),
             updated_at = now()
         WHERE id = $7`,
        [
          payload.displayName ?? null,
          payload.username ?? null,
          payload.headline ?? null,
          payload.bio ?? null,
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
        await client.query("DELETE FROM user_photos WHERE user_id = $1", [auth.userId]);
        for (const [index, url] of payload.photos.entries()) {
          await client.query(
            "INSERT INTO user_photos (id, user_id, url, sort_order) VALUES ($1, $2, $3, $4)",
            [randomUUID(), auth.userId, url, index]
          );
        }
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

  app.get("/users/nearby", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = nearbySchema.parse(request.query);
    const radiusMeters = query.radiusKm * 1000;

    const nearbyResult = await pool.query(
      `
        SELECT u.id,
               u.display_name,
               u.username,
               u.headline,
               u.bio,
               ST_Distance(ul.location, ST_MakePoint($1, $2)::geography) AS distance_meters
        FROM user_locations ul
        JOIN users u ON u.id = ul.user_id
        WHERE EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = u.id)
          AND EXISTS (
            SELECT 1
            FROM services s
            WHERE s.user_id = u.id
              AND s.is_active = true
          )
          AND ST_DWithin(ul.location, ST_MakePoint($1, $2)::geography, $3)
        ORDER BY distance_meters ASC
        LIMIT $4
      `,
      [query.lng, query.lat, radiusMeters, query.limit]
    );

    const userIds = (nearbyResult.rows as NearbyUserRow[]).map((row) => row.id);
    const photosResult = userIds.length
      ? await pool.query(
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

  app.get("/users/nearby-qualified", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = qualifiedNearbySchema.parse(request.query);

    const locationResult = await pool.query(
      "SELECT location FROM user_locations WHERE user_id = $1",
      [auth.userId]
    );

    if (!locationResult.rowCount) {
      reply.code(400).send({ error: "user_location_missing" });
      return;
    }

    const nearbyResult = await pool.query(
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
               ST_Distance(ul.location, me.location) AS distance_meters
        FROM me
        JOIN user_locations ul ON true
        JOIN users u ON u.id = ul.user_id
        WHERE u.id <> $1
          AND EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = u.id)
          AND EXISTS (
            SELECT 1
            FROM services s
            WHERE s.user_id = u.id
              AND s.is_active = true
          )
        ORDER BY distance_meters ASC
        LIMIT $2
      `,
      [auth.userId, query.limit]
    );

    const userIds = (nearbyResult.rows as NearbyUserRow[]).map((row) => row.id);
    const photosResult = userIds.length
      ? await pool.query(
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

  app.get("/users/photos", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listPhotosSchema.parse(request.query);
    const userIds = query.userIds.split(",").map((id) => id.trim()).filter(Boolean);

    if (!userIds.length) {
      reply.send([]);
      return;
    }

    const photosResult = await pool.query(
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
