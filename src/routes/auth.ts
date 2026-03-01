import { FastifyInstance } from "fastify";
import { requireUser } from "../lib/auth";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/session", async (request, reply) => {
    const auth = await requireUser(request, reply);
    if (!auth) return;

    reply.send({ userId: auth.userId });
  });
}
