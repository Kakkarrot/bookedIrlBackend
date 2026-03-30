import { FastifyRequest } from "fastify";

export async function requireAuth(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("missing_auth");
  }
  const token = header.replace("Bearer ", "").trim();
  return request.server.tokenVerifier(token);
}
