import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";

export type TemporaryPostgresDatabase = {
  databaseUrl: string;
  pool: Pool;
  close: () => Promise<void>;
};

export type TemporaryPostgresRuntime = {
  baseDatabaseUrl: string;
  createDatabaseFromSchema: (databaseName: string) => Promise<TemporaryPostgresDatabase>;
  createDatabaseFromTemplate: (
    databaseName: string,
    templateDatabaseName: string
  ) => Promise<TemporaryPostgresDatabase>;
  close: () => Promise<void>;
};

const schemaPath = path.resolve(__dirname, "schema.sql");

function buildDatabaseUrl(baseDatabaseUrl: string, databaseName: string) {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function escapeIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
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

  throw lastError instanceof Error ? lastError : new Error("database_never_became_ready");
}

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

  throw new Error(`temporary_database_did_not_quiesce:${databaseName}`);
}

export async function createTemporaryPostgresRuntime(): Promise<TemporaryPostgresRuntime> {
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

  const createManagedDatabase = async (
    databaseName: string,
    options: {
      templateDatabaseName?: string;
      applySchema?: boolean;
    } = {}
  ): Promise<TemporaryPostgresDatabase> => {
    const escapedDatabaseName = escapeIdentifier(databaseName);
    const databaseUrl = buildDatabaseUrl(baseDatabaseUrl, databaseName);

    if (options.templateDatabaseName) {
      await adminPool.query(
        `CREATE DATABASE ${escapedDatabaseName} TEMPLATE ${escapeIdentifier(options.templateDatabaseName)}`
      );
    } else {
      await adminPool.query(`DROP DATABASE IF EXISTS ${escapedDatabaseName}`);
      await adminPool.query(`CREATE DATABASE ${escapedDatabaseName}`);
    }

    const pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 2000,
      allowExitOnIdle: true
    });

    try {
      await waitForDatabase(pool);

      if (options.applySchema) {
        const schemaSql = await readFile(schemaPath, "utf8");
        await pool.query(schemaSql);
      }
    } catch (error) {
      await pool.end();
      await adminPool.query(`DROP DATABASE IF EXISTS ${escapedDatabaseName}`);
      throw error;
    }

    let isClosed = false;

    return {
      databaseUrl,
      pool,
      close: async () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        await pool.end();
        await waitForNoDatabaseConnections(adminPool, databaseName);
        await adminPool.query(`DROP DATABASE IF EXISTS ${escapedDatabaseName}`);
      }
    };
  };

  return {
    baseDatabaseUrl,
    createDatabaseFromSchema: (databaseName: string) =>
      createManagedDatabase(databaseName, { applySchema: true }),
    createDatabaseFromTemplate: (databaseName: string, templateDatabaseName: string) =>
      createManagedDatabase(databaseName, { templateDatabaseName }),
    close: async () => {
      await adminPool.end();
      await container.stop();
    }
  };
}
