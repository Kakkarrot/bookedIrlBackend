import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { requireUser } from "../lib/auth";

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

type ChatParticipantRow = {
  buyer_id: string;
  seller_id: string;
};

type ChatSummaryRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  service_id: string;
  last_message_at: string | null;
  service_title: string;
  other_user_id: string;
  other_user_display_name: string | null;
  other_user_username: string | null;
  other_user_photo_url: string | null;
  last_message_body: string | null;
  last_message_sender: string | null;
  last_message_created_at: string | null;
  unread_count: string | number;
};

async function listChatsForUser(db: Pool, userId: string, limit: number, offset: number) {
  return db.query(
    `
      SELECT c.id,
             c.buyer_id,
             c.seller_id,
             c.service_id,
             c.last_message_at,
             s.title AS service_title,
             ou.id AS other_user_id,
             ou.display_name AS other_user_display_name,
             ou.username AS other_user_username,
             op.url AS other_user_photo_url,
             lm.body AS last_message_body,
             lm.sender_id AS last_message_sender,
             lm.created_at AS last_message_created_at,
             COALESCE(mu.unread_count, 0) AS unread_count
      FROM chats c
      JOIN services s ON s.id = c.service_id
      JOIN users ou
        ON ou.id = CASE
          WHEN c.buyer_id = $1 THEN c.seller_id
          ELSE c.buyer_id
        END
      LEFT JOIN LATERAL (
        SELECT up.url
        FROM user_photos up
        WHERE up.user_id = ou.id
        ORDER BY up.sort_order ASC, up.url ASC
        LIMIT 1
      ) op ON true
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
      GROUP BY c.id, s.title, ou.id, ou.display_name, ou.username, op.url, lm.body, lm.sender_id, lm.created_at, cr.last_read_at, mu.unread_count
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset]
  );
}

async function getAuthorizedChat(db: Pool, chatId: string, userId: string) {
  const chatResult = await db.query<ChatParticipantRow>(
    "SELECT buyer_id, seller_id FROM chats WHERE id = $1",
    [chatId]
  );

  if (!chatResult.rowCount) {
    return { error: "chat_not_found" as const };
  }

  const chat = chatResult.rows[0];
  if (chat.buyer_id !== userId && chat.seller_id !== userId) {
    return { error: "forbidden" as const };
  }

  return { chat };
}

function serializeChatSummary(row: ChatSummaryRow) {
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    seller_id: row.seller_id,
    service_id: row.service_id,
    last_message_at: row.last_message_at,
    service_title: row.service_title,
    other_user: {
      id: row.other_user_id,
      display_name: row.other_user_display_name,
      username: row.other_user_username,
      photo_url: row.other_user_photo_url
    },
    last_message_body: row.last_message_body,
    last_message_sender: row.last_message_sender,
    last_message_created_at: row.last_message_created_at,
    unread_count: Number(row.unread_count)
  };
}

export async function chatRoutes(app: FastifyInstance) {
  const db = app.dbPool;

  app.get("/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const query = listChatsSchema.parse(request.query);
    const result = await listChatsForUser(db, auth.userId, query.limit, query.offset);

    reply.send(result.rows.map(serializeChatSummary));
  });

  app.get("/chats/:id/messages", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const query = listMessagesSchema.parse(request.query);

    const authorization = await getAuthorizedChat(db, params.id, auth.userId);
    if ("error" in authorization) {
      reply.code(authorization.error === "chat_not_found" ? 404 : 403).send({ error: authorization.error });
      return;
    }

    const messages = await db.query(
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

    const authorization = await getAuthorizedChat(db, params.id, auth.userId);
    if ("error" in authorization) {
      reply.code(authorization.error === "chat_not_found" ? 404 : 403).send({ error: authorization.error });
      return;
    }

    const messageId = randomUUID();
    const insertResult = await db.query(
      `
      INSERT INTO messages (id, chat_id, sender_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING id, sender_id, body, created_at
      `,
      [messageId, params.id, auth.userId, payload.body]
    );

    const message = insertResult.rows[0];

    await db.query(
      "UPDATE chats SET last_message_at = $2, updated_at = now() WHERE id = $1",
      [params.id, message.created_at]
    );

    reply.code(201).send(message);
  });

  app.post("/chats/:id/read", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = markReadSchema.parse(request.body ?? {});

    const authorization = await getAuthorizedChat(db, params.id, auth.userId);
    if ("error" in authorization) {
      reply.code(authorization.error === "chat_not_found" ? 404 : 403).send({ error: authorization.error });
      return;
    }

    await db.query(
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
    const result = await listChatsForUser(db, params.userId, query.limit, query.offset);

    reply.send(result.rows.map(serializeChatSummary));
  });

  app.post("/bookings/:bookingId/chat", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = bookingIdParamsSchema.parse(request.params);

    const bookingResult = await db.query(
      "SELECT buyer_id, seller_id, service_id, status FROM bookings WHERE id = $1",
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

    if (booking.status !== "accepted") {
      reply.code(400).send({ error: "booking_not_accepted" });
      return;
    }

    const existing = await db.query(
      "SELECT id FROM chats WHERE buyer_id = $1 AND seller_id = $2 AND service_id = $3",
      [booking.buyer_id, booking.seller_id, booking.service_id]
    );

    if (existing.rowCount) {
      reply.send({ id: existing.rows[0].id });
      return;
    }

    const chatId = randomUUID();
    await db.query(
      "INSERT INTO chats (id, buyer_id, seller_id, service_id) VALUES ($1, $2, $3, $4)",
      [chatId, booking.buyer_id, booking.seller_id, booking.service_id]
    );

    reply.code(201).send({ id: chatId });
  });
}
