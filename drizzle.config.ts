import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first (local dev), fall back to .env (CI / Vercel pull).
config({ path: ".env.local" });
config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Put it in .env.local before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true,
});
