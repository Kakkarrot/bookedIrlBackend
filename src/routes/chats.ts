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

const createMessageSchema = z.object({
  body: z.string().min(1).max(2000)
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/chats", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const result = await pool.query(
      `
      SELECT c.id,
             c.buyer_id,
             c.seller_id,
             c.service_id,
             c.last_message_at,
             s.title AS service_title,
             lm.body AS last_message_body,
             lm.sender_id AS last_message_sender,
             lm.created_at AS last_message_created_at
      FROM chats c
      JOIN services s ON s.id = c.service_id
      LEFT JOIN LATERAL (
        SELECT body, sender_id, created_at
        FROM messages m
        WHERE m.chat_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      WHERE c.buyer_id = $1 OR c.seller_id = $1
      ORDER BY c.last_message_at DESC NULLS LAST
      `,
      [auth.userId]
    );

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
}
