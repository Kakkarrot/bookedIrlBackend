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
  role: z.enum(["buyer", "seller"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).max(10000).default(0)
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid()
});

const listUserBookingsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).max(10000).default(0)
});

const bookingIdParamsSchema = z.object({
  bookingId: z.string().uuid()
});

const updateBookingSchema = z.object({
  status: z.enum(["accepted", "declined", "canceled", "completed"]).optional(),
  scheduledAt: z.string().datetime().optional()
});

const allowedStatusTransitions: Record<string, Set<string>> = {
  requested: new Set(["accepted", "declined", "canceled"]),
  accepted: new Set(["completed", "canceled"]),
  declined: new Set([]),
  canceled: new Set([]),
  completed: new Set([])
};

function ensureStatusUpdateAllowed(
  booking: { buyer_id: string; seller_id: string; status: string },
  actorId: string,
  nextStatus: string
) {
  const isSeller = booking.seller_id === actorId;
  const isBuyer = booking.buyer_id === actorId;
  const currentStatus = booking.status;

  if (!allowedStatusTransitions[currentStatus]?.has(nextStatus)) {
    return { ok: false, code: 400, error: "invalid_status_transition" as const };
  }

  if (nextStatus === "accepted" || nextStatus === "declined" || nextStatus === "completed") {
    if (!isSeller) {
      return { ok: false, code: 403, error: "forbidden" as const };
    }
  }

  if (nextStatus === "canceled") {
    if (!isBuyer && !isSeller) {
      return { ok: false, code: 403, error: "forbidden" as const };
    }
  }

  return { ok: true as const };
}

export async function bookingRoutes(app: FastifyInstance) {
  app.get("/bookings", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listBookingsSchema.parse(request.query);
    const role = query.role ?? "buyer";

    const result = await pool.query(
      role === "seller"
        ? "SELECT * FROM bookings WHERE seller_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3"
        : "SELECT * FROM bookings WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [auth.userId, query.limit, query.offset]
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

  app.patch("/bookings/:bookingId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = bookingIdParamsSchema.parse(request.params);
    const payload = updateBookingSchema.parse(request.body);

    const bookingResult = await pool.query(
      "SELECT buyer_id, seller_id, status FROM bookings WHERE id = $1",
      [params.bookingId]
    );

    if (!bookingResult.rowCount) {
      reply.code(404).send({ error: "booking_not_found" });
      return;
    }

    const booking = bookingResult.rows[0];
    if (booking.buyer_id !== auth.userId && booking.seller_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    if (payload.status) {
      const check = ensureStatusUpdateAllowed(
        { buyer_id: booking.buyer_id, seller_id: booking.seller_id, status: booking.status },
        auth.userId,
        payload.status
      );
      if (!check.ok) {
        reply.code(check.code).send({ error: check.error });
        return;
      }
    }

    await pool.query(
      "UPDATE bookings SET status = COALESCE($1, status), scheduled_at = COALESCE($2, scheduled_at), updated_at = now() WHERE id = $3",
      [payload.status ?? null, payload.scheduledAt ?? null, params.bookingId]
    );

    reply.send({ ok: true });
  });

  app.get("/users/:userId/bookings", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);
    if (params.userId !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const query = listUserBookingsSchema.parse(request.query);
    const result = await pool.query(
      "SELECT * FROM bookings WHERE seller_id = $1 AND buyer_id <> seller_id ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [params.userId, query.limit, query.offset]
    );

    reply.send(result.rows);
  });
}
