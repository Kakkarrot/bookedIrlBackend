import type { DecodedIdToken } from "firebase-admin/auth";

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

function applyLightweightTestEnv() {
  process.env.NODE_ENV = "test";
  process.env.DB_POOL_URL = "postgresql://unused:unused@localhost:5432/unused";
  process.env.DB_DIRECT_URL = "postgresql://unused:unused@localhost:5432/unused";
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? "test-project";
  process.env.FIREBASE_CLIENT_EMAIL =
    process.env.FIREBASE_CLIENT_EMAIL ?? "test@example.com";
  process.env.FIREBASE_PRIVATE_KEY =
    process.env.FIREBASE_PRIVATE_KEY ?? "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";
  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key";
  process.env.SUPABASE_STORAGE_BUCKET =
    process.env.SUPABASE_STORAGE_BUCKET ?? "test-bucket";
}

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

export async function createLightweightTestApp(options: CreateTestAppOptions = {}) {
  const outputCapture = createProcessOutputCapture();

  try {
    applyLightweightTestEnv();

    const { buildServer } = await import("../../../src/server");
    const { createNoopRealtimeBroker } = await import("../../../src/lib/realtimeBroker");
    const { apiVersion } = await import("../../../src/config/apiVersion");

    const app = buildServer({
      pool: {
        query: async () => {
          throw new Error("db_pool_should_not_be_used_in_this_test");
        },
        connect: async () => {
          throw new Error("db_pool_should_not_be_used_in_this_test");
        }
      } as never,
      realtimeBroker: createNoopRealtimeBroker(),
      bookingPushSender: async () => {},
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
