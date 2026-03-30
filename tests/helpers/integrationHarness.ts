import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";

type Harness = {
  pool: Pool;
  databaseUrl: string;
  close: () => Promise<void>;
};

const backendDir = path.resolve(__dirname, "../..");
const schemaPath = path.join(backendDir, "src/db/schema.sql");

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
  process.env.DATABASE_URL = databaseUrl;
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

export async function createIntegrationHarness(): Promise<Harness> {
  const database = "booked_irl_test";
  const username = "postgres";
  const password = "postgres";

  const container = await new GenericContainer("postgis/postgis:16-3.4")
    .withEnvironment({
      POSTGRES_DB: database,
      POSTGRES_USER: username,
      POSTGRES_PASSWORD: password
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage("database system is ready to accept connections"))
    .start();

  const databaseUrl = `postgresql://${username}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/${database}`;
  applyTestEnv(databaseUrl);

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000
  });
  const schemaSql = await readFile(schemaPath, "utf8");
  await waitForDatabase(pool);
  await pool.query(schemaSql);

  return {
    pool,
    databaseUrl,
    close: async () => {
      await pool.end();
      await container.stop();
    }
  };
}
