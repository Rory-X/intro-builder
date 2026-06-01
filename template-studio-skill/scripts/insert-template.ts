/**
 * Insert one row into the `templates` table. Used by the template-studio skill
 * after extract-decoration.py produces the background image and the agent
 * decides on a LayoutConfig + DecorationConfig (v1) or writes HTML+CSS (v2).
 *
 * v1 enum-based path:
 *   pnpm exec tsx --env-file=.env.local template-studio-skill/scripts/insert-template.ts \
 *        --id <id> --name "<name>" \
 *        --description "<one-line description>" \
 *        --thumbnail-url "<optional URL>" \
 *        --decoration '<DecorationConfig JSON or null>' \
 *        --layout '<LayoutConfig JSON>'
 *
 * v2 HTML free-painting path (Skill v2 — see SKILL.md Step 3):
 *   pnpm exec tsx --env-file=.env.local template-studio-skill/scripts/insert-template.ts \
 *        --id <id> --name "<name>" \
 *        --custom-html path/to/template.html \
 *        --custom-css  path/to/template.css \
 *        --layout '<minimal LayoutConfig JSON for fallback>'
 *
 * --layout remains required even in v2 mode — UploadedLayout's bypass falls
 * back to it if SlotRenderer crashes. Pass a minimal valid value (professional
 * variant + black primary + empty sectionIcons).
 *
 * --env-file=.env.local must be passed so DATABASE_URL is in process.env
 * before this module runs (no in-file dotenv — ESM imports evaluate before
 * top-level statements).
 *
 * Exit codes:
 *   0  inserted (or already existed and we leave it)
 *   1  caller error (missing args, bad JSON, missing DATABASE_URL)
 *   2  DB error
 */
import { neon } from "@neondatabase/serverless";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
// Single source of truth for the row shape. Manually mirroring the Zod
// schema here would silently drift (e.g. `frame` was added to
// LayoutConfig in 1f79532; the old hand-written type didn't notice and
// would have happily inserted rows that fetch.ts then rejects).
import { LayoutConfig, DecorationConfig } from "@/lib/templates/uploaded/types";

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
    if (!/^var\(/.test(value)) {
      violations.push(`${prop}: ${value}`);
    }
  }
  return violations;
}

/**
 * v2 header completeness guard: every template MUST include all basics
 * bindings so user data never silently disappears. Photo uses <img data-bind>,
 * others use <slot data-bind>.
 */
const REQUIRED_BASICS_BINDINGS = [
  "basics.photo",
  "basics.name",
  "basics.title",
  "basics.status",
  "basics.email",
  "basics.phone",
  "basics.location",
  "basics.website",
] as const;

