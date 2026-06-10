import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { neon } from "@neondatabase/serverless";
import { db } from "@/db";
import { templates, type DbTemplate } from "@/db/schema";
import { eq } from "drizzle-orm";

type TemplateBackup = {
  createdAt: string;
  rowCount: number;
  rows: BackupTemplateRow[];
};

type BackupTemplateRow = Omit<DbTemplate, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type PatchResult = {
  id: string;
  name: string;
  changes: string[];
  html: string | null;
  css: string | null;
};

const PATCH_MARKER = "intro-builder template db patch 2026-06";
const PROFILE_TYPOGRAPHY_CSS = `

/* ${PATCH_MARKER}: fixed profile typography boundary */
[data-pagination-header] {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.35;
}
[data-pagination-header] h1,
[data-pagination-header] .name,
[data-pagination-header] [class*="name"] {
  line-height: 1.15;
}
[data-pagination-header] [class*="title"],
[data-pagination-header] [class*="subtitle"],
[data-pagination-header] [class*="status"],
[data-pagination-header] [class*="contact"] {
  line-height: 1.35;
}
.item-link:empty {
  display: none;
}
.item-link:not(:empty) {
  margin-left: 0.75em;
  color: inherit;
  text-decoration: none;
  overflow-wrap: anywhere;
}
`;

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function getSql() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail("DATABASE_URL not set; pass --env-file=.env.local to tsx");
  return neon(dbUrl);
}

