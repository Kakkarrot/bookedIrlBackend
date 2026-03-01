import { FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/middleware";
import { getOrCreateUserId } from "../db/users";

export type AuthContext = {
  userId: string;
  token: any;
};

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<AuthContext | null> {
  try {
    const token = await requireAuth(request);
    const userId = await getOrCreateUserId(token);
    return { token, userId };
  } catch (error) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }
}
