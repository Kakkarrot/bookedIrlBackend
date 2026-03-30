import { Pool } from "pg";
import { env } from "../config/env";

export function createPool() {
  return new Pool({
    connectionString: env.DATABASE_URL
  });
}
