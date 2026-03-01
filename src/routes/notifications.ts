import { FastifyInstance } from "fastify";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const result = await pool.query(
      "SELECT id, type, payload, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
      [auth.userId]
    );

    reply.send(result.rows);
  });
}
