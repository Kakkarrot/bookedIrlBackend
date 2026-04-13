import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { requireUser } from "../lib/auth";
import { logRequestEvent } from "../lib/logging";
import {
  buildChatCreatedEvent,
  buildChatMessageCreatedEvent,
  buildChatReadUpdatedEvent
} from "../lib/realtimeEvents";

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

function canonicalPair(leftUserId: string, rightUserId: string) {
  return leftUserId < rightUserId
    ? { participantA: leftUserId, participantB: rightUserId }
    : { participantA: rightUserId, participantB: leftUserId };
}

type ChatParticipantRow = {
  participant_a: string;
  participant_b: string;
};

type ChatSummaryRow = {
  id: string;
  booking_id: string;
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
  is_unseen: boolean;
};

async function listChatsForUser(db: Pool, userId: string, limit: number, offset: number) {
  return db.query(
    `
      SELECT c.id,
             c.booking_id,
             c.last_message_at,
             b.service_title,
             ou.id AS other_user_id,
             ou.display_name AS other_user_display_name,
             ou.username AS other_user_username,
             op.url AS other_user_photo_url,
             lm.body AS last_message_body,
             lm.sender_id AS last_message_sender,
             lm.created_at AS last_message_created_at,
             COALESCE(mu.unread_count, 0) AS unread_count,
             (cr.last_read_at IS NULL) AS is_unseen
      FROM chats c
      JOIN bookings b ON b.id = c.booking_id
      JOIN users ou
        ON ou.id = CASE
          WHEN c.participant_a = $1 THEN c.participant_b
          ELSE c.participant_a
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
      WHERE c.participant_a = $1 OR c.participant_b = $1
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset]
  );
}

async function getAuthorizedChat(db: Pool, chatId: string, userId: string) {
  const chatResult = await db.query<ChatParticipantRow>(
    "SELECT participant_a, participant_b FROM chats WHERE id = $1",
    [chatId]
  );

  if (!chatResult.rowCount) {
    return { error: "chat_not_found" as const };
  }

  const chat = chatResult.rows[0];
  if (chat.participant_a !== userId && chat.participant_b !== userId) {
    return { error: "forbidden" as const };
  }

  return { chat };
}

function serializeChatSummary(row: ChatSummaryRow) {
  return {
    id: row.id,
    booking_id: row.booking_id,
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
    unread_count: Number(row.unread_count),
    is_unseen: row.is_unseen
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
      logRequestEvent(request, "warn", "chat_messages_rejected", {
        reason: authorization.error,
        actor_user_id: auth.userId,
        chat_id: params.id
      });
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
      logRequestEvent(request, "warn", "chat_message_create_rejected", {
        reason: authorization.error,
        actor_user_id: auth.userId,
        chat_id: params.id
      });
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
    const participants = authorization.chat;

    await db.query(
      "UPDATE chats SET last_message_at = $2, updated_at = now() WHERE id = $1",
      [params.id, message.created_at]
    );

    logRequestEvent(request, "info", "chat_message_created", {
      chat_id: params.id,
      message_id: messageId,
      actor_user_id: auth.userId
    });
    void app.realtimeBroker.publish(
      buildChatMessageCreatedEvent({
        chatId: params.id,
        participantUserIds: [participants.participant_a, participants.participant_b],
        messageId,
        senderUserId: auth.userId
      })
    ).catch((error) => {
      request.log.error({
        component: "realtime",
        event: "realtime_publish_failed",
        chat_id: params.id,
        message_id: messageId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    reply.code(201).send(message);
  });

  app.post("/chats/:id/read", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const payload = markReadSchema.parse(request.body ?? {});

    const authorization = await getAuthorizedChat(db, params.id, auth.userId);
    if ("error" in authorization) {
      logRequestEvent(request, "warn", "chat_read_rejected", {
        reason: authorization.error,
        actor_user_id: auth.userId,
        chat_id: params.id
      });
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

    logRequestEvent(request, "info", "chat_marked_read", {
      chat_id: params.id,
      actor_user_id: auth.userId
    });
    void app.realtimeBroker.publish(
      buildChatReadUpdatedEvent({
        chatId: params.id,
        readerUserId: auth.userId
      })
    ).catch((error) => {
      request.log.error({
        component: "realtime",
        event: "realtime_publish_failed",
        chat_id: params.id,
        actor_user_id: auth.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    reply.send({ ok: true });
  });

  app.get("/users/:userId/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const params = userIdParamsSchema.parse(request.params);
    if (params.userId !== auth.userId) {
      logRequestEvent(request, "warn", "chat_list_rejected", {
        reason: "forbidden",
        actor_user_id: auth.userId,
        requested_user_id: params.userId
      });
      reply.code(403).send({ error: "forbidden" });
      return;
    }

    const query = listChatsSchema.parse(request.query);
    const result = await listChatsForUser(db, params.userId, query.limit, query.offset);

    reply.send(result.rows.map(serializeChatSummary));
  });
}
