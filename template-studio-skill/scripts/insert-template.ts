/**
 * Insert one row into the `templates` table. Used by the template-studio skill
 * after the agent writes HTML+CSS for a v2 SlotRenderer template.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local template-studio-skill/scripts/insert-template.ts \
 *        --id <id> --name "<name>" --description "<desc>" \
 *        --category <enum> --features '["...","...","..."]' \
 *        --html path/to/template.html \
 *        --css  path/to/template.css \
 *        --default-style-settings '<styleSettings JSON>'
 *
 * Optional flags:
 *   --section-icons '<json>'   section icon declarations (default {})
 *   --thumbnail-url <url>      static thumbnail URL
 *   --publish                  set status=published (default: draft)
 *
 * Aliases: --custom-html → --html, --custom-css → --css (backward compat).
 *
 * --env-file=.env.local must be passed so DATABASE_URL is in process.env
 * before this module runs (no in-file dotenv — ESM imports evaluate before
 * top-level statements).
 *
 * Exit codes:
 *   0  inserted (upserted as draft or published)
 *   1  caller error (missing args, bad JSON, missing DATABASE_URL)
 *   2  DB error
 */
import { neon } from "@neondatabase/serverless";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
// Single source of truth for the row shape.
import { SectionIconsSchema } from "@/lib/templates/uploaded/types";

function fail(code: number, msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

/** Parse JSON + run Zod validation; print Zod's flattened issues on failure. */
function parseConfig<T>(
  flag: string,
  raw: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } } },
): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    fail(1, `${flag} is not valid JSON: ${(e as Error).message}`);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    fail(
      1,
      `${flag} failed schema validation:\n${JSON.stringify(result.error.flatten(), null, 2)}`,
    );
  }
  return result.data;
}

/**
 * v2 dual-constraint self-check: customCss must use CSS variables for
 * font-size / font-family / line-height (user-tunable per spec §4.2).
 * Hardcoded values fail the check.
 *
 * Heuristic — looks for any `font-size: <px|em|rem|number>` or `font-family: <name>`
 * or `line-height: <number>` that isn't immediately followed by `var(`.
 * False-positive friendly (will yell on legitimate var(-derived computation)
 * but the safe override is the same: rewrite to var(--foo)).
 */
function checkDualConstraint(css: string): string[] {
  const violations: string[] = [];
  const re =
    /(font-size|font-family|line-height)\s*:\s*([^;]+?)(?:;|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const prop = m[1];
    const value = m[2].trim();
    // Allow: var(--*) references
    if (/^var\(/.test(value)) continue;
    // Allow: relative units that scale with parent (em, rem, %, ch, ex)
    if (/\d\.?\d*\s*(em|rem|%|ch|ex)\b/.test(value)) continue;
    // Allow: unitless line-height (e.g. line-height: 1.3)
    if (prop === "line-height" && /^[\d.]+$/.test(value)) continue;
    // Allow: CSS-wide keywords
    if (/^(inherit|initial|unset|revert)$/i.test(value)) continue;
    violations.push(`${prop}: ${value}`);
  }
  return violations;
}

const REQUIRED_BINDINGS = [
  "basic.name",
  "basic.title",
  "basic.status",
  "basic.photo",
  "profile.contacts",
  "contact.icon",
  "contact.label",
  "sectionOrder",
  "section.title",
  "section.body",
  "section.items",
  "item.title",
  "item.subtitle",
  "item.dateRange",
  "item.location",
  "item.meta",
  "item.link",
  "item.bullets",
] as const;

const FORBIDDEN_BINDING_PATTERNS = [
  /^basics\./,
  /^basics\.icon\./,
  /^profile\.(name|title|status|summary)$/,
] as const;

function hasBinding(html: string, binding: string): boolean {
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`data-bind=["']${escaped}["']`).test(html);
}

function listBindings(html: string): string[] {
  const matches = html.matchAll(/data-bind=["']([^"']+)["']/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1]))).sort();
}

function checkMissingRequiredBindings(html: string): string[] {
  return REQUIRED_BINDINGS.filter((binding) => !hasBinding(html, binding));
}

function checkForbiddenBindings(html: string): string[] {
  return listBindings(html).filter((binding) =>
    FORBIDDEN_BINDING_PATTERNS.some((pattern) => pattern.test(binding)),
  );
}

