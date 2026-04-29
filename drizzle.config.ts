import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first (local dev), fall back to .env (CI / Vercel pull).
config({ path: ".env.local" });
config({ path: ".env" });

// Prefer the direct (unpooled) connection when available — drizzle-kit
// requires a direct Postgres connection, not the pgbouncer-pooled URL that
// @neondatabase/serverless uses at runtime. Vercel's Neon integration injects
// DATABASE_URL_UNPOOLED automatically; fall back to DATABASE_URL locally.
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error(
    "DATABASE_URL is not set. Put it in .env.local (dev) or Vercel env (prod) before running drizzle-kit.",
  );
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true,
});
