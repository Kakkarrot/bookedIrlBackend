import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { serviceRoutes } from "./routes/services";
import { bookingRoutes } from "./routes/bookings";
import { chatRoutes } from "./routes/chats";
import { notificationRoutes } from "./routes/notifications";
import { apiVersion } from "./config/apiVersion";
import { openapiRoutes } from "./routes/openapi";
import { headlineRoutes } from "./routes/headlines";
import { uploadRoutes } from "./routes/uploads";
import { ZodError } from "zod";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(helmet);

  app.addHook("onRequest", (request, reply, done) => {
    if (request.url.startsWith("/health") || request.url.startsWith("/openapi.yaml")) {
      done();
      return;
    }
    const clientVersion = request.headers["x-api-version"];
    if (clientVersion !== apiVersion) {
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
  app.register(notificationRoutes);
  app.register(openapiRoutes);
  app.register(headlineRoutes);
  app.register(uploadRoutes);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: "validation_error",
        details: error.errors
      });
      return;
    }
    reply.send(error);
  });

  return app;
}
