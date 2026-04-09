import "fastify";
import type { Pool } from "pg";
import type { TokenVerifier } from "../auth/firebase";
import type { BookingPushSender } from "../lib/push";
import type { RealtimeBroker } from "../lib/realtimeBroker";

declare module "fastify" {
  interface FastifyInstance {
    dbPool: Pool;
    tokenVerifier: TokenVerifier;
    realtimeBroker: RealtimeBroker;
    bookingPushSender: BookingPushSender;
  }
}
