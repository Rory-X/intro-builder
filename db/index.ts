import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";
import { connectionUsesNeonHttpApi } from "./connection";

// `next build` collects route handlers by importing them, which transitively
// imports this module. Fail soft during build so a missing DATABASE_URL only
// errors at first actual query — not at module load.
const url =
  process.env.DATABASE_URL ??
  "postgres://build-placeholder:build-placeholder@localhost:5432/placeholder";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[db] DATABASE_URL not set — using placeholder. Queries will fail at runtime.",
  );
}

type Database = NeonHttpDatabase<typeof schema>;

export const db: Database = connectionUsesNeonHttpApi(url)
  ? drizzleNeon(neon(url), { schema })
  : (drizzlePostgres(
      postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) }),
      { schema },
    ) as unknown as Database);
export type DB = typeof db;
