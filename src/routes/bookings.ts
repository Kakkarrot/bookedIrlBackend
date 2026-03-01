import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";

const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  scheduledAt: z.string().datetime()
});

const listBookingsSchema = z.object({
  role: z.enum(["buyer", "seller"]).optional()
});

export async function bookingRoutes(app: FastifyInstance) {
  app.get("/bookings", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listBookingsSchema.parse(request.query);
    const role = query.role ?? "buyer";

    const result = await pool.query(
      role === "seller"
        ? "SELECT * FROM bookings WHERE seller_id = $1 ORDER BY created_at DESC"
        : "SELECT * FROM bookings WHERE buyer_id = $1 ORDER BY created_at DESC",
      [auth.userId]
    );

    reply.send(result.rows);
  });

  app.post("/bookings", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = createBookingSchema.parse(request.body);
    const serviceResult = await pool.query(
      "SELECT user_id FROM services WHERE id = $1",
      [payload.serviceId]
    );

    if (!serviceResult.rowCount) {
      reply.code(404).send({ error: "service_not_found" });
      return;
    }

    const bookingId = randomUUID();
    const sellerId = serviceResult.rows[0].user_id;

    await pool.query(
      "INSERT INTO bookings (id, buyer_id, seller_id, service_id, status, scheduled_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        bookingId,
        auth.userId,
        sellerId,
        payload.serviceId,
        "requested",
        payload.scheduledAt
      ]
    );

    reply.code(201).send({ id: bookingId });
  });
}
