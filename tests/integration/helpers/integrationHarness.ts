import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";

export type IntegrationHarness = {
  pool: Pool;
  realtimePool: Pool;
  databaseUrl: string;
  close: () => Promise<void>;
};

type IntegrationRuntime = {
  adminPool: Pool;
  close: () => Promise<void>;
  createIsolatedDatabase: () => Promise<IntegrationHarness>;
};

const backendDir = path.resolve(__dirname, "../../..");
const schemaPath = path.join(backendDir, "src/db/schema.sql");
const templateDatabase = "booked_irl_template";

let runtimePromise: Promise<IntegrationRuntime> | null = null;

async function waitForNoDatabaseConnections(
  adminPool: Pool,
  databaseName: string,
  attempts = 50,
  delayMs = 100
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await adminPool.query<{ active_connections: string }>(
      `
      SELECT COUNT(*)::text AS active_connections
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
      `,
      [databaseName]
    );

    if (Number(result.rows[0]?.active_connections ?? "0") === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`isolated_test_database_did_not_quiesce:${databaseName}`);
}

async function waitForDatabase(pool: Pool, attempts = 30, delayMs = 1000) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Database never became ready");
}

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

function buildDatabaseUrl(baseDatabaseUrl: string, databaseName: string) {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function bootstrapTemplateDatabase(adminPool: Pool, baseDatabaseUrl: string) {
  const schemaSql = await readFile(schemaPath, "utf8");

  await adminPool.query(`DROP DATABASE IF EXISTS ${templateDatabase}`);
  await adminPool.query(`CREATE DATABASE ${templateDatabase}`);

  const templatePool = new Pool({
    connectionString: buildDatabaseUrl(baseDatabaseUrl, templateDatabase),
    connectionTimeoutMillis: 2000,
    max: 1
  });

  try {
    await waitForDatabase(templatePool);
    await templatePool.query(schemaSql);
  } finally {
    await templatePool.end();
  }
}

async function createIntegrationRuntime(): Promise<IntegrationRuntime> {
  const username = "postgres";
  const password = "postgres";

  const container = await new GenericContainer("postgis/postgis:16-3.4")
    .withEnvironment({
      POSTGRES_DB: "postgres",
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password
    })
    .withExposedPorts(5432)
    .withStartupTimeout(120_000)
    .withWaitStrategy(
      Wait.forAll([
        Wait.forListeningPorts(),
        Wait.forLogMessage("database system is ready to accept connections")
      ])
    )
    .start();

  const baseDatabaseUrl = `postgresql://${username}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;

  const adminPool = new Pool({
    connectionString: baseDatabaseUrl,
    connectionTimeoutMillis: 2000,
    max: 8,
    allowExitOnIdle: true
  });

  await waitForDatabase(adminPool);
  await bootstrapTemplateDatabase(adminPool, baseDatabaseUrl);

  return {
    adminPool,
    createIsolatedDatabase: async () => {
      const databaseName = `booked_irl_test_${randomUUID().replace(/-/g, "")}`;
      await adminPool.query(`CREATE DATABASE ${databaseName} TEMPLATE ${templateDatabase}`);

      const databaseUrl = buildDatabaseUrl(baseDatabaseUrl, databaseName);
      applyTestEnv(databaseUrl);

      const pool = new Pool({
        connectionString: databaseUrl,
        allowExitOnIdle: true
      });
      const realtimePool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        allowExitOnIdle: true
      });

      let isClosed = false;

      return {
        pool,
        realtimePool,
        databaseUrl,
        close: async () => {
          if (isClosed) {
            return;
          }
          isClosed = true;

          await Promise.all([realtimePool.end(), pool.end()]);
          await waitForNoDatabaseConnections(adminPool, databaseName);
          await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        }
      };
    },
    close: async () => {
      await adminPool.end();
      await container.stop();
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
