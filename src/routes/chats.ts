import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";

const createChatSchema = z.object({
  serviceId: z.string().uuid()
});

const listMessagesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50)
});

const listChatsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).max(10000).default(0)
});

const createMessageSchema = z.object({
  body: z.string().min(1).max(2000)
});

const markReadSchema = z.object({
  readAt: z.string().datetime().optional()
});

const userIdParamsSchema = z.object({
  userId: z.string().uuid()
});

const bookingIdParamsSchema = z.object({
  bookingId: z.string().uuid()
});

async function listChatsForUser(userId: string, limit: number, offset: number) {
  return pool.query(
    `
      SELECT c.id,
             c.buyer_id,
             c.seller_id,
             c.service_id,
             c.last_message_at,
             s.title AS service_title,
             lm.body AS last_message_body,
             lm.sender_id AS last_message_sender,
             lm.created_at AS last_message_created_at,
             COALESCE(mu.unread_count, 0) AS unread_count
      FROM chats c
      JOIN services s ON s.id = c.service_id
      LEFT JOIN LATERAL (
        SELECT body, sender_id, created_at
        FROM messages m
        WHERE m.chat_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN chat_reads cr ON cr.chat_id = c.id AND cr.user_id = $1
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM messages m
        WHERE m.chat_id = c.id
          AND m.sender_id <> $1
          AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)
      ) mu ON true
      WHERE c.buyer_id = $1 OR c.seller_id = $1
      GROUP BY c.id, s.title, lm.body, lm.sender_id, lm.created_at, cr.last_read_at, mu.unread_count
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset]
  );
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listChatsSchema.parse(request.query);
    const result = await listChatsForUser(auth.userId, query.limit, query.offset);

    reply.send(result.rows);
  });

  app.post("/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = createChatSchema.parse(request.body);
    const serviceResult = await pool.query(
      "SELECT user_id FROM services WHERE id = $1",
      [payload.serviceId]
    );

    if (!serviceResult.rowCount) {
      reply.code(404).send({ error: "service_not_found" });
      return;
    }

    const sellerId = serviceResult.rows[0].user_id as string;
    const existing = await pool.query(
      "SELECT id FROM chats WHERE buyer_id = $1 AND seller_id = $2 AND service_id = $3",
      [auth.userId, sellerId, payload.serviceId]
    );

    if (existing.rowCount) {
      reply.send({ id: existing.rows[0].id });
      return;
    }

    const chatId = randomUUID();
    await pool.query(
      "INSERT INTO chats (id, buyer_id, seller_id, service_id) VALUES ($1, $2, $3, $4)",
      [chatId, auth.userId, sellerId, payload.serviceId]
    );

    reply.code(201).send({ id: chatId });
  });

  app.get("/chats/:id/messages", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = listMessagesSchema.parse(request.query);

    const chatResult = await pool.query(
      "SELECT buyer_id, seller_id FROM chats WHERE id = $1",
      [params.id]
    );

    if (!chatResult.rowCount) {
      reply.code(404).send({ error: "chat_not_found" });
      return;
    }

    const chat = chatResult.rows[0];
    if (chat.buyer_id !== auth.userId && chat.seller_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const messages = await pool.query(
      "SELECT id, sender_id, body, created_at FROM messages WHERE chat_id = $1 ORDER BY created_at DESC LIMIT $2",
      [params.id, query.limit]
    );

    reply.send(messages.rows.reverse());
  });

  app.post("/chats/:id/messages", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = createMessageSchema.parse(request.body);

    const chatResult = await pool.query(
      "SELECT buyer_id, seller_id FROM chats WHERE id = $1",
      [params.id]
    );

    if (!chatResult.rowCount) {
      reply.code(404).send({ error: "chat_not_found" });
      return;
    }

    const chat = chatResult.rows[0];
    if (chat.buyer_id !== auth.userId && chat.seller_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const messageId = randomUUID();

    await pool.query(
      "INSERT INTO messages (id, chat_id, sender_id, body) VALUES ($1, $2, $3, $4)",
      [messageId, params.id, auth.userId, payload.body]
    );

    await pool.query(
      "UPDATE chats SET last_message_at = now(), updated_at = now() WHERE id = $1",
      [params.id]
    );

    reply.code(201).send({ id: messageId });
  });

  app.post("/chats/:id/read", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = markReadSchema.parse(request.body ?? {});

    const chatResult = await pool.query(
      "SELECT buyer_id, seller_id FROM chats WHERE id = $1",
      [params.id]
    );

    if (!chatResult.rowCount) {
      reply.code(404).send({ error: "chat_not_found" });
      return;
    }

    const chat = chatResult.rows[0];
    if (chat.buyer_id !== auth.userId && chat.seller_id !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    await pool.query(
      `
      INSERT INTO chat_reads (chat_id, user_id, last_read_at, updated_at)
      VALUES ($1, $2, COALESCE($3, now()), now())
      ON CONFLICT (chat_id, user_id)
      DO UPDATE SET last_read_at = EXCLUDED.last_read_at, updated_at = now()
      `,
      [params.id, auth.userId, payload.readAt ?? null]
    );

    reply.send({ ok: true });
  });

  app.get("/users/:userId/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);
    if (params.userId !== auth.userId) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const query = listChatsSchema.parse(request.query);
    const result = await listChatsForUser(params.userId, query.limit, query.offset);

    reply.send(result.rows);
  });

  app.post("/bookings/:bookingId/chat", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = bookingIdParamsSchema.parse(request.params);

    const bookingResult = await pool.query(
      "SELECT buyer_id, seller_id, service_id FROM bookings WHERE id = $1",
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

    const existing = await pool.query(
      "SELECT id FROM chats WHERE buyer_id = $1 AND seller_id = $2 AND service_id = $3",
      [booking.buyer_id, booking.seller_id, booking.service_id]
    );

    if (existing.rowCount) {
      reply.send({ id: existing.rows[0].id });
      return;
    }

    const chatId = randomUUID();
    await pool.query(
      "INSERT INTO chats (id, buyer_id, seller_id, service_id) VALUES ($1, $2, $3, $4)",
      [chatId, booking.buyer_id, booking.seller_id, booking.service_id]
    );

    reply.code(201).send({ id: chatId });
  });
}
