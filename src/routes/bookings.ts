import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { requireUser } from "../lib/auth";
import { logRequestEvent } from "../lib/logging";
import {
  buildBookingCreatedEvent,
  buildBookingUpdatedEvent,
  buildChatCreatedEvent
} from "../lib/realtimeEvents";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeOfDayValues = ["morning", "afternoon", "evening", "night"] as const;

const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  requestedDate: z.string().regex(dateRegex),
  timeOfDay: z.enum(timeOfDayValues),
  note: z.string().trim().max(500).optional()
});

const listBookingsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).max(10000).default(0)
});

const bookingIdParamsSchema = z.object({
  bookingId: z.string().uuid()
});

const updateBookingSchema = z.object({
  status: z.enum(["accepted", "declined"]).optional()
});

const allowedStatusTransitions: Record<string, Set<string>> = {
  requested: new Set(["accepted", "declined"]),
  accepted: new Set([]),
  declined: new Set([])
};

function canonicalPair(userA: string, userB: string) {
  return userA <= userB
    ? { participantA: userA, participantB: userB }
    : { participantA: userB, participantB: userA };
}

function ensureStatusUpdateAllowed(
  booking: { seller_id: string; status: string },
  actorId: string,
  nextStatus: string
) {
  if (!allowedStatusTransitions[booking.status]?.has(nextStatus)) {
    return { ok: false, code: 400, error: "invalid_status_transition" as const };
  }

  if (booking.seller_id !== actorId) {
    return { ok: false, code: 403, error: "forbidden" as const };
  }

  return { ok: true as const };
}

const sellerInboxSelect = `
  SELECT b.id,
         b.buyer_id,
         b.seller_id,
         b.service_id,
         b.service_title,
         b.service_price_dollars,
         b.service_duration_minutes,
         b.status,
         b.requested_date::text AS requested_date,
         b.time_of_day,
         b.note,
         b.created_at,
         b.updated_at,
         buyer.display_name AS buyer_display_name,
         buyer.username AS buyer_username,
         buyer_photo.url AS buyer_photo_url
  FROM bookings b
  JOIN users buyer ON buyer.id = b.buyer_id
  LEFT JOIN LATERAL (
    SELECT url
    FROM user_photos
    WHERE user_id = b.buyer_id
    ORDER BY sort_order
    LIMIT 1
  ) buyer_photo ON true
`;

