import dotenv from "dotenv";
import { Pool } from "pg";
import { createTemporaryPostgresRuntime } from "../src/db/postgisRuntime";
import { diffSchemaManifest } from "../src/db/schemaManifestDiff";
import { readSchemaManifest } from "../src/db/schemaManifest";

dotenv.config();

const defaultIgnoredRemoteOnlyExtensions = new Set([
  "pg_graphql",
  "pg_stat_statements",
  "pgcrypto",
  "supabase_vault",
  "uuid-ossp"
]);

function getRemoteDatabaseUrl() {
  const databaseUrl = process.env.SCHEMA_DRIFT_REMOTE_URL ?? process.env.DB_DIRECT_URL;

  if (!databaseUrl) {
    throw new Error("SCHEMA_DRIFT_REMOTE_URL or DB_DIRECT_URL is required for schema drift checks.");
  }

  return databaseUrl;
}

async function main() {
  const remoteDatabaseUrl = getRemoteDatabaseUrl();
  const runtime = await createTemporaryPostgresRuntime();
  const localDatabase = await runtime.createDatabaseFromSchema("booked_irl_schema_drift_local");
  const remotePool = new Pool({
    connectionString: remoteDatabaseUrl,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true
  });

  try {
    const [localManifest, remoteManifest] = await Promise.all([
      readSchemaManifest(localDatabase.pool),
      readSchemaManifest(remotePool)
    ]);

    const filteredDiffs = diffSchemaManifest(localManifest, remoteManifest, {
      ignoreRemoteOnlyExtensions: defaultIgnoredRemoteOnlyExtensions
    });

    if (filteredDiffs.length === 0) {
      console.log("Schema drift check passed: remote schema matches local src/db/schema.sql.");
      return;
    }

    console.error("Schema drift detected between local schema.sql and remote database:");
    for (const diff of filteredDiffs) {
      console.error(`- ${diff}`);
    }

    process.exitCode = 1;
  } finally {
    await Promise.allSettled([remotePool.end(), localDatabase.close()]);
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(
    `Schema drift check failed to run: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
