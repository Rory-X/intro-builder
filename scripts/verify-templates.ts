/**
 * Verifies the DB-template pipeline end-to-end without UI / auth:
 *   1. listUploadedTemplates() reads from DB
 *   2. listAllTemplatesAsync() returns published DB rows
 *   3. Slot coverage check: verifies published templates have bindings for key fields
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

// ─── Slot Coverage Check ────────────────────────────────────────────────────

type SlotCheck = {
  name: string;
  description: string;
  test: (html: string) => boolean;
};

const SLOT_CHECKS: SlotCheck[] = [
  {
    name: "photo",
    description: "头像 (<img data-bind=\"profile.photo\"> 或 basics.photo)",
    test: (html) => /data-bind=["'](profile|basics)\.photo["']/.test(html),
  },
  {
    name: "profile.name",
    description: "姓名 (profile.name 或 basics.name)",
    test: (html) => /data-bind=["'](profile|basics)\.name["']/.test(html),
  },
  {
    name: "profile.title",
    description: "求职方向 (profile.title 或 basics.title)",
    test: (html) => /data-bind=["'](profile|basics)\.title["']/.test(html),
  },
  {
    name: "profile.status",
    description: "求职状态 (profile.status 或 basics.status)",
    test: (html) => /data-bind=["'](profile|basics)\.status["']/.test(html),
  },
  {
    name: "contacts",
    description: "联系方式 (profile.contacts 或 basics.email/phone/location/website)",
    test: (html) =>
      /data-bind=["']profile\.contacts["']/.test(html) ||
      (/data-bind=["']basics\.email["']/.test(html) &&
        /data-bind=["']basics\.phone["']/.test(html)),
  },
  {
    name: "sectionOrder",
    description: "分区循环 (sectionOrder)",
    test: (html) => /data-bind=["']sectionOrder["']/.test(html),
  },
  {
    name: "section.title",
    description: "模块标题 (section.title)",
    test: (html) => /data-bind=["']section\.title["']/.test(html),
  },
  {
    name: "section.items",
    description: "列表模块 (section.items)",
    test: (html) => /data-bind=["']section\.items["']/.test(html),
  },
  {
    name: "item.title",
    description: "条目主标题 (item.title)",
    test: (html) => /data-bind=["']item\.title["']/.test(html),
  },
  {
    name: "item.subtitle",
    description: "条目副标题 (item.subtitle)",
    test: (html) => /data-bind=["']item\.subtitle["']/.test(html),
  },
  {
    name: "item.dateRange",
    description: "时间范围 (item.dateRange)",
    test: (html) => /data-bind=["']item\.dateRange["']/.test(html),
  },
  {
    name: "item.location",
    description: "地点 (item.location)",
    test: (html) => /data-bind=["']item\.location["']/.test(html),
  },
  {
    name: "item.meta/tags",
    description: "技术栈/GPA (item.meta 或 item.tags)",
    test: (html) =>
      /data-bind=["']item\.meta["']/.test(html) ||
      /data-bind=["']item\.tags["']/.test(html),
  },
  {
    name: "item.link",
    description: "项目链接 (item.link)",
    test: (html) => /data-bind=["']item\.link["']/.test(html),
  },
  {
    name: "item.bullets",
    description: "详细描述 (item.bullets)",
    test: (html) => /data-bind=["']item\.bullets["']/.test(html),
  },
];

type CoverageResult = {
  templateId: string;
  templateName: string;
  missing: string[];
};

type HardcodedContentResult = {
  templateId: string;
  templateName: string;
  legacyBindings: string[];
  demoContent: string[];
};

const LEGACY_BODY_BINDINGS = [
  "item.header.title",
  "item.header.subtitle",
  "item.header.dateRange",
  "item.header.location",
] as const;

const DEMO_CONTENT_LITERALS = [
  "张三",
  "字节跳动",
  "美团",
  "北京邮电大学",
  "前端工程师",
  "前端实习生",
] as const;

function hasBinding(html: string, binding: string): boolean {
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`data-bind=["']${escaped}["']`).test(html);
}

function checkSlotCoverage(id: string, name: string, html: string): CoverageResult {
  const missing = SLOT_CHECKS
    .filter((check) => !check.test(html))
    .map((check) => check.name);
  return { templateId: id, templateName: name, missing };
}

function checkHardcodedContent(id: string, name: string, html: string): HardcodedContentResult | null {
  const legacyBindings = LEGACY_BODY_BINDINGS.filter((binding) => hasBinding(html, binding));
  const demoContent = DEMO_CONTENT_LITERALS.filter((literal) => html.includes(literal));
  if (legacyBindings.length === 0 && demoContent.length === 0) return null;
  return { templateId: id, templateName: name, legacyBindings, demoContent };
}

async function runSlotCoverageCheck() {
  console.log("\n─── Slot Coverage Check ───\n");

  const publishedRows = await withTransientRetry("slot coverage", () =>
    db
      .select({ id: templates.id, name: templates.name, html: templates.html })
      .from(templates)
      .where(eq(templates.status, "published")),
  );

  if (publishedRows.length === 0) {
    console.log("  (no published templates found)");
    return;
  }

  const results: CoverageResult[] = [];
  let fullCoverageCount = 0;

  for (const row of publishedRows) {
    if (!row.html) {
      results.push({ templateId: row.id, templateName: row.name, missing: ["(empty html)"] });
      continue;
    }
    const result = checkSlotCoverage(row.id, row.name, row.html);
    if (result.missing.length > 0) {
      results.push(result);
    } else {
      fullCoverageCount++;
    }
  }

  console.log(`  ${publishedRows.length} published templates checked`);
  console.log(`  ${fullCoverageCount} fully covered ✓`);

  if (results.length > 0) {
    console.log(`  ${results.length} with missing slots:\n`);
    for (const r of results) {
      console.log(`  ${r.templateId} (${r.templateName})`);
      console.log(`    缺: ${r.missing.join("、")}`);
    }
  } else {
    console.log("  All templates have full slot coverage ✓");
  }

  console.log("");
}

async function runHardcodedContentCheck() {
  console.log("\n─── Hardcoded Template Content Check ───\n");

  const publishedRows = await withTransientRetry("hardcoded content check", () =>
    db
      .select({ id: templates.id, name: templates.name, html: templates.html })
      .from(templates)
      .where(eq(templates.status, "published")),
  );

  const results = publishedRows
    .filter((row) => row.html)
    .map((row) => checkHardcodedContent(row.id, row.name, row.html ?? ""))
    .filter((result): result is HardcodedContentResult => result !== null);

  if (results.length === 0) {
    console.log("  No legacy item.header.* slots or demo resume text found ✓\n");
    return;
  }

  for (const result of results) {
    console.log(`  ${result.templateId} (${result.templateName})`);
    if (result.legacyBindings.length > 0) {
      console.log(`    legacy slots: ${result.legacyBindings.join("、")}`);
    }
    if (result.demoContent.length > 0) {
      console.log(`    demo text: ${result.demoContent.join("、")}`);
    }
  }

  fail("published templates contain legacy item slots or demo resume text");
}

async function runCrimsonTypographyCheck() {
  console.log("\n─── Crimson Body Typography Check ───\n");

  const [row] = await withTransientRetry("crimson typography check", () =>
    db
      .select({ id: templates.id, name: templates.name, css: templates.css })
      .from(templates)
      .where(eq(templates.id, "handcoded-crimson")),
  );

  if (!row?.css) {
    console.log("  handcoded-crimson CSS not found; skipped\n");
    return;
  }

  const bannerBlock = row.css.match(/\.crimson-banner\s*\{([^{}]*)\}/)?.[1] ?? "";
  const bannerDescendantBlocks = Array.from(
    row.css.matchAll(/\.crimson-banner[^{]*\{([^{}]*)\}/g),
    (match) => match[1],
  ).join("\n");
  const bannerIssues: string[] = [];
  if (!/font-family\s*:\s*(?!var\()[^;]+;/.test(bannerBlock)) {
    bannerIssues.push("banner must set a fixed font-family");
  }
  if (!/line-height\s*:\s*(?!var\()[^;]+;/.test(bannerBlock)) {
    bannerIssues.push("banner must set a fixed line-height");
  }
  if (/var\(--font-size\)|var\(--line-height\)|var\(--font-family\)/.test(bannerDescendantBlocks)) {
    bannerIssues.push("banner selectors must not depend on layout typography variables");
  }
  const titleBlock = row.css.match(/\.crimson-section-title h2\s*\{([^{}]*)\}/)?.[1] ?? "";
  if (!/line-height\s*:\s*(?!var\()[^;]+;/.test(titleBlock)) {
    bannerIssues.push("section title h2 must set a fixed line-height so body line-height cannot resize the title bar");
  }

  const violations: string[] = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(row.css)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    if (selector.includes(".crimson-banner")) continue;
    if (selector.includes("[data-pagination-header]")) continue;
    if (selector.includes(".crimson-section-title")) continue;

    const hasFixedFontSize = /font-size\s*:\s*\d+(?:\.\d+)?px\b/.test(body);
    const hasFixedLineHeight = /line-height\s*:\s*\d+(?:\.\d+)?\b/.test(body);
    if (hasFixedFontSize || hasFixedLineHeight) {
      const fixedProps = body
        .split(";")
        .map((part) => part.trim())
        .filter((part) =>
          /^font-size\s*:\s*\d+(?:\.\d+)?px\b/.test(part) ||
          /^line-height\s*:\s*\d+(?:\.\d+)?\b/.test(part),
        );
      violations.push(`${selector} -> ${fixedProps.join("; ")}`);
    }
  }

  if (bannerIssues.length === 0 && violations.length === 0) {
    console.log("  Crimson banner typography is fixed; body typography uses CSS variables ✓\n");
    return;
  }

  for (const issue of bannerIssues) {
    console.log(`  ${issue}`);
  }
  for (const violation of violations) {
    console.log(`  ${violation}`);
  }
  fail("handcoded-crimson typography violates banner/body typography boundaries");
}

// ─── Main ───────────────────────────────────────────────────────────────────

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

  // Slot coverage check
  await runSlotCoverageCheck();
  await runHardcodedContentCheck();
  await runCrimsonTypographyCheck();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
