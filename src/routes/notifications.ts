import { FastifyInstance } from "fastify";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";
import { z } from "zod";

const listNotificationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).max(10000).default(0)
});

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listNotificationsSchema.parse(request.query);
    const result = await pool.query(
      "SELECT id, type, payload, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [auth.userId, query.limit, query.offset]
    );

    reply.send(result.rows);
  });
}
