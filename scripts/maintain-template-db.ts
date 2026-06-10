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
const SECTION_BODY_PATCH_MARKER = "intro-builder template db patch 2026-06 section.body";
const SECTION_SPLIT_PATCH_MARKER = "intro-builder template db patch 2026-06 section split";
const CRIMSON_ITEM_LAYOUT_PATCH_MARKER = "intro-builder template db patch 2026-06 crimson item layout";
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
const SECTION_BODY_CSS = `

/* ${SECTION_BODY_PATCH_MARKER}: block section body slot */
.section-body {
  font-size: var(--font-size);
  line-height: var(--body-line-height);
}
.section-body:empty {
  display: none;
}
`;
const CRIMSON_ITEM_LAYOUT_CSS = `

/* ${CRIMSON_ITEM_LAYOUT_PATCH_MARKER}: align item meta/link and role/location rows with crimson */
.item-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.item-title {
  min-width: 0;
}
.item-date {
  text-align: right;
  flex-shrink: 0;
  white-space: nowrap;
}
.item-meta-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
  font-size: calc(var(--font-size) * 0.92);
  line-height: var(--line-height);
}
.item-meta {
  min-width: 0;
  overflow-wrap: anywhere;
}
.item-link {
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}
.item-subtitle {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
}
.item-role {
  min-width: 0;
}
.item-location {
  margin-left: auto;
  text-align: right;
  flex-shrink: 0;
  white-space: nowrap;
}
.item-meta:empty,
.item-link:empty,
.item-role:empty,
.item-location:empty {
  display: none;
}
.item-meta-row:has(.item-meta:empty):has(.item-link:empty) {
  display: none;
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
  if (!/data-bind=["'](?:basic|profile|basics)\.title["']/.test(next)) {
    next = next.replace(
      '<div class="modern-subtitle"><slot data-bind="basics.status"></slot></div>',
      '<div class="modern-subtitle"><slot data-bind="basic.title"></slot><span class="modern-status"><slot data-bind="basic.status"></slot></span></div>',
    );
    if (next !== html) changes.push("modern: add basic.title/status header slots");
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
  if (!/data-bind=["'](?:basic|profile|basics)\.status["']/.test(next)) {
    next = next.replace(
      '<div class="classic-title"><slot data-bind="profile.title"></slot></div>',
      '<div class="classic-title"><slot data-bind="basic.title"></slot><span class="classic-status"><slot data-bind="basic.status"></slot></span></div>',
    );
    if (next !== html) changes.push("classic: add basic.status header slot");
  }
  return next;
}

function patchSlotProtocolHtml(html: string, changes: string[]): string {
  let next = html;

  const replacements: Array<[RegExp, string, string]> = [
    [/data-bind=(["'])(?:profile|basics)\.photo\1/g, 'data-bind="basic.photo"', "rename photo binding to basic.photo"],
    [/data-bind=(["'])(?:profile|basics)\.name\1/g, 'data-bind="basic.name"', "rename name binding to basic.name"],
    [/data-bind=(["'])(?:profile|basics)\.title\1/g, 'data-bind="basic.title"', "rename title binding to basic.title"],
    [/data-bind=(["'])(?:profile|basics)\.status\1/g, 'data-bind="basic.status"', "rename status binding to basic.status"],
  ];

  for (const [pattern, replacement, label] of replacements) {
    const before = next;
    next = next.replace(pattern, replacement);
    if (next !== before) changes.push(label);
  }

  if (!/data-bind=["']profile\.contacts["']/.test(next)) {
    const contactBlock = `<div class="contact-bar"><slot data-bind="profile.contacts" data-template="contact-item"></slot></div>`;
    const sectionOrderSlot = /<slot\b(?=[^>]*\bdata-bind=["']sectionOrder["'])[^>]*>(?:\s*<\/slot>)?/i;
    if (sectionOrderSlot.test(next)) {
      next = next.replace(sectionOrderSlot, `${contactBlock}\n\n  $&`);
    } else {
      next = `${next.trimEnd()}\n${contactBlock}`;
    }
    changes.push("add profile.contacts loop");
  }

  if (!hasTemplate(next, "contact-item")) {
    next = `${next.trimEnd()}
  <template id="contact-item">
    <span class="contact-item"><slot data-bind="contact.icon"></slot><slot data-bind="contact.label"></slot></span>
  </template>`;
    changes.push("add contact-item template");
  }

  const beforeContacts = next;
  next = next
    .replace(
      /<slot\b(?=[^>]*\bdata-bind=["']basics\.(?:email|phone|location|website|icon\.[^"']+)["'])[^>]*>(?:\s*<\/slot>)?/g,
      "",
    )
    .replace(/\s*(?:\||·|,|，|\/)\s*(?=<\/(?:div|p|span)>)/g, "")
    .replace(/(<(?:div|p|span)\b[^>]*class=["'][^"']*contact[^"']*["'][^>]*>)\s*(?:\||·|,|，|\/|\s)*\s*(<\/(?:div|p|span)>)/gi, "$1$2");
  if (next !== beforeContacts) changes.push("remove legacy basics contact bindings");

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

function patchSectionBodyHtml(html: string, changes: string[]): string {
  if (/data-bind=["']section\.body["']/.test(html)) return html;
  const next = html.replace(
    /<slot\b(?=[^>]*\bdata-bind=["']section\.items["'])(?=[^>]*\bdata-template=)[^>]*>(?:\s*<\/slot>)?/i,
    (match) => `<div class="section-body"><slot data-bind="section.body"></slot></div>\n      ${match}`,
  );
  if (next !== html) {
    changes.push("add section.body slot before section.items");
  }
  return next;
}

function patchSectionTemplateSplit(html: string, changes: string[]): string {
  const baseIds = Array.from(
    html.matchAll(
      /<slot\b(?=[^>]*\bdata-bind=["']sectionOrder["'])(?=[^>]*\bdata-template=["']([^"']+)["'])[^>]*>/g,
    ),
    (match) => match[1],
  );
  let next = html;

  for (const baseId of new Set(baseIds)) {
    if (hasTemplate(next, `${baseId}-list`) && hasTemplate(next, `${baseId}-block`)) {
      continue;
    }

    const template = extractTemplate(next, baseId);
    if (!template) continue;

    const listInner = removeSectionBodySlot(template.inner).trim();
    const blockInner = removeSectionItemsSlot(template.inner).trim();
    if (listInner === template.inner.trim() || blockInner === template.inner.trim()) {
      continue;
    }

    const splitTemplates = `<template id="${baseId}-list">
