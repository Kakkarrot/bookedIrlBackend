import type { FastifyRequest } from "fastify";

type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

type BaseLogger = {
  info: (object: Record<string, unknown>, message?: string) => void;
  warn: (object: Record<string, unknown>, message?: string) => void;
  error: (object: Record<string, unknown>, message?: string) => void;
};

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

export function logComponentEvent(
  logger: BaseLogger,
  level: LogLevel,
  component: string,
  event: string,
  context: LogContext = {}
) {
  logger[level](
    {
      component,
      event,
      ...context
    },
    event
  );
}
