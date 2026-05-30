/**
 * One-shot: applies 0004_bouncy_northstar.sql (template_favorite table) via
 * Neon's HTTP driver, then marks it applied in drizzle's tracker. Bypasses
 * postgres.js TCP, which times out from China to ap-southeast-1 and makes
 * `drizzle-kit migrate` appear to hang. Mirrors apply-templates-migration.ts.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/apply-favorites-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL not set — did you pass --env-file=.env.local?");

const sql = neon(DB_URL);
const MIGRATION_TAG = "0004_bouncy_northstar";

async function main() {
  // 1. Check current state
  const before = await sql`
    SELECT to_regclass('public.template_favorite') AS exists
  ` as Array<{ exists: string | null }>;
  const tableExists = before[0]?.exists !== null;
  console.log(`[1/3] template_favorite exists? ${tableExists ? "yes (skipping)" : "no — will create"}`);

  // 2. Apply migration if needed. The .sql has multiple statements separated
  // by drizzle's --> statement-breakpoint marker; split and run each.
  if (!tableExists) {
    const migrationPath = resolve(process.cwd(), `db/migrations/${MIGRATION_TAG}.sql`);
    const ddl = readFileSync(migrationPath, "utf-8");
    const statements = ddl
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      await sql.query(stmt);
    }
    console.log(`[2/3] applied ${statements.length} statements ✓`);
  } else {
    console.log("[2/3] skipped");
  }

  // 3. Mark migration as applied in drizzle's tracker so future
  // `drizzle-kit migrate` runs don't try to re-create the table.
  if (!tableExists) {
    const journalPath = resolve(process.cwd(), "db/migrations/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);
    if (entry) {
      const migrationContent = readFileSync(
        resolve(process.cwd(), `db/migrations/${MIGRATION_TAG}.sql`),
        "utf-8",
      );
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(migrationContent).digest("hex");
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry.when})
        ON CONFLICT DO NOTHING
      `;
      console.log(`[3/3] marked ${MIGRATION_TAG} as applied ✓`);
    }
  }

  console.log("\n done. template_favorite is ready.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