function hasPhotoImgBinding(html: string): boolean {
  return /<img\b[^>]*data-bind=["']basic\.photo["'][^>]*>/i.test(html);
}

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      "thumbnail-url": { type: "string" },
      "section-icons": { type: "string" },
      // Primary flags (SKILL.md canonical names)
      html: { type: "string" },
      css: { type: "string" },
      // Backward-compat aliases
      "custom-html": { type: "string" },
      "custom-css": { type: "string" },
      "skip-css-check": { type: "boolean" },
      // Publish control: absent → draft, present → published
      publish: { type: "boolean" },
      // Default style settings — applied when user first picks this template
      "default-style-settings": { type: "string" },
      // 用户视角分类（必填）：academic / tech / business / creative / general
      category: { type: "string" },
      // per-template "模板特点"，3 条文案，JSON 数组字符串
      features: { type: "string" },
    },
    strict: true,
  });

  // Normalize aliases: --html wins over --custom-html, --css wins over --custom-css
  const htmlPath = values.html ?? values["custom-html"];
  const cssPath = values.css ?? values["custom-css"];

  if (!values.id) fail(1, "--id required");
  if (!values.name) fail(1, "--name required");
  if (!values.category) fail(1, "--category required (academic|tech|business|creative|general)");
  if (!values.features) fail(1, "--features required (JSON array of 3 strings)");

  // 校验 category
  const VALID_CATEGORIES = ["academic", "tech", "business", "creative", "general"];
  if (!VALID_CATEGORIES.includes(values.category)) {
    fail(
      1,
      `--category must be one of: ${VALID_CATEGORIES.join(", ")}. Got: ${values.category}`,
    );
  }

  // 校验 features：JSON 数组、长度 3、每条非空且 ≤ 60 字
  let features: string[];
  try {
    const parsed = JSON.parse(values.features);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    if (parsed.length !== 3) throw new Error(`expected 3 items, got ${parsed.length}`);
    for (const f of parsed) {
      if (typeof f !== "string") throw new Error("non-string item");
      if (f.length === 0) throw new Error("empty string");
      if (f.length > 60) throw new Error(`item too long (>60 chars): "${f.slice(0, 30)}..."`);
    }
    features = parsed;
  } catch (e) {
    fail(1, `--features invalid: ${(e as Error).message}. Expected JSON array of 3 strings, each ≤ 60 chars.`);
  }

  // Parse defaultStyleSettings if provided, otherwise null (DB stays null)
  let defaultStyleSettings: unknown = null;
  if (values["default-style-settings"]) {
    try {
      defaultStyleSettings = JSON.parse(values["default-style-settings"]);
    } catch (e) {
      fail(1, `--default-style-settings is not valid JSON: ${(e as Error).message}`);
    }
  }

  // Validates sectionIcons against the same Zod schema fetch.ts uses to read.
  const sectionIcons = values["section-icons"]
    ? parseConfig("--section-icons", values["section-icons"], SectionIconsSchema)
    : {};

  // v2 path: read HTML/CSS files.
  let customHtml: string | null = null;
  let customCss: string | null = null;
  if (htmlPath) {
    try {
      customHtml = readFileSync(htmlPath, "utf-8");
    } catch (e) {
      fail(1, `--html: cannot read ${htmlPath}: ${(e as Error).message}`);
    }
  }
  if (cssPath) {
    try {
      customCss = readFileSync(cssPath, "utf-8");
    } catch (e) {
      fail(1, `--css: cannot read ${cssPath}: ${(e as Error).message}`);
    }
  }

  // Convenience: PoC HTML files often have CSS embedded in a leading <style>
  // block. SlotRenderer's DOMPurify whitelist intentionally drops <style> tags
  // (security: a malicious template could ship `style>...</style><script>`).
  // So if --custom-css wasn't provided, extract the <style> block ourselves
  // and store it in the customCss field. Without this, single-file PoCs ship
  // with no CSS and render unstyled — silent failure mode.
  if (customHtml && !customCss) {
    const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    const collected: string[] = [];
    const stripped = customHtml.replace(styleRe, (_match, body: string) => {
      collected.push(body);
      return "";
    });
    if (collected.length > 0) {
      customCss = collected.join("\n\n").trim();
      customHtml = stripped.trim();
      console.log(
        `[hint] auto-extracted ${collected.length} <style> block(s) from --custom-html ` +
          `(${customCss.length} chars). Pass --custom-css explicitly to override.`,
      );
    }
  }

  // v2 slot protocol check: templates must use the current public view model,
  // not storage paths or legacy compatibility aliases.
  if (customHtml) {
    const forbidden = checkForbiddenBindings(customHtml);
    if (forbidden.length > 0) {
      fail(
        1,
        `--custom-html uses forbidden slot bindings:\n  ` +
          forbidden.join("\n  ") +
          `\n\nCurrent schema exposes basic.* for headline identity, ` +
          `profile.contacts/contact.* for icon contact rows, and section/item ` +
          `bindings for body content. Do not use basics.* or ` +
          `profile.name/title/status/summary.`,
      );
    }

    const missing = checkMissingRequiredBindings(customHtml);
    if (missing.length > 0) {
      fail(
        1,
        `--custom-html is missing required slot bindings:\n  ` +
          missing.join("\n  ") +
          `\n\nRequired groups:\n` +
          `  basic.name/basic.title/basic.status/basic.photo for headline identity\n` +
          `  profile.contacts + contact.icon/contact.label for contact rows\n` +
          `  sectionOrder + section.* + item.* for body sections\n` +
          `\nSee docs/schema-v2/template-slot-fields.md.`,
      );
    }

    if (!hasPhotoImgBinding(customHtml)) {
      fail(
        1,
        `--custom-html must render the avatar with <img data-bind="basic.photo">. ` +
          `Do not use <slot data-bind="basic.photo">.`,
      );
    }
  }

  // v2 dual-constraint pre-flight: refuse to insert CSS that hardcodes
  // user-tunable typography. Skill v2 templates that violate this would
  // silently break user font-size/family/line-height adjustments — better
  // to fail fast at write time than debug later.
  if (customCss && !values["skip-css-check"]) {
    const violations = checkDualConstraint(customCss);
    if (violations.length > 0) {
      fail(
        1,
        `--custom-css violates dual constraint (spec §4.2). The following ` +
          `properties must use CSS variables (var(--font-size) / var(--font-family) / ` +
          `var(--line-height)) so users can tune them in the editor:\n  ` +
          violations.join("\n  ") +
          `\n\nFix: rewrite hardcoded values to var(--font-*). Pass --skip-css-check ` +
          `if you really mean to lock these (rare; e.g. banner-only typography).`,
      );
    }
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail(1, "DATABASE_URL not set — pass --env-file=.env.local to tsx");

  const sql = neon(dbUrl);

  const status = values.publish ? "published" : "draft";

  // Idempotent upsert: ON CONFLICT DO UPDATE so re-running the skill (e.g. after
  // tweaking the prompt or layout) refreshes the row instead of erroring.
  // RETURNING avoids a second round-trip — Neon HTTP fetches are independent
  // calls, and the second one is a flaky moment we don't need to take.
  try {
    const rows = (await sql`
      INSERT INTO templates (
        id, name, description, "thumbnailUrl",
        "sectionIcons", html, css,
        category, features,
        "defaultStyleSettings",
        status
      ) VALUES (
        ${values.id},
        ${values.name},
        ${values.description ?? null},
        ${values["thumbnail-url"] ?? null},
        ${JSON.stringify(sectionIcons)}::jsonb,
        ${customHtml},
        ${customCss},
        ${values.category},
        ${JSON.stringify(features)}::jsonb,
        ${defaultStyleSettings ? JSON.stringify(defaultStyleSettings) : null}::jsonb,
        ${status}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "thumbnailUrl" = EXCLUDED."thumbnailUrl",
        "sectionIcons" = EXCLUDED."sectionIcons",
        html = EXCLUDED.html,
        css = EXCLUDED.css,
        "defaultStyleSettings" = EXCLUDED."defaultStyleSettings",
        category = EXCLUDED.category,
        features = EXCLUDED.features,
        status = EXCLUDED.status,
        "updatedAt" = now()
      RETURNING id, name, status, "updatedAt"
    `) as Array<{ id: string; name: string; status: string; updatedAt: string }>;
    if (rows.length === 0) fail(2, "no row returned from upsert");
    const r = rows[0];

    const label = r.status === "published" ? "PUBLISHED" : "upserted as DRAFT";
    console.log(`${label}: ${r.id} (${r.name})`);
    if (r.status === "draft") {
      console.log(`  preview: http://localhost:3000/dev-preview/template/${r.id}`);
      console.log(`  确认无误后用 --publish 重跑同一命令切换到 published`);
    }
  } catch (e) {
    fail(2, `DB error: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
