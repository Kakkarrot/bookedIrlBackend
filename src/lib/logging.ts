import type { FastifyRequest } from "fastify";

type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

export function logRequestEvent(
  request: FastifyRequest,
  level: LogLevel,
  event: string,
  context: LogContext = {}
) {
  request.log[level](
    {
      event,
      method: request.method,
      url: request.url,
      ...context
    },
    event
  );
}