function checkRequiredBindings(html: string): string[] {
  const missing: string[] = [];
  for (const binding of REQUIRED_BASICS_BINDINGS) {
    // basics.photo: must appear as <img data-bind="basics.photo"
    // others: must appear as data-bind="basics.xxx"
    const re = new RegExp(`data-bind=["']${binding.replace(".", "\\.")}["']`);
    if (!re.test(html)) {
      missing.push(binding);
    }
  }
  return missing;
}

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      "thumbnail-url": { type: "string" },
      decoration: { type: "string" },
      layout: { type: "string" },
      "custom-html": { type: "string" },
      "custom-css": { type: "string" },
      "skip-css-check": { type: "boolean" },  // escape hatch for advanced cases
      "created-by": { type: "string" },
      // 用户视角分类（必填）：academic / tech / business / creative / general
      category: { type: "string" },
      // per-template "模板特点"，3 条文案，JSON 数组字符串
      features: { type: "string" },
    },
    strict: true,
  });

  if (!values.id) fail(1, "--id required");
  if (!values.name) fail(1, "--name required");
  if (!values.layout) fail(1, "--layout required (LayoutConfig JSON)");
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

  // Validates against the same Zod schema fetch.ts uses to read — no drift
  // possible. If LayoutConfig grows a new required field, this script will
  // start rejecting Skill output the moment the schema lands, instead of
  // silently writing rows that vanish from listAllTemplatesAsync.
  const layout = parseConfig("--layout", values.layout, LayoutConfig);

  const decoration =
    values.decoration && values.decoration !== "null"
      ? parseConfig("--decoration", values.decoration, DecorationConfig)
      : null;

  // v2 path: read HTML/CSS files. v1 path: both null.
  let customHtml: string | null = null;
  let customCss: string | null = null;
  if (values["custom-html"]) {
    try {
      customHtml = readFileSync(values["custom-html"], "utf-8");
    } catch (e) {
      fail(1, `--custom-html: cannot read ${values["custom-html"]}: ${(e as Error).message}`);
    }
  }
  if (values["custom-css"]) {
    try {
      customCss = readFileSync(values["custom-css"], "utf-8");
    } catch (e) {
      fail(1, `--custom-css: cannot read ${values["custom-css"]}: ${(e as Error).message}`);
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

  // v2 header completeness check: every uploaded template header must
  // include ALL basics bindings. Missing a binding = user's data silently
  // disappears from the rendered resume (zoo reported: photo, website,
  // status, title all invisible). Fail-fast here so skill must re-add them.
  if (customHtml) {
    const missing = checkRequiredBindings(customHtml);
    if (missing.length > 0) {
      fail(
        1,
        `--custom-html is missing required header bindings:\n  ` +
          missing.join("\n  ") +
          `\n\nEvery v2 template header must include ALL of:\n` +
          `  <img data-bind="basics.photo" .../>  (for photo)\n` +
          `  <slot data-bind="basics.name">       (for name)\n` +
          `  <slot data-bind="basics.title">      (for title/求职方向)\n` +
          `  <slot data-bind="basics.status">     (for 求职状态)\n` +
          `  <slot data-bind="basics.email">      (for email)\n` +
          `  <slot data-bind="basics.phone">      (for phone)\n` +
          `  <slot data-bind="basics.location">   (for city)\n` +
          `  <slot data-bind="basics.website">    (for 知识库/个人网站)\n` +
          `\nSee SKILL.md §slot-protocol "header 必须包含全部个人信息字段".`,
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

  // Idempotent upsert: ON CONFLICT DO UPDATE so re-running the skill (e.g. after
  // tweaking the prompt or layout) refreshes the row instead of erroring.
  // RETURNING avoids a second round-trip — Neon HTTP fetches are independent
  // calls, and the second one is a flaky moment we don't need to take.
  try {
    const rows = (await sql`
      INSERT INTO templates (
        id, name, description, "thumbnailUrl",
        source, decoration, layout, "customHtml", "customCss",
        category, features,
        status, "createdBy"
      ) VALUES (
        ${values.id},
        ${values.name},
        ${values.description ?? null},
        ${values["thumbnail-url"] ?? null},
        'uploaded',
        ${decoration ? JSON.stringify(decoration) : null}::jsonb,
        ${JSON.stringify(layout)}::jsonb,
        ${customHtml},
        ${customCss},
        ${values.category},
        ${JSON.stringify(features)}::jsonb,
        'published',
        ${values["created-by"] ?? "template-studio-skill"}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "thumbnailUrl" = EXCLUDED."thumbnailUrl",
        decoration = EXCLUDED.decoration,
        layout = EXCLUDED.layout,
        "customHtml" = EXCLUDED."customHtml",
        "customCss" = EXCLUDED."customCss",
        category = EXCLUDED.category,
        features = EXCLUDED.features,
        status = EXCLUDED.status,
        "updatedAt" = now()
      RETURNING id, name, source, status, "updatedAt"
    `) as Array<{ id: string; name: string; source: string; status: string; updatedAt: string }>;
    if (rows.length === 0) fail(2, "no row returned from upsert");
    const r = rows[0];
    const mode = customHtml ? "v2-html" : "v1-enum";
    console.log(
      `upserted: ${r.id} (${r.name})  mode=${mode}  source=${r.source}  status=${r.status}`,
    );
  } catch (e) {
    fail(2, `DB error: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
