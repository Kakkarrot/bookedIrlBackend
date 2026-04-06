import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { applyTestEnv, createIntegrationHarness } from "./integrationHarness";

export function buildDecodedToken(overrides: Partial<DecodedIdToken> = {}): DecodedIdToken {
  const nowSeconds = Math.floor(Date.now() / 1000);

  return {
    uid: "firebase-user-1",
    aud: "test-project",
    auth_time: nowSeconds,
    exp: nowSeconds + 3600,
    firebase: {
      identities: {},
      sign_in_provider: "google.com"
    },
    iat: nowSeconds,
    iss: "https://securetoken.google.com/test-project",
    sub: "firebase-user-1",
    email: "person@example.com",
    ...overrides
  };
}

type CreateTestAppOptions = {
  tokenVerifier?: (token: string) => Promise<DecodedIdToken>;
};

type TestApp = {
  apiVersion: string;
  app: FastifyInstance;
  close: () => Promise<void>;
  logs: {
    stdout: string[];
    stderr: string[];
  };
  pool: Awaited<ReturnType<typeof createIntegrationHarness>>["pool"];
};

function createProcessOutputCapture() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return originalStdoutWrite(chunk as never, encoding as never, callback as never);
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding, callback?: (error?: Error | null) => void) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return originalStderrWrite(chunk as never, encoding as never, callback as never);
  }) as typeof process.stderr.write;

  return {
    stdout,
    stderr,
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    }
  };
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const outputCapture = createProcessOutputCapture();
  try {
    const harness = await createIntegrationHarness();
    const { buildServer } = await import("../../src/server");
    const { apiVersion } = await import("../../src/config/apiVersion");

    const app = buildServer({
      pool: harness.pool,
      tokenVerifier:
        options.tokenVerifier ??
        (async (token: string) => {
          if (token !== "integration-test-token") {
            throw new Error("invalid_token");
          }

          return buildDecodedToken();
        })
    });

    await app.ready();

    return {
      apiVersion,
      app,
      logs: {
        stdout: outputCapture.stdout,
        stderr: outputCapture.stderr
      },
      pool: harness.pool,
      close: async () => {
        await app.close();
        await harness.close();
        outputCapture.restore();
      }
    };
  } catch (error) {
    outputCapture.restore();
    throw error;
  }
}

function createUnusedPoolStub(): Pool {
  const fail = async () => {
    throw new Error("db_pool_should_not_be_used_in_this_test");
  };

  return {
    query: fail,
    connect: fail
  } as unknown as Pool;
}

export async function createLightweightTestApp(
  options: CreateTestAppOptions = {}
): Promise<Omit<TestApp, "pool">> {
  const outputCapture = createProcessOutputCapture();
  try {
    applyTestEnv("postgresql://unused:unused@localhost:5432/unused");

    const { buildServer } = await import("../../src/server");
    const { createNoopRealtimeBroker } = await import("../../src/lib/realtimeBroker");
    const { apiVersion } = await import("../../src/config/apiVersion");

    const app = buildServer({
      pool: createUnusedPoolStub(),
      realtimeBroker: createNoopRealtimeBroker(),
      tokenVerifier:
        options.tokenVerifier ??
        (async (token: string) => {
          if (token !== "integration-test-token") {
            throw new Error("invalid_token");
          }

          return buildDecodedToken();
        })
    });

    await app.ready();

    return {
      apiVersion,
      app,
      logs: {
        stdout: outputCapture.stdout,
        stderr: outputCapture.stderr
      },
      close: async () => {
        await app.close();
        outputCapture.restore();
      }
    };
  } catch (error) {
    outputCapture.restore();
    throw error;
  }
}
