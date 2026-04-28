import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

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

const sql = neon(url);
export const db = drizzle(sql, { schema });
export type DB = typeof db;
