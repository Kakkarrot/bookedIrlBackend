import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireUser } from "../lib/auth";

const createServiceSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  priceDollars: z.number().int().min(1).max(9999),
  durationMinutes: z.number().int().min(15).max(9999),
  photos: z.array(z.string().url()).max(3).optional(),
  isActive: z.boolean().optional()
});

const updateServiceSchema = z.object({
  title: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  priceDollars: z.number().int().min(1).max(9999).optional(),
  durationMinutes: z.number().int().min(15).max(9999).optional(),
  photos: z.array(z.string().url()).max(3).optional(),
  isActive: z.boolean().optional()
});

const serviceIdParamsSchema = z.object({
  serviceId: z.string().uuid()
});

const listServicesSchema = z.object({
  userIds: z.string().optional()
});

type ServiceRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  price_dollars: number;
  duration_minutes: number;
  is_active: boolean;
};

type ServicePhotoRow = {
  service_id: string;
  url: string;
  sort_order: number;
};

export async function serviceRoutes(app: FastifyInstance) {
  const db = app.dbPool;

  async function replaceServicePhotos(
    client: import("pg").PoolClient,
    serviceId: string,
    photos: string[]
  ) {
    await client.query("DELETE FROM service_photos WHERE service_id = $1", [serviceId]);
    for (const [index, url] of photos.entries()) {
      await client.query(
        "INSERT INTO service_photos (id, service_id, url, sort_order) VALUES ($1, $2, $3, $4)",
        [randomUUID(), serviceId, url, index]
      );
    }
  }

  async function attachPhotos(rows: ServiceRow[]) {
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

  app.get("/services", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listServicesSchema.parse(request.query);
    const userIds = query.userIds
      ? query.userIds.split(",").map((id) => id.trim()).filter(Boolean)
      : [];

    const result = userIds.length
      ? await db.query(
          `
          SELECT s.id, s.user_id, s.title, s.description, s.price_dollars, s.duration_minutes, s.is_active
          FROM services s
          WHERE s.user_id = ANY($1::uuid[])
            AND s.is_active = true
            AND EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = s.user_id)
            AND EXISTS (SELECT 1 FROM services s2 WHERE s2.user_id = s.user_id AND s2.is_active = true)
          ORDER BY s.created_at DESC
          `,
          [userIds]
        )
      : await db.query(
          "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC",
          [auth.userId]
        );

    reply.send(await attachPhotos(result.rows as ServiceRow[]));
  });

  app.get("/service/:serviceId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = serviceIdParamsSchema.parse(request.params);

    const result = await db.query(
      `
      SELECT s.id, s.user_id, s.title, s.description, s.price_dollars, s.duration_minutes, s.is_active
      FROM services s
      WHERE s.id = $1
        AND (
          s.user_id = $2
          OR (
            s.is_active = true
            AND EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = s.user_id)
            AND EXISTS (SELECT 1 FROM services s2 WHERE s2.user_id = s.user_id AND s2.is_active = true)
          )
        )
      `,
      [params.serviceId, auth.userId]
    );

    if (!result.rowCount) {
      reply.code(404).send({ error: "service_not_found" });
      return;
    }

    const [service] = await attachPhotos(result.rows as ServiceRow[]);
    reply.send(service);
  });

  app.post("/service", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = createServiceSchema.parse(request.body);
    const countResult = await db.query(
      "SELECT COUNT(*)::int AS count FROM services WHERE user_id = $1",
      [auth.userId]
    );

    if (countResult.rows[0].count >= 3) {
      reply.code(400).send({ error: "service_limit_reached" });
      return;
    }

    const serviceId = randomUUID();
    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO services (id, user_id, title, description, price_dollars, duration_minutes, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [
          serviceId,
          auth.userId,
          payload.title,
          payload.description ?? null,
          payload.priceDollars,
          payload.durationMinutes,
          payload.isActive ?? true
        ]
      );
      await replaceServicePhotos(client, serviceId, payload.photos ?? []);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    reply.code(201).send({ id: serviceId });
  });

  app.patch("/service/:serviceId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = serviceIdParamsSchema.parse(request.params);
    const payload = updateServiceSchema.parse(request.body);

    const serviceResult = await db.query(
      "SELECT user_id FROM services WHERE id = $1",
      [params.serviceId]
    );

    if (!serviceResult.rowCount) {
      reply.code(404).send({ error: "service_not_found" });
      return;
    }

    if (serviceResult.rows[0].user_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE services
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             price_dollars = COALESCE($3, price_dollars),
             duration_minutes = COALESCE($4, duration_minutes),
             is_active = COALESCE($5, is_active),
             updated_at = now()
         WHERE id = $6`,
        [
          payload.title ?? null,
          payload.description ?? null,
          payload.priceDollars ?? null,
          payload.durationMinutes ?? null,
          payload.isActive ?? null,
          params.serviceId
        ]
      );
      if (payload.photos) {
        await replaceServicePhotos(client, params.serviceId, payload.photos);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    reply.send({ ok: true });
  });

  app.delete("/service/:serviceId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = serviceIdParamsSchema.parse(request.params);

    const serviceResult = await db.query(
      "SELECT user_id FROM services WHERE id = $1",
      [params.serviceId]
    );

    if (!serviceResult.rowCount) {
      reply.code(404).send({ error: "service_not_found" });
      return;
    }

    if (serviceResult.rows[0].user_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    await db.query("DELETE FROM services WHERE id = $1", [params.serviceId]);
    reply.send({ ok: true });
  });
}
