import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createTemporaryPostgresRuntime } from "../../../src/db/postgisRuntime";

export type IntegrationHarness = {
  pool: Pool;
  realtimePool: Pool;
  databaseUrl: string;
  close: () => Promise<void>;
};

type IntegrationRuntime = {
  close: () => Promise<void>;
  createIsolatedDatabase: () => Promise<IntegrationHarness>;
};

let runtimePromise: Promise<IntegrationRuntime> | null = null;

export function applyTestEnv(databaseUrl: string) {
  process.env.NODE_ENV = "test";
  process.env.DB_POOL_URL = databaseUrl;
  process.env.DB_DIRECT_URL = databaseUrl;
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

async function createIntegrationRuntime(): Promise<IntegrationRuntime> {
  const runtime = await createTemporaryPostgresRuntime();
  const templateDatabase = "booked_irl_template";
  const template = await runtime.createDatabaseFromSchema(templateDatabase);
  await template.pool.end();

  return {
    createIsolatedDatabase: async () => {
      const databaseName = `booked_irl_test_${randomUUID().replace(/-/g, "")}`;
      const managedDatabase = await runtime.createDatabaseFromTemplate(databaseName, templateDatabase);
      applyTestEnv(managedDatabase.databaseUrl);

      const realtimePool = new Pool({
        connectionString: managedDatabase.databaseUrl,
        max: 2,
        allowExitOnIdle: true
      });

      let isClosed = false;

      return {
        pool: managedDatabase.pool,
        realtimePool,
        databaseUrl: managedDatabase.databaseUrl,
        close: async () => {
          if (isClosed) {
            return;
          }
          isClosed = true;

          await realtimePool.end();
          await managedDatabase.close();
        }
      };
    },
    close: async () => {
      await runtime.close();
    }
  };
}

async function getRuntime() {
  if (!runtimePromise) {
    runtimePromise = createIntegrationRuntime();
  }

  return runtimePromise;
}

export async function startIntegrationRuntime() {
  await getRuntime();
}

export async function stopIntegrationRuntime() {
  if (!runtimePromise) {
    return;
  }

  const runtime = await runtimePromise;
  runtimePromise = null;
  await runtime.close();
}

export async function createIntegrationHarness(): Promise<IntegrationHarness> {
  const runtime = await getRuntime();
  return runtime.createIsolatedDatabase();
}
