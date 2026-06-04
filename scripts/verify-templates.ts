/**
 * Verifies the DB-template pipeline end-to-end without UI / auth:
 *   1. listUploadedTemplates() reads from DB
 *   2. listAllTemplatesAsync() merges built-in + uploaded
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts
 */
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { listAllTemplatesAsync } from "@/lib/templates/registry-server";

async function main() {
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
