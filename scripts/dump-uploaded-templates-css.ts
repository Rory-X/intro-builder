/**
 * Dump customCss + customHtml of v2 uploaded templates to stdout for migration
 * to var(--page-padding/--section-gap/--item-gap) form.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/dump-uploaded-templates-css.ts
 */
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`
    SELECT id, name, "customHtml", "customCss"
    FROM templates
    WHERE source = 'uploaded' AND "customHtml" IS NOT NULL
    ORDER BY id
  ` as Array<{ id: string; name: string; customHtml: string | null; customCss: string | null }>;

  for (const r of rows) {
    console.log(`\n========== ${r.id} (${r.name}) ==========`);
    console.log(`--- customHtml ---`);
    console.log(r.customHtml ?? "(null)");
    console.log(`\n--- customCss ---`);
    console.log(r.customCss ?? "(null)");
  }
  console.log(`\n${rows.length} templates dumped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
