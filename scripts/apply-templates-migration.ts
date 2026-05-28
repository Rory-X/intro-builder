/**
 * One-shot: applies 0001_odd_vindicator.sql via Neon's HTTP driver, then
 * runs the abbey-stub seed and verifies. Bypasses postgres.js TCP, which
 * times out from China to ap-southeast-1 and made `drizzle-kit migrate`
 * appear to hang.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/apply-templates-migration.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL not set — did you pass --env-file=.env.local?");

const sql = neon(DB_URL);

async function main() {
  // 1. Check current state
  const before = await sql`
    SELECT to_regclass('public.templates') AS exists
  ` as Array<{ exists: string | null }>;
  const tableExists = before[0]?.exists !== null;
  console.log(`[1/4] templates table exists? ${tableExists ? "yes (skipping CREATE)" : "no — will create"}`);

  // 2. Apply migration if needed
  if (!tableExists) {
    const migrationPath = resolve(process.cwd(), "db/migrations/0001_odd_vindicator.sql");
    const ddl = readFileSync(migrationPath, "utf-8");
    // Single CREATE TABLE — sql.query() for raw DDL (sql`` is template-only)
    await sql.query(ddl);
    console.log("[2/4] CREATE TABLE templates ✓");
  } else {
    console.log("[2/4] skipped CREATE");
  }

  // 3. Seed abbey-stub
  const existing = await sql`SELECT id FROM templates WHERE id = 'abbey-stub'` as Array<{ id: string }>;
  if (existing.length > 0) {
    console.log("[3/4] abbey-stub already seeded ✓");
  } else {
    await sql`
      INSERT INTO templates (id, name, description, "thumbnailUrl", source, decoration, layout, status, "createdBy")
      VALUES (
        'abbey-stub',
        'Abbey Stub（验证用）',
        'Foundation 验证模板，用现有 professional variant 渲染',
        NULL,
        'uploaded',
        NULL,
        ${JSON.stringify({
          headerVariant: "professional",
          sectionTitleVariant: "professional",
          itemHeaderVariant: "professional",
          theme: { primaryColor: "#137880" },
          sectionIcons: {
            experience: "Briefcase",
            education: "GraduationCap",
            projects: "FolderKanban",
            skills: "Sparkles",
          },
        })}::jsonb,
        'published',
        'seed-script'
      )
    `;
    console.log("[3/4] INSERT abbey-stub ✓");
  }

  // 4. Verify
  const verify = await sql`
    SELECT id, name, source, status FROM templates ORDER BY "createdAt"
  ` as Array<{ id: string; name: string; source: string; status: string }>;
  console.log("[4/4] templates in DB:");
  for (const row of verify) {
    console.log(`  • ${row.id} (${row.source}, ${row.status}) — ${row.name}`);
  }

  // 5. Mark migration as applied in drizzle's tracker so future
  // `drizzle-kit migrate` runs don't try to re-create the table.
  if (!tableExists) {
    const journalPath = resolve(process.cwd(), "db/migrations/meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const entry0001 = journal.entries.find((e) => e.tag === "0001_odd_vindicator");
    if (entry0001) {
      // drizzle's __drizzle_migrations table tracks (hash, created_at)
      const migrationContent = readFileSync(
        resolve(process.cwd(), "db/migrations/0001_odd_vindicator.sql"),
        "utf-8",
      );
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(migrationContent).digest("hex");
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${entry0001.when})
        ON CONFLICT DO NOTHING
      `;
      console.log("[5/5] marked 0001 as applied in drizzle.__drizzle_migrations ✓");
    }
  }

  console.log("\n done. open http://localhost:3000/dashboard and you should see Abbey Stub.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
