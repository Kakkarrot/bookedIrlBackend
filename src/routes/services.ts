import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";

const createServiceSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  priceCents: z.number().int().min(0),
  durationMinutes: z.number().int().min(15).max(24 * 60)
});

const listServicesSchema = z.object({
  userIds: z.string().optional()
});

export async function serviceRoutes(app: FastifyInstance) {
  app.get("/services", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listServicesSchema.parse(request.query);
    const userIds = query.userIds
      ? query.userIds.split(",").map((id) => id.trim()).filter(Boolean)
      : [];

    const result = userIds.length
      ? await pool.query(
          "SELECT id, user_id, title, description, price_cents, duration_minutes, is_active FROM services WHERE user_id = ANY($1::uuid[]) ORDER BY created_at DESC",
          [userIds]
        )
      : await pool.query(
          "SELECT id, user_id, title, description, price_cents, duration_minutes, is_active FROM services WHERE user_id = $1 ORDER BY created_at DESC",
          [auth.userId]
        );

    reply.send(result.rows);
  });

  app.post("/services", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = createServiceSchema.parse(request.body);
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM services WHERE user_id = $1",
      [auth.userId]
    );

    if (countResult.rows[0].count >= 3) {
      reply.code(400).send({ error: "service_limit_reached" });
      return;
    }

    const serviceId = randomUUID();

    await pool.query(
      "INSERT INTO services (id, user_id, title, description, price_cents, duration_minutes) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        serviceId,
        auth.userId,
        payload.title,
        payload.description ?? null,
        payload.priceCents,
        payload.durationMinutes
      ]
    );

    reply.code(201).send({ id: serviceId });
  });
}
