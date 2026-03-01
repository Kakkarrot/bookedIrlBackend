import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  FIREBASE_CLIENT_EMAIL: z.string().min(1, "FIREBASE_CLIENT_EMAIL is required"),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_PRIVATE_KEY_BASE64: z.string().optional()
});

export const env = envSchema
  .refine((values) => values.FIREBASE_PRIVATE_KEY || values.FIREBASE_PRIVATE_KEY_BASE64, {
    message: "FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64 is required",
    path: ["FIREBASE_PRIVATE_KEY"]
  })
  .parse(process.env);
