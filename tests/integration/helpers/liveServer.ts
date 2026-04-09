import type { FastifyInstance } from "fastify";

type EventStreamConnection = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  close: () => Promise<void>;
};

type LiveServerHarness = {
  openEventStream: (authToken: string, apiVersion: string) => Promise<EventStreamConnection>;
  close: () => Promise<void>;
};

export async function createLiveServerHarness(app: FastifyInstance): Promise<LiveServerHarness> {
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const abortControllers = new Set<AbortController>();

  return {
    openEventStream: async (authToken: string, apiVersion: string) => {
      const controller = new AbortController();
      abortControllers.add(controller);

      const response = await fetch(`${address}/events/stream`, {
        headers: {
          authorization: `Bearer ${authToken}`,
          "x-api-version": apiVersion
        },
        signal: controller.signal
      });

      if (!response.body) {
        controller.abort();
        abortControllers.delete(controller);
        throw new Error("SSE stream response body was missing");
      }

      const reader = response.body.getReader();

      return {
        reader,
        close: async () => {
          await Promise.allSettled([reader.cancel(), Promise.resolve().then(() => controller.abort())]);
          abortControllers.delete(controller);
        }
      };
    },
    close: async () => {
      for (const controller of abortControllers) {
        controller.abort();
      }
      abortControllers.clear();
      app.server.closeIdleConnections?.();
      app.server.closeAllConnections?.();
    }
  };
}
