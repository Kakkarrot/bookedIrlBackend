import Fastify from "fastify";
import type { Pool } from "pg";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { serviceRoutes } from "./routes/services";
import { bookingRoutes } from "./routes/bookings";
import { chatRoutes } from "./routes/chats";
import { pushRoutes } from "./routes/push";
import { eventRoutes } from "./routes/events";
import { apiVersion } from "./config/apiVersion";
import { openapiRoutes } from "./routes/openapi";
import { headlineRoutes } from "./routes/headlines";
import { uploadRoutes } from "./routes/uploads";
import { ZodError } from "zod";
import { createAppPool, createRealtimePool } from "./db/pool";
import { type TokenVerifier, verifyFirebaseToken } from "./auth/firebase";
import { logRequestEvent } from "./lib/logging";
import { createRealtimeBroker, type RealtimeBroker } from "./lib/realtimeBroker";

type BuildServerOptions = {
  pool?: Pool;
  realtimePool?: Pool;
  tokenVerifier?: TokenVerifier;
  realtimeBroker?: RealtimeBroker;
};

export function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: true });
  const ownsAppPool = !options.pool;
  const ownsRealtimePool = !options.realtimePool && !options.realtimeBroker;
  const appPool = options.pool ?? createAppPool();
  const realtimePool = options.realtimePool ?? options.pool ?? createRealtimePool();

  app.decorate("dbPool", appPool);
  app.decorate("tokenVerifier", options.tokenVerifier ?? verifyFirebaseToken);
  app.decorate(
    "realtimeBroker",
    options.realtimeBroker ?? createRealtimeBroker(realtimePool, app.log)
  );

  app.register(cors, { origin: true });
  app.register(helmet);

  app.addHook("onReady", async () => {
    await app.realtimeBroker.start();
  });

  app.addHook("onClose", async () => {
    await app.realtimeBroker.stop();
    if (ownsRealtimePool) {
      await realtimePool.end();
    }
    if (ownsAppPool) {
      await appPool.end();
    }
  });

  app.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/health") || request.url.startsWith("/openapi.yaml")) {
      done();
      return;
    }
    const clientVersion = request.headers["x-api-version"];
    if (clientVersion !== apiVersion) {
      logRequestEvent(request, "warn", "client_version_mismatch", {
        client_version: clientVersion ?? null,
        current_version: apiVersion
      });
      reply.status(426).send({
        error: "client_out_of_date",
        current_version: apiVersion,
        client_version: clientVersion ?? null
      });
      return;
    }
    done();
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(serviceRoutes);
  app.register(bookingRoutes);
  app.register(chatRoutes);
  app.register(pushRoutes);
  app.register(eventRoutes);
  app.register(openapiRoutes);
  app.register(headlineRoutes);
  app.register(uploadRoutes);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      logRequestEvent(request, "warn", "validation_error", {
        details: error.errors
      });
      reply.status(400).send({
        error: "validation_error",
        details: error.errors
      });
      return;
    }

    logRequestEvent(request, "error", "request_failed", {
      error: error instanceof Error ? error.message : String(error)
    });

    reply.send(error);
  });

  return app;
}