${indentTemplateInner(listInner)}
  </template>
  <template id="${baseId}-block">
${indentTemplateInner(blockInner)}
  </template>`;
    next = `${next.slice(0, template.start)}${splitTemplates}${next.slice(template.end)}`;
    changes.push(`split ${baseId} into list/block section templates`);
  }

  return next;
}

function patchCrimsonItemLayoutHtml(html: string, changes: string[]): string {
  let next = html;
  for (const itemTemplateId of collectSectionItemTemplateIds(next)) {
    const template = extractTemplate(next, itemTemplateId);
    if (!template) continue;
    if (isCrimsonItemLayout(template.inner)) continue;

    const root = splitRootElement(template.inner);
    if (!root) continue;

    const replacement = `<template id="${itemTemplateId}">
${indentTemplateInner(`${root.open}
      <div class="item-header">
        <span class="item-title"><slot data-bind="item.title"></slot></span>
        <span class="item-date"><slot data-bind="item.dateRange"></slot></span>
      </div>
      <div class="item-subtitle"><span class="item-role"><slot data-bind="item.subtitle"></slot></span><span class="item-location"><slot data-bind="item.location"></slot></span></div>
      <div class="item-meta-row"><span class="item-meta"><slot data-bind="item.meta"></slot></span><a class="item-link"><slot data-bind="item.link"></slot></a></div>
      <div class="item-body"><slot data-bind="item.bullets"></slot></div>
    ${root.close}`)}
  </template>`;

    next = `${next.slice(0, template.start)}${replacement}${next.slice(template.end)}`;
    changes.push(`align ${itemTemplateId} item layout with crimson`);
  }
  return next;
}

function collectSectionItemTemplateIds(html: string): string[] {
  return Array.from(
    html.matchAll(
      /<slot\b(?=[^>]*\bdata-bind=["']section\.items["'])(?=[^>]*\bdata-template=["']([^"']+)["'])[^>]*>/g,
    ),
    (match) => match[1],
  );
}

function isCrimsonItemLayout(html: string): boolean {
  return (
    (/\bclass=["'][^"']*\bitem-meta-row\b/.test(html) &&
      /\bclass=["'][^"']*\bitem-role\b/.test(html) &&
      /\bclass=["'][^"']*\bitem-location\b/.test(html)) ||
    (/\bclass=["'][^"']*\bentry-meta-row\b/.test(html) &&
      /\bclass=["'][^"']*\bentry-role\b/.test(html) &&
      /\bclass=["'][^"']*\bentry-location\b/.test(html))
  );
}

function splitRootElement(html: string): { open: string; close: string } | null {
  const trimmed = html.trim();
  const open = trimmed.match(/^<([a-zA-Z][\w:-]*)([^>]*)>/);
  if (!open) return null;
  const tag = open[1];
  const closeRe = new RegExp(`</${escapeRegExp(tag)}>\\s*$`, "i");
  const close = trimmed.match(closeRe);
  if (!close) return null;
  return { open: open[0], close: close[0].trim() };
}

function hasTemplate(html: string, id: string): boolean {
  return new RegExp(`<template[^>]*\\bid=["']${escapeRegExp(id)}["']`, "i").test(html);
}

