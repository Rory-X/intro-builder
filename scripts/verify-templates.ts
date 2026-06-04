/**
 * Verifies the DB-template pipeline end-to-end without UI / auth:
 *   1. listUploadedTemplates() reads from DB
 *   2. listAllTemplatesAsync() returns published DB rows
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts
 */
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { listAllTemplatesAsync } from "@/lib/templates/registry-server";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

const REQUIRED_CORE_ROWS = ["professional", "classic", "modern"] as const;

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && (err as Error & { cause?: { code?: string; message?: string } }).cause
      ? `${(err as Error & { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${
          (err as Error & { cause?: { code?: string; message?: string } }).cause?.message ?? ""
        }`
      : "";
  return /fetch failed|ECONNRESET|socket disconnected|network socket|TLS|handshake/i.test(
    `${msg} ${causeMsg}`,
  );
}

async function withTransientRetry<T>(label: string, fn: () => Promise<T>, max = 5): Promise<T> {
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === max || !isTransientNetworkError(err)) throw err;
      const delay = 500 * 2 ** (i - 1);
      console.warn(`[verify-templates] ${label} attempt ${i}/${max} transient, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const requiredRows = await withTransientRetry("required rows", () =>
    db
      .select({
        id: templates.id,
        name: templates.name,
        status: templates.status,
        html: templates.html,
        css: templates.css,
        sectionIcons: templates.sectionIcons,
        defaultStyleSettings: templates.defaultStyleSettings,
        isDefault: templates.isDefault,
      })
      .from(templates)
      .where(inArray(templates.id, [...REQUIRED_CORE_ROWS])),
  );

  const rowsById = new Map(requiredRows.map((row) => [row.id, row]));
  for (const id of REQUIRED_CORE_ROWS) {
    const row = rowsById.get(id);
    if (!row) fail(`missing template row: ${id}`);
    if (row.status !== "published") fail(`${id} is not published`);
    if (!row.html) fail(`${id} has empty html`);
    if (!row.css) fail(`${id} has empty css`);
    if (row.sectionIcons == null) fail(`${id} has null sectionIcons`);
    if (row.defaultStyleSettings == null) fail(`${id} has null defaultStyleSettings`);
  }

  const defaultRows = await withTransientRetry("default rows", () =>
    db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.isDefault, true)),
  );
  if (defaultRows.length !== 1 || defaultRows[0]?.id !== "professional") {
    fail(
      `expected exactly one default template: professional; got ${
        defaultRows.map((row) => row.id).join(", ") || "(none)"
      }`,
    );
  }

  console.log("required template rows: ok");
  console.log("default template: professional");

  const uploaded = await listUploadedTemplates();
  console.log(`listUploadedTemplates: ${uploaded.length} row(s)`);
  for (const u of uploaded) {
    console.log(`  • ${u.id}  ${u.name}  html=${u.html ? "yes" : "null"}`);
  }

  const all = await listAllTemplatesAsync();
  console.log(`\nlistAllTemplatesAsync: ${all.length} item(s)`);
  for (const t of all) {
    console.log(`  • ${t.id}  source=${t.source}  ${t.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
