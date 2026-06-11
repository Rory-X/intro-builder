/**
 * Patch abbey-blue and handcoded-crimson templates to add missing slots:
 *   - item.location, item.meta, item.link (in item-tpl)
 *   - section.body (in section-tpl) — REMOVED: causes double-render for skills
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/patch-slot-coverage.ts
 */
import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq } from "drizzle-orm";

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && (err as Error & { cause?: { code?: string; message?: string } }).cause
      ? `${(err as Error & { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${
          (err as Error & { cause?: { code?: string; message?: string } }).cause?.message ?? ""
        }`
      : "";
  return /fetch failed|ECONNRESET|socket disconnected|network socket|TLS|handshake|ConnectTimeout/i.test(
    `${msg} ${causeMsg}`,
  );
}

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 5): Promise<T> {
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === max || !isTransientNetworkError(err)) throw err;
      const delay = 1000 * 2 ** (i - 1);
      console.warn(`  [retry] ${label} attempt ${i}/${max} transient, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

async function patchTemplate(id: string, patchFn: (html: string) => string) {
  const [row] = await withRetry(`select ${id}`, () =>
    db
      .select({ html: templates.html })
      .from(templates)
      .where(eq(templates.id, id)),
  );

  if (!row?.html) {
    console.log(`  [skip] ${id}: no html`);
    return;
  }

  const patched = patchFn(row.html);
  if (patched === row.html) {
    console.log(`  [no-match] ${id}: no changes needed`);
    return;
  }

  await withRetry(`update ${id}`, () =>
    db.update(templates).set({ html: patched }).where(eq(templates.id, id)),
  );
  console.log(`  [ok] ${id}: patched`);
}

function removeSectionBody(html: string): string {
  // Remove the section.body div we added (it causes double-render for skills/custom sections)
  html = html.replace(
    /\s*<div class="abbey-blue-section-body"><slot data-bind="section\.body"><\/slot><\/div>\n?\s*/,
    "\n    ",
  );
  html = html.replace(
    /\s*<div class="crimson-section-body"><slot data-bind="section\.body"><\/slot><\/div>\n?\s*/,
    "\n    ",
  );
  return html;
}

async function main() {
  console.log("Removing section.body (causes double-render for skills)...\n");

  await patchTemplate("abbey-blue", removeSectionBody);
  await patchTemplate("handcoded-crimson", removeSectionBody);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
