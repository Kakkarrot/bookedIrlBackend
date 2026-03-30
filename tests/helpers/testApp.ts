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
  pool: Awaited<ReturnType<typeof createIntegrationHarness>>["pool"];
};

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
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
    pool: harness.pool,
    close: async () => {
      await app.close();
      await harness.close();
    }
  };
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
  applyTestEnv("postgresql://unused:unused@localhost:5432/unused");

  const { buildServer } = await import("../../src/server");
  const { apiVersion } = await import("../../src/config/apiVersion");

  const app = buildServer({
    pool: createUnusedPoolStub(),
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
    close: async () => {
      await app.close();
    }
  };
}
