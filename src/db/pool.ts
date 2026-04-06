import { Pool } from "pg";
import { env } from "../config/env";

function createPool(connectionString: string) {
  return new Pool({
    connectionString
  });
}

export function createAppPool() {
  return createPool(env.DB_POOL_URL);
}

export function createRealtimePool() {
  return createPool(env.DB_DIRECT_URL);
}
