import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export const storageClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false
  }
});

export const storageBucket = env.SUPABASE_STORAGE_BUCKET;
