import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";

import * as schema from "./schema.js";
import { connectionUsesNeonHttpApi } from "./connection.js";

// The build (`tsc`) and module load must not require a live database. Fall soft
// to a placeholder so a missing DATABASE_URL only fails at first actual query.
const url =
  process.env.DATABASE_URL ??
  "postgres://build-placeholder:build-placeholder@localhost:5432/placeholder";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[agent-db] DATABASE_URL not set — using placeholder. Queries will fail at runtime.",
  );
}

type Database = NeonHttpDatabase<typeof schema>;

export const db: Database = connectionUsesNeonHttpApi(url)
  ? drizzleNeon(neon(url), { schema })
  : (drizzlePostgres(
      postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 5) }),
      { schema },
    ) as unknown as Database);

export type AgentDb = typeof db;
