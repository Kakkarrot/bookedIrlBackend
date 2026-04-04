import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth";
import { logRequestEvent } from "../lib/logging";

const registerPushTokenSchema = z.object({
  deviceToken: z.string().trim().min(32).max(512),
  environment: z.enum(["development", "production"])
});

export async function pushRoutes(app: FastifyInstance) {
  const db = app.dbPool;

  app.post("/push/register", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    const payload = registerPushTokenSchema.parse(request.body);

    await db.query(
      `
      INSERT INTO push_device_tokens (id, user_id, device_token, platform, environment)
      VALUES ($1, $2, $3, 'ios', $4)
      ON CONFLICT (device_token)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        environment = EXCLUDED.environment,
        updated_at = now()
      `,
      [randomUUID(), auth.userId, payload.deviceToken, payload.environment]
    );

    logRequestEvent(request, "info", "push_token_registered", {
      component: "push",
      actor_user_id: auth.userId,
      environment: payload.environment
    });

    reply.send({ ok: true });
  });
}
