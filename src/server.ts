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

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(helmet);

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(userRoutes);
  app.register(serviceRoutes);
  app.register(bookingRoutes);
  app.register(chatRoutes);
  app.register(notificationRoutes);

  return app;
}
