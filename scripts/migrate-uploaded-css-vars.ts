/**
 * One-shot migration: 把 abbey-blue / handcoded-crimson 的 customCss 里
 * 硬编码的 page padding / section gap / item gap 替换成 var() 形式，
 * 让 smart-layout v2 算法压缩对这两个模板物理生效（spec §4.6）。
 *
 * 用 string replace 而不是正则，每条 replacement 失败 (count !== 1) 就
 * fail-fast，避免误伤。先 dry-run 看 diff，再 --apply。
 *
 * Run dry: pnpm exec tsx --env-file=.env.local scripts/migrate-uploaded-css-vars.ts
 * Apply:   pnpm exec tsx --env-file=.env.local scripts/migrate-uploaded-css-vars.ts --apply
 */
import { neon } from "@neondatabase/serverless";

type Replacement = { from: string; to: string };

const MIGRATIONS: Record<string, Replacement[]> = {
  "abbey-blue": [
    {
      from: "padding: 24px 60px 32px;",
      to: "padding: var(--page-padding);",
    },
    {
      from: ".abbey-blue-section { margin-top: 14px; }",
      to: ".abbey-blue-section { margin-top: var(--section-gap); }",
    },
    {
      from: ".abbey-blue-entry + .abbey-blue-entry { padding-top: 6px; }",
      to: ".abbey-blue-entry + .abbey-blue-entry { padding-top: var(--item-gap); }",
    },
  ],
  "handcoded-crimson": [
    {
      from: ".crimson-main { padding: 0 32px 24px; }",
      to: ".crimson-main { padding: 0 var(--page-padding) var(--page-padding); }",
    },
    {
      from: "/* section 间距从 22 压到 14 */\n  .crimson-section { margin-top: 14px; }",
      to: "/* section 间距读 var(--section-gap)，由 smart-layout 算法压缩 */\n  .crimson-section { margin-top: var(--section-gap); }",
    },
    {
      from: ".crimson-entry + .crimson-entry { padding-top: 8px; }",
      to: ".crimson-entry + .crimson-entry { padding-top: var(--item-gap); }",
    },
  ],
};

async function main() {
  const apply = process.argv.includes("--apply");
  const sql = neon(process.env.DATABASE_URL!);

  for (const [id, replacements] of Object.entries(MIGRATIONS)) {
    const rows = (await sql`SELECT "customCss" FROM templates WHERE id = ${id}`) as Array<{
      customCss: string | null;
    }>;
    if (rows.length === 0) {
      console.error(`✗ ${id}: not found in DB`);
      process.exit(1);
    }
    const original = rows[0].customCss ?? "";
    let next = original;
    for (const { from, to } of replacements) {
      const occurrences = next.split(from).length - 1;
      if (occurrences !== 1) {
        console.error(`✗ ${id}: expected 1 occurrence of \`${from.slice(0, 60)}...\`, got ${occurrences}`);
        process.exit(1);
      }
      next = next.replace(from, to);
    }

    console.log(`\n========== ${id} ==========`);
    console.log(`replacements: ${replacements.length} / changes ok`);
    if (next === original) {
      console.log("no-op (already migrated?)");
      continue;
    }

    if (apply) {
      await sql`UPDATE templates SET "customCss" = ${next}, "updatedAt" = now() WHERE id = ${id}`;
      console.log(`✓ ${id} updated`);
    } else {
      console.log(`(dry-run, use --apply to commit)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
