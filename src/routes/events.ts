import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyReply } from "fastify";
import { requireUser } from "../lib/auth";
import { encodeSseEvent, type ClientRealtimeEvent } from "../lib/realtimeEvents";

const heartbeatIntervalMs = 25_000;

function writeSseEvent(reply: FastifyReply, event: ClientRealtimeEvent) {
  reply.raw.write(encodeSseEvent(event));
}

export async function eventRoutes(app: FastifyInstance) {
  app.get("/events/stream", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.code(200);
    reply.hijack();

    const subscription = app.realtimeBroker.subscribe(auth.userId, (event) => {
      writeSseEvent(reply, event);
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: {"id":"${randomUUID()}"}\n\n`);
    }, heartbeatIntervalMs);

    request.log.info({
      component: "realtime",
      event: "realtime_stream_connected",
      actor_user_id: auth.userId
    });

    reply.raw.write(
      `event: ready\ndata: ${JSON.stringify({
        id: randomUUID(),
        type: "ready",
        occurred_at: new Date().toISOString()
      })}\n\n`
    );

    let isClosed = false;
    const cleanup = () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      clearInterval(heartbeat);
      subscription.close();
      request.log.info({
        component: "realtime",
        event: "realtime_stream_disconnected",
        actor_user_id: auth.userId
      });
    };

    request.raw.once("close", cleanup);
    request.raw.once("error", cleanup);
  });
}