function toBackupRow(row: DbTemplate): BackupTemplateRow {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fromBackupRow(row: BackupTemplateRow): DbTemplate {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

async function backupTemplates(outputDir: string): Promise<string> {
  const rows = await db.select().from(templates);
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(outputDir, `templates-${stamp}-before-batch.json`);
  const payload: TemplateBackup = {
    createdAt: new Date().toISOString(),
    rowCount: rows.length,
    rows: rows.map(toBackupRow),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Backup written: ${file}`);
  console.log(`Rows: ${rows.length}`);
  return file;
}

async function restoreTemplates(file: string): Promise<void> {
  const raw = readFileSync(file, "utf8");
  const payload = JSON.parse(raw) as TemplateBackup;
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
    fail(`invalid backup file: ${file}`);
  }

  const sql = getSql();
  await sql.transaction(
    payload.rows.map((backupRow) => {
      const row = fromBackupRow(backupRow);
      return sql`
        INSERT INTO templates (
          id, name, description, "thumbnailUrl", category, features,
          html, css, "sectionIcons", "defaultStyleSettings", "bannerImageUrl",
          "isDefault", status, "createdAt", "updatedAt"
        ) VALUES (
          ${row.id}, ${row.name}, ${row.description}, ${row.thumbnailUrl},
          ${row.category}, ${row.features ? JSON.stringify(row.features) : null}::jsonb,
          ${row.html}, ${row.css},
          ${row.sectionIcons ? JSON.stringify(row.sectionIcons) : null}::jsonb,
          ${row.defaultStyleSettings ? JSON.stringify(row.defaultStyleSettings) : null}::jsonb,
          ${row.bannerImageUrl}, ${row.isDefault}, ${row.status},
          ${row.createdAt}, ${row.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          "thumbnailUrl" = EXCLUDED."thumbnailUrl",
          category = EXCLUDED.category,
          features = EXCLUDED.features,
          html = EXCLUDED.html,
          css = EXCLUDED.css,
          "sectionIcons" = EXCLUDED."sectionIcons",
          "defaultStyleSettings" = EXCLUDED."defaultStyleSettings",
          "bannerImageUrl" = EXCLUDED."bannerImageUrl",
          "isDefault" = EXCLUDED."isDefault",
          status = EXCLUDED.status,
          "createdAt" = EXCLUDED."createdAt",
          "updatedAt" = EXCLUDED."updatedAt"
      `;
    }),
  );

  console.log(`Restored ${payload.rows.length} templates from ${file}`);
}

function patchModernHtml(html: string, changes: string[]): string {
  let next = html;
  if (!/data-bind=["'](?:profile|basics)\.title["']/.test(next)) {
    next = next.replace(
      '<div class="modern-subtitle"><slot data-bind="basics.status"></slot></div>',
      '<div class="modern-subtitle"><slot data-bind="profile.title"></slot><span class="modern-status"><slot data-bind="profile.status"></slot></span></div>',
    );
    if (next !== html) changes.push("modern: add profile.title/status header slots");
  }
  if (!/data-bind=["']item\.location["']/.test(next)) {
    next = next.replace(
      '<div class="modern-item-subtitle"><slot data-bind="item.subtitle"></slot></div>',
      '<div class="modern-item-subtitle"><slot data-bind="item.subtitle"></slot><span class="modern-item-location"><slot data-bind="item.location"></slot></span></div>',
    );
    if (next !== html) changes.push("modern: add item.location slot");
  }
  return next;
}

function patchClassicHtml(html: string, changes: string[]): string {
  let next = html;
  if (!/data-bind=["'](?:profile|basics)\.status["']/.test(next)) {
    next = next.replace(
      '<div class="classic-title"><slot data-bind="profile.title"></slot></div>',
      '<div class="classic-title"><slot data-bind="profile.title"></slot><span class="classic-status"><slot data-bind="profile.status"></slot></span></div>',
    );
    if (next !== html) changes.push("classic: add profile.status header slot");
  }
  return next;
}

function patchItemLinkHtml(html: string, changes: string[]): string {
  if (/data-bind=["']item\.link["']/.test(html)) return html;
  const next = html.replace(
    '<slot data-bind="item.meta"></slot>',
    '<slot data-bind="item.meta"></slot><a class="item-link"><slot data-bind="item.link"></slot></a>',
  );
  if (next !== html) {
    changes.push("add item.link slot near item.meta");
  }
  return next;
}

function patchSectionTitleLineHeight(css: string, changes: string[]): string {
  const patched = css.replace(/([^{}]*section-title[^{}]*)\{([^{}]*)\}/g, (block, selector: string, body: string) => {
    if (selector.includes("data-pagination-header")) return block;
    if (/line-height\s*:\s*var\(--(?:body-)?line-height\)/.test(body)) {
      changes.push("replace section title variable line-height");
      return `${selector}{${body.replace(/line-height\s*:\s*var\(--(?:body-)?line-height\)\s*;?/g, "line-height: 1.15;")}}`;
    }
    if (/line-height\s*:/.test(body)) return block;
    if (!/font-size\s*:/.test(body)) return block;
    changes.push("add fixed section title line-height");
    return `${selector}{${body.replace(/(font-size\s*:[^;]+;?)/, "$1\n  line-height: 1.15;")}}`;
  });
  return patched;
}

function patchTemplate(row: DbTemplate): PatchResult | null {
  const changes: string[] = [];
  let html = row.html;
  let css = row.css;

  if (html) {
    if (row.id === "modern") html = patchModernHtml(html, changes);
    if (row.id === "classic") html = patchClassicHtml(html, changes);
    html = patchItemLinkHtml(html, changes);
  }

  if (css) {
    const beforeSectionTitle = css;
    css = patchSectionTitleLineHeight(css, changes);
    if (css !== beforeSectionTitle && !changes.includes("add fixed section title line-height")) {
      changes.push("normalize section title line-height");
    }

    if (!css.includes(PATCH_MARKER)) {
      css = `${css.trimEnd()}${PROFILE_TYPOGRAPHY_CSS}`;
      changes.push("append profile typography and empty item-link CSS");
    }

    if (row.id === "modern" && !css.includes(".modern-status:not(:empty)::before")) {
      css += `

.modern-status:not(:empty)::before,
.modern-item-location:not(:empty)::before {
  content: " · ";
}
`;
      changes.push("modern: add title/status/location separators");
    }

    if (row.id === "classic" && !css.includes(".classic-status:not(:empty)::before")) {
      css += `

.classic-status:not(:empty)::before {
  content: " · ";
}
`;
      changes.push("classic: add title/status separator");
    }
  }

  if (changes.length === 0) return null;
  return { id: row.id, name: row.name, changes: Array.from(new Set(changes)), html, css };
}

async function patchTemplates(apply: boolean): Promise<void> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.status, "published"));
  const patches = rows
    .map(patchTemplate)
    .filter((patch): patch is PatchResult => patch !== null);

  if (patches.length === 0) {
    console.log("No template changes needed.");
    return;
  }

  console.log(`${apply ? "Applying" : "Dry-run"} ${patches.length} template row patch(es):`);
  for (const patch of patches) {
    console.log(`  ${patch.id} (${patch.name})`);
    for (const change of patch.changes) console.log(`    - ${change}`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to update the database.");
    return;
  }

  const sql = getSql();
  await sql.transaction(
    patches.map((patch) => sql`
      UPDATE templates
      SET html = ${patch.html}, css = ${patch.css}, "updatedAt" = now()
      WHERE id = ${patch.id}
    `),
  );

  console.log(`Applied ${patches.length} template row patch(es).`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      backup: { type: "boolean" },
      apply: { type: "boolean" },
      restore: { type: "string" },
      "output-dir": { type: "string" },
    },
    strict: true,
  });

  const outputDir = values["output-dir"] ?? "backups";
  if (values.restore) {
    await restoreTemplates(values.restore);
    return;
  }
  if (values.backup) {
    await backupTemplates(outputDir);
    return;
  }
  await patchTemplates(Boolean(values.apply));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