function extractTemplate(html: string, id: string): { start: number; end: number; inner: string } | null {
  const re = new RegExp(
    `<template[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/template>`,
    "i",
  );
  const match = re.exec(html);
  if (!match || match.index === undefined) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    inner: match[1] ?? "",
  };
}

function removeSectionBodySlot(html: string): string {
  return html.replace(
    /\s*<div\b[^>]*class=["'][^"']*\bsection-body\b[^"']*["'][^>]*>\s*<slot\b(?=[^>]*\bdata-bind=["']section\.body["'])[^>]*>(?:\s*<\/slot>)?\s*<\/div>\s*/i,
    "\n",
  );
}

function removeSectionItemsSlot(html: string): string {
  return html.replace(
    /\s*<slot\b(?=[^>]*\bdata-bind=["']section\.items["'])(?=[^>]*\bdata-template=)[^>]*>(?:\s*<\/slot>)?\s*/i,
    "\n",
  );
}

function indentTemplateInner(html: string): string {
  return html
    .split("\n")
    .map((line) => (line.trim() ? `    ${line.trimEnd()}` : ""))
    .join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    html = patchSlotProtocolHtml(html, changes);
    html = patchItemLinkHtml(html, changes);
    html = patchSectionBodyHtml(html, changes);
    html = patchSectionTemplateSplit(html, changes);
    html = patchCrimsonItemLayoutHtml(html, changes);
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

    if (!css.includes(SECTION_BODY_PATCH_MARKER)) {
      css = `${css.trimEnd()}${SECTION_BODY_CSS}`;
      changes.push("append section.body CSS");
    }

    if (!css.includes(SECTION_SPLIT_PATCH_MARKER)) {
      css = `${css.trimEnd()}\n\n/* ${SECTION_SPLIT_PATCH_MARKER}: section templates are split into list/block variants */\n`;
      changes.push("append section split marker");
    }

    if (!css.includes(CRIMSON_ITEM_LAYOUT_PATCH_MARKER)) {
      css = `${css.trimEnd()}${CRIMSON_ITEM_LAYOUT_CSS}`;
      changes.push("append crimson item layout CSS");
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