async function listSellerInboxBookings(db: Pool, userId: string, limit: number, offset: number) {
  return db.query(
    `${sellerInboxSelect}
     WHERE b.seller_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

function toBookingResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    seller_id: row.seller_id,
    service_id: row.service_id,
    service_title: row.service_title,
    service_price_dollars: row.service_price_dollars,
    service_duration_minutes: row.service_duration_minutes,
    status: row.status,
    requested_date: row.requested_date,
    time_of_day: row.time_of_day,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    buyer: {
      id: row.buyer_id,
      display_name: row.buyer_display_name,
      username: row.buyer_username,
      photo_url: row.buyer_photo_url
    }
  };
}

export async function bookingRoutes(app: FastifyInstance) {
  const db = app.dbPool;

  app.get("/bookings", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listBookingsSchema.parse(request.query);
    const result = await listSellerInboxBookings(db, auth.userId, query.limit, query.offset);

    reply.send(result.rows.map(toBookingResponse));
  });

  app.post("/booking", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = createBookingSchema.parse(request.body);
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const serviceResult = await client.query(
        "SELECT id, user_id, is_active, title, price_dollars, duration_minutes FROM services WHERE id = $1",
        [payload.serviceId]
      );

      if (!serviceResult.rowCount) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_create_rejected", {
          reason: "service_not_found",
          actor_user_id: auth.userId,
          service_id: payload.serviceId
        });
        reply.code(404).send({ error: "service_not_found" });
        return;
      }

      const service = serviceResult.rows[0] as {
        user_id: string;
        is_active: boolean;
        title: string;
        price_dollars: number;
        duration_minutes: number;
      };

      if (service.user_id === auth.userId) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_create_rejected", {
          reason: "cannot_book_own_service",
          actor_user_id: auth.userId,
          service_id: payload.serviceId
        });
        reply.code(400).send({ error: "cannot_book_own_service" });
        return;
      }

      if (!service.is_active) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_create_rejected", {
          reason: "service_not_bookable",
          actor_user_id: auth.userId,
          service_id: payload.serviceId
        });
        reply.code(400).send({ error: "service_not_bookable" });
        return;
      }

      const { participantA, participantB } = canonicalPair(auth.userId, service.user_id);
      const existingBooking = await client.query(
        `
        SELECT id
        FROM bookings
        WHERE participant_a = $1
          AND participant_b = $2
          AND status IN ('requested', 'accepted')
        LIMIT 1
        `,
        [participantA, participantB]
      );

      if (existingBooking.rowCount) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_create_rejected", {
          reason: "booking_already_exists",
          actor_user_id: auth.userId,
          service_id: payload.serviceId,
          seller_user_id: service.user_id
        });
        reply.code(409).send({ error: "booking_already_exists" });
        return;
      }

      const bookingId = randomUUID();
      const buyerResult = await client.query<{ buyer_display_name: string }>(
        `
        SELECT COALESCE(display_name, username, email, 'Someone') AS buyer_display_name
        FROM users
        WHERE id = $1
        `,
        [auth.userId]
      );
      const buyerDisplayName = buyerResult.rows[0]?.buyer_display_name ?? "Someone";
      await client.query(
        `
        INSERT INTO bookings (
          id, buyer_id, seller_id, participant_a, participant_b, service_id,
          service_title, service_price_dollars, service_duration_minutes,
          status, requested_date, time_of_day, note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'requested', $10, $11, $12)
        `,
        [
          bookingId,
          auth.userId,
          service.user_id,
          participantA,
          participantB,
          payload.serviceId,
          service.title,
          service.price_dollars,
          service.duration_minutes,
          payload.requestedDate,
          payload.timeOfDay,
          payload.note?.trim() || null
        ]
      );

      await client.query("COMMIT");
      logRequestEvent(request, "info", "booking_created", {
        booking_id: bookingId,
        buyer_user_id: auth.userId,
        seller_user_id: service.user_id,
        service_id: payload.serviceId
      });

      void app.bookingPushSender(db, request.log, {
        bookingId,
        sellerUserId: service.user_id,
        buyerDisplayName,
        serviceTitle: service.title
      });
      void app.realtimeBroker.publish(
        buildBookingCreatedEvent({
          bookingId,
          sellerUserId: service.user_id
        })
      ).catch((error) => {
        request.log.error({
          component: "realtime",
          event: "realtime_publish_failed",
          booking_id: bookingId,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      reply.code(201).send({ id: bookingId });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        logRequestEvent(request, "warn", "booking_create_rejected", {
          reason: "booking_already_exists",
          actor_user_id: auth.userId,
          service_id: payload.serviceId
        });
        reply.code(409).send({ error: "booking_already_exists" });
        return;
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch("/booking/:bookingId", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = bookingIdParamsSchema.parse(request.params);
    const payload = updateBookingSchema.parse(request.body);
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const bookingResult = await client.query(
        "SELECT buyer_id, seller_id, service_id, status FROM bookings WHERE id = $1",
        [params.bookingId]
      );

      if (!bookingResult.rowCount) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_update_rejected", {
          reason: "booking_not_found",
          actor_user_id: auth.userId,
          booking_id: params.bookingId
        });
        reply.code(404).send({ error: "booking_not_found" });
        return;
      }

      const booking = bookingResult.rows[0] as {
        buyer_id: string;
        seller_id: string;
        service_id: string;
        status: string;
      };

      if (booking.buyer_id !== auth.userId && booking.seller_id !== auth.userId) {
        await client.query("ROLLBACK");
        logRequestEvent(request, "warn", "booking_update_rejected", {
          reason: "forbidden",
          actor_user_id: auth.userId,
          booking_id: params.bookingId
        });
        reply.code(403).send({ error: "forbidden" });
        return;
      }

      if (payload.status) {
        const check = ensureStatusUpdateAllowed(
          { seller_id: booking.seller_id, status: booking.status },
          auth.userId,
          payload.status
        );
        if (!check.ok) {
          await client.query("ROLLBACK");
          logRequestEvent(request, "warn", "booking_update_rejected", {
            reason: check.error,
            actor_user_id: auth.userId,
            booking_id: params.bookingId,
            next_status: payload.status
          });
          reply.code(check.code).send({ error: check.error });
          return;
        }
      }

      let createdChatId: string | null = null;

      if (payload.status) {
        await client.query(
          "UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2",
          [payload.status, params.bookingId]
        );

        if (payload.status === "accepted") {
          const { participantA, participantB } = canonicalPair(booking.buyer_id, booking.seller_id);
          const existingChat = await client.query(
            "SELECT id FROM chats WHERE participant_a = $1 AND participant_b = $2",
            [participantA, participantB]
          );

          if (existingChat.rowCount) {
            await client.query("ROLLBACK");
            logRequestEvent(request, "warn", "booking_update_rejected", {
              reason: "chat_already_exists",
              actor_user_id: auth.userId,
              booking_id: params.bookingId,
              existing_chat_id: existingChat.rows[0].id
            });
            reply.code(409).send({ error: "chat_already_exists" });
            return;
          }

          const chatId = randomUUID();
          await client.query(
            `
            INSERT INTO chats (id, booking_id, participant_a, participant_b)
            VALUES ($1, $2, $3, $4)
            `,
            [
              chatId,
              params.bookingId,
              participantA,
              participantB
            ]
          );
          createdChatId = chatId;
          logRequestEvent(request, "info", "chat_created_from_booking_accept", {
            booking_id: params.bookingId,
            chat_id: chatId,
            buyer_user_id: booking.buyer_id,
            seller_user_id: booking.seller_id
          });
        }
      }

      await client.query("COMMIT");
      logRequestEvent(request, "info", "booking_updated", {
        booking_id: params.bookingId,
        actor_user_id: auth.userId,
        next_status: payload.status ?? null
      });

      if (payload.status) {
        void app.realtimeBroker.publish(
          buildBookingUpdatedEvent({
            bookingId: params.bookingId,
            buyerUserId: booking.buyer_id,
            sellerUserId: booking.seller_id,
            status: payload.status
          })
        ).catch((error) => {
          request.log.error({
            component: "realtime",
            event: "realtime_publish_failed",
            booking_id: params.bookingId,
            error: error instanceof Error ? error.message : String(error)
          });
        });

        if (createdChatId) {
          void app.realtimeBroker.publish(
            buildChatCreatedEvent({
              chatId: createdChatId,
              participantUserIds: [booking.buyer_id, booking.seller_id]
            })
          ).catch((error) => {
            request.log.error({
              component: "realtime",
              event: "realtime_publish_failed",
              booking_id: params.bookingId,
              chat_id: createdChatId,
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
      }

      reply.send({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
