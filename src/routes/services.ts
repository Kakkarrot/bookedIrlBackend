import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireUser } from "../lib/auth";

const createServiceSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  priceDollars: z.number().int().min(1).max(9999),
  durationMinutes: z.number().int().min(15).max(9999),
  isActive: z.boolean().optional()
});

const updateServiceSchema = z.object({
  title: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  priceDollars: z.number().int().min(1).max(9999).optional(),
  durationMinutes: z.number().int().min(15).max(9999).optional(),
  isActive: z.boolean().optional()
});

const serviceIdParamsSchema = z.object({
  serviceId: z.string().uuid()
});

const listServicesSchema = z.object({
  userIds: z.string().optional()
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid()
});

export async function serviceRoutes(app: FastifyInstance) {
  const db = app.dbPool;

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

    reply.send(result.rows);
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

    reply.send(result.rows[0]);
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

    await db.query(
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

    await db.query(
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

    reply.send({ ok: true });
  });

  app.post("/users/:userId/services", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);
    if (params.userId !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const payload = createServiceSchema.parse(request.body);
    const countResult = await db.query(
      "SELECT COUNT(*)::int AS count FROM services WHERE user_id = $1",
      [params.userId]
    );

    if (countResult.rows[0].count >= 3) {
      reply.code(400).send({ error: "service_limit_reached" });
      return;
    }

    const serviceId = randomUUID();

    await db.query(
      "INSERT INTO services (id, user_id, title, description, price_dollars, duration_minutes, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        serviceId,
        params.userId,
        payload.title,
        payload.description ?? null,
        payload.priceDollars,
        payload.durationMinutes,
        payload.isActive ?? true
      ]
    );

    reply.code(201).send({ id: serviceId });
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

  app.get("/users/:userId/services", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);

    const isSelf = params.userId === auth.userId;
    const result = await db.query(
      isSelf
        ? "SELECT id, user_id, title, description, price_dollars, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC"
        : `
          SELECT s.id, s.user_id, s.title, s.description, s.price_dollars, s.duration_minutes, s.is_active
          FROM services s
          WHERE s.user_id = $1
            AND s.is_active = true
            AND EXISTS (SELECT 1 FROM user_photos up WHERE up.user_id = s.user_id)
            AND EXISTS (SELECT 1 FROM services s2 WHERE s2.user_id = s.user_id AND s2.is_active = true)
          ORDER BY s.created_at DESC
        `,
      [params.userId]
    );

    reply.send(result.rows);
  });
}
