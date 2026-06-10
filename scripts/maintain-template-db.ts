import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
const CONTACT_SPACING_MARKER = "intro-builder template db patch 2026-06 contact spacing";
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
const CONTACT_SPACING_CSS = `

/* ${CONTACT_SPACING_MARKER}: 联系方式各项之间留间距 + 去竖线分隔。
   独立 marker，不与 PROFILE_TYPOGRAPHY 的 marker 耦合（部分模板早已打过后者）。
   用 margin 而非容器 gap：各模板联系方式容器 class 不统一
   （contact-row / contact-line / contact-bar / *-contact），但 loop 项统一是 .contact-item。 */
.contact-item:not(:last-child) {
  margin-right: 0.9em;
}
/* 去掉个别模板联系方式区的竖线分隔（改用 icon + 间距）。只作用于联系方式容器，
   不影响正文条目（.meta-row / .item-title）本身设计的分隔线。 */
.contact-line > *:not(:last-child)::after,
.creative-contact slot:not(:last-child)::after {
  content: none !important;
  margin-left: 0 !important;
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
  const hadBasicStatus = /data-bind=["']basic\.status["']/.test(next);

  if (!/data-bind=["']profile\.contacts["']/.test(next)) {
    const migrated = migrateLegacyContactContainers(next);
    if (migrated !== next) {
      next = migrated;
      changes.push("migrate legacy contact container to profile.contacts loop");
    } else {
      const contactBlock = `<div class="contact-bar"><slot data-bind="profile.contacts" data-template="contact-item"></slot></div>`;
      const sectionOrderSlot = /<slot\b(?=[^>]*\bdata-bind=["']sectionOrder["'])[^>]*>(?:\s*<\/slot>)?/i;
      if (sectionOrderSlot.test(next)) {
        next = next.replace(sectionOrderSlot, `${contactBlock}\n\n  $&`);
      } else {
        next = `${next.trimEnd()}\n${contactBlock}`;
      }
      changes.push("add fallback profile.contacts loop");
    }
  }

  if (!hasTemplate(next, "contact-item")) {
    next = `${next.trimEnd()}
  <template id="contact-item">
    <span class="contact-item"><slot data-bind="contact.icon" class="contact-icon-lucide"></slot><slot data-bind="contact.label"></slot></span>
  </template>`;
    changes.push("add contact-item template");
  }

  const beforeContacts = next;
  next = next
    .replace(
      /<slot\b(?=[^>]*\bdata-bind=["']basics\.(?:email|phone|location|website|icon\.[^"']+)["'])[^>]*>(?:\s*<\/slot>)?/g,
      "",
    );
  if (next !== beforeContacts) changes.push("remove legacy basics contact bindings");

  if (hadBasicStatus && !/data-bind=["']basic\.status["']/.test(next)) {
    const withStatus = insertStatusBesideTitle(next);
    if (withStatus !== next) {
      next = withStatus;
      changes.push("move basic.status beside basic.title");
    }
  }

  return next;
}

function migrateLegacyContactContainers(html: string): string {
  const candidates = collectLegacyContactContainers(html);
  if (candidates.length === 0) return html;

  let next = html;
  for (const candidate of [...candidates].reverse()) {
    const inner = next.slice(candidate.openEnd, candidate.closeStart);
    const identity = buildContactContainerIdentityLine(inner);
    next = `${next.slice(0, candidate.openEnd)}
              ${identity}
              <slot data-bind="profile.contacts" data-template="contact-item"></slot>
            ${next.slice(candidate.closeStart)}`;
  }
  return next;
}

function buildContactContainerIdentityLine(inner: string): string {
  // status 不在这里保留 —— 它属于 basic 区（姓名/岗位/状态），由 insertStatusBesideTitle
  // 统一放到 basic.title 旁；若留在联系方式容器里，会渲染成「联系方式行顶着一个孤立
  // 圆点 + 状态」，与 basic/profile 的字段归属相悖。这里只保留 title（少数模板把 title
  // 原本嵌在联系方式容器内），避免迁移后 title 丢失。
  const hasTitle = /data-bind=["']basic\.title["']/.test(inner);
  if (!hasTitle) return "";
  return '<span class="contact-item"><slot data-bind="basic.title"></slot></span>';
}

function insertStatusBesideTitle(html: string): string {
  const statusHtml = '<span class="profile-status"><span class="profile-sep"> · </span><span class="profile-status-value"><slot data-bind="basic.status"></slot></span></span>';
  const titleSlot = /<slot\b(?=[^>]*\bdata-bind=["']basic\.title["'])[^>]*>(?:\s*<\/slot>)?/i;
  return html.replace(titleSlot, (match) => `${match}${statusHtml}`);
}

function collectLegacyContactContainers(html: string): Array<{
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
}> {
  const elements: Array<{
    start: number;
    openEnd: number;
    closeStart: number;
    end: number;
    openTag: string;
  }> = [];
  const stack: Array<{ tag: string; start: number; openEnd: number; openTag: string }> = [];
  const re = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    if (/^<\s*\//.test(full)) {
      const stackIndex = stack.findLastIndex((entry) => entry.tag === tag);
      if (stackIndex < 0) continue;
      const [entry] = stack.splice(stackIndex, stack.length - stackIndex);
      elements.push({
        start: entry.start,
        openEnd: entry.openEnd,
        closeStart: match.index,
        end: match.index + full.length,
        openTag: entry.openTag,
      });
      continue;
    }
    if (/\/\s*>$/.test(full)) continue;
    stack.push({
      tag,
      start: match.index,
      openEnd: match.index + full.length,
      openTag: full,
    });
  }

  const blockTags = new Set(["div", "p", "aside", "section", "header", "main", "li"]);
  const candidates = elements
    .filter((element) => {
      const tag = element.openTag.match(/^<([a-zA-Z][\w:-]*)/)?.[1]?.toLowerCase();
      if (!tag || !blockTags.has(tag)) return false;
      if (!isLegacyContactContainerOpenTag(element.openTag)) return false;
      const inner = html.slice(element.openEnd, element.closeStart);
      return /data-bind=["']basics\.(?:email|phone|location|website|icon\.[^"']+)["']/.test(inner);
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  return candidates.filter((candidate, index) => {
    return !candidates.some((other, otherIndex) => (
      otherIndex !== index &&
      other.start <= candidate.start &&
      candidate.end <= other.end
    ));
  });
}

function isLegacyContactContainerOpenTag(openTag: string): boolean {
  const classAttr = openTag.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? "";
  return /\b(?:contact|info-line|meta-row|details?)\b/i.test(classAttr);
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

export function patchTemplate(row: DbTemplate): PatchResult | null {
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

    if (!css.includes(CONTACT_SPACING_MARKER)) {
      css = `${css.trimEnd()}${CONTACT_SPACING_CSS}`;
      changes.push("append contact spacing CSS");
    }

    if (!css.includes(SECTION_SPLIT_PATCH_MARKER)) {
      css = `${css.trimEnd()}\n\n/* ${SECTION_SPLIT_PATCH_MARKER}: section templates are split into list/block variants */\n`;
      changes.push("append section split marker");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
