import { FastifyRequest } from "fastify";
import { verifyFirebaseToken } from "./firebase";

export async function requireAuth(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("missing_auth");
  }
  const token = header.replace("Bearer ", "").trim();
  return verifyFirebaseToken(token);
}
