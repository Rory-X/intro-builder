/**
 * Insert one row into the `templates` table per schema-v2 target shape.
 * Used by the template-studio skill after extract-decoration.py produces
 * the asset PNG and the agent writes the HTML+CSS template body.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local \
 *     template-studio-skill/scripts/insert-template.ts \
 *     --id <id> \
 *     --name "<纯中文 2-6 字>" \
 *     --description "<面向求职者的一句话>" \
 *     --category <academic|tech|business|creative|general> \
 *     --features '["特点1","特点2","特点3"]' \
 *     --html path/to/template.html \
 *     --css  path/to/template.css \
 *     --assets '[{"url":"https://...","role":"banner"}]' \
 *     --default-style-settings '{"fontFamily":"sans","fontSize":13,...}' \
 *     --layout '{"type":"vertical"}'
 *
 * --env-file=.env.local must be passed so DATABASE_URL is in process.env
 * before this module runs.
 *
 * 协议契约对齐 docs/schema-v2/。脚本独立于 lib/templates/uploaded/types.ts —
 * 内联 Zod schema，不依赖 lib 里仍带 v1 字段的 LayoutConfig。
 *
 * Exit codes:
 *   0  upserted
 *   1  caller error (missing/invalid args, schema validation, missing DATABASE_URL)
 *   2  DB error
 */
import { neon } from "@neondatabase/serverless";
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { StyleSettings } from "@/lib/resume-schema";

function fail(code: number, msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// ─── schema-v2 inline Zod schemas ─────────────────────────────────
//
// 不从 lib 引：lib/templates/uploaded/types.ts 仍带 v1 字段（headerVariant
// 等），import 会强迫脚本写 v1 哑值。skill 是独立协议产出方——schema 内联，
// 与 lib 当前实现解耦。等 lib 收敛到目标态后，这里改成 import 即可。

const TemplateCategory = z.enum([
  "academic",
  "tech",
  "business",
  "creative",
  "general",
]);

const Features = z.array(z.string().min(1).max(60)).length(3);

const Asset = z.object({
  url: z.string().url().regex(/^https:\/\//, "url must start with https://"),
  role: z.enum(["banner", "decoration", "icon"]),
});
const Assets = z.array(Asset);

const Layout = z
  .object({
    type: z.enum(["vertical", "horizontal"]),
    sidebar: z
      .object({
        side: z.enum(["left", "right"]),
        width: z.string(),
        sections: z.array(z.string()),
      })
      .optional(),
  })
  .strict()
  .refine(
    (l) => l.type === "vertical" || l.sidebar != null,
    { message: "horizontal layout requires sidebar config" },
  );

// ─── helpers ──────────────────────────────────────────────────────

function parseJson<T>(flag: string, raw: string, schema: z.ZodType<T>): T {
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
 * 自由排版 dual-constraint：用户可调维度必须用 var(--*) — 用户在编辑器里
 * 调字号/行高时，硬编码值会让模板对密度调节物理失效。
 */
function checkDualConstraint(css: string): string[] {
  const violations: string[] = [];
  const re = /(font-size|font-family|line-height)\s*:\s*([^;]+?)(?:;|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const value = m[2].trim();
    if (!/^var\(/.test(value)) {
      violations.push(`${m[1]}: ${value}`);
    }
  }
  return violations;
}

/**
 * Header 完整性：8 个 basics binding 全部要在 HTML 里出现。缺一个 = 用户
 * 那一字段的数据在该模板下永远不渲染。
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
    const re = new RegExp(`data-bind=["']${binding.replace(".", "\\.")}["']`);
    if (!re.test(html)) missing.push(binding);
  }
  return missing;
}

/**
 * 单文件 PoC 便利：HTML 顶部内嵌的 <style> 块抽出来作为 CSS。SlotRenderer
 * DOMPurify whitelist 不含 <style>，不抽走会 silent 渲染裸文本。
 */
function autoExtractStyleBlock(html: string): { html: string; css: string | null } {
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  const collected: string[] = [];
  const stripped = html.replace(styleRe, (_match, body: string) => {
    collected.push(body);
    return "";
  });
  if (collected.length === 0) return { html, css: null };
  return { html: stripped.trim(), css: collected.join("\n\n").trim() };
}

// ─── main ─────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      category: { type: "string" },
      features: { type: "string" },
      html: { type: "string" },
      css: { type: "string" },
      assets: { type: "string" },
      "default-style-settings": { type: "string" },
      layout: { type: "string" },
      "thumbnail-url": { type: "string" },
      "skip-css-check": { type: "boolean" },
      // 默认 status='draft'，仅 dev-preview 可见，便于人工审查；--publish
      // 让模板对所有用户生效。迭代修改时反复跑 default 路径不会让旧 published
      // 模板倒退（ON CONFLICT 仍按入参 status 更新——所以 publish 后再跑
      // 默认会把它改回 draft，请有意为之）。
      publish: { type: "boolean" },
    },
    strict: true,
  });

  // ── 必填检查 ──
  const required = ["id", "name", "description", "category", "features", "html",
                    "default-style-settings"] as const;
  for (const k of required) {
    if (!values[k]) fail(1, `--${k} required`);
  }

  // ── id / name 格式 ──
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(values.id!)) {
    fail(1, `--id must be kebab-case (got "${values.id}")`);
  }
  if (!/^[\u4e00-\u9fa5]{2,6}$/.test(values.name!)) {
    fail(1, `--name must be 2-6 Chinese characters (got "${values.name}")`);
  }

  // ── enum / json 字段 ──
  const categoryParse = TemplateCategory.safeParse(values.category);
  if (!categoryParse.success) {
    fail(1, `--category must be one of: ${TemplateCategory.options.join(", ")}. Got: ${values.category}`);
  }
  const category = categoryParse.data;

  const features = parseJson("--features", values.features!, Features);
  const assets = values.assets ? parseJson("--assets", values.assets, Assets) : [];
  const defaultStyleSettings = parseJson(
    "--default-style-settings",
    values["default-style-settings"]!,
    StyleSettings,
  );
  const layout = values.layout
    ? parseJson("--layout", values.layout, Layout)
    : { type: "vertical" as const };

  // ── HTML / CSS 文件读取 ──
  let html: string;
  try {
    html = readFileSync(values.html!, "utf-8");
  } catch (e) {
    fail(1, `--html: cannot read ${values.html}: ${(e as Error).message}`);
  }
  let css: string | null = null;
  if (values.css) {
    try {
      css = readFileSync(values.css, "utf-8");
    } catch (e) {
      fail(1, `--css: cannot read ${values.css}: ${(e as Error).message}`);
    }
  }
  if (!css) {
    const extracted = autoExtractStyleBlock(html);
    if (extracted.css) {
      html = extracted.html;
      css = extracted.css;
      console.log(`[hint] auto-extracted <style> block from --html (${css.length} chars)`);
    }
  }

  // ── HTML 结构校验 ──
  const missing = checkRequiredBindings(html);
  if (missing.length > 0) {
    fail(
      1,
      `--html missing required basics bindings:\n  ${missing.join("\n  ")}\n\n` +
        `每个模板 header 必须包含全部 8 个 basics binding（详见 SKILL.md）。`,
    );
  }

  // ── CSS dual-constraint ──
  if (css && !values["skip-css-check"]) {
    const violations = checkDualConstraint(css);
    if (violations.length > 0) {
      fail(
        1,
        `--css violates dual constraint. 用户可调字段必须用 CSS 变量：\n  ` +
          violations.join("\n  ") +
          `\n\n改成 var(--font-size) / var(--font-family) / var(--line-height)。` +
          `\n--skip-css-check 可绕过（罕见，仅 banner 锁定排版时用）。`,
      );
    }
  }

  // ── DB upsert（按 schema-v2 目标态字段写） ──
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail(1, "DATABASE_URL not set — pass --env-file=.env.local to tsx");
  const sql = neon(dbUrl);

  // 默认 draft：人工审查再 publish。--publish 直发。
  const status = values.publish ? "published" : "draft";

  try {
    const rows = (await sql`
      INSERT INTO templates (
        id, name, description, "thumbnailUrl",
        category, features,
        html, css, assets, "defaultStyleSettings",
        layout, status
      ) VALUES (
        ${values.id},
        ${values.name},
        ${values.description},
        ${values["thumbnail-url"] ?? null},
        ${category},
        ${JSON.stringify(features)}::jsonb,
        ${html},
        ${css},
        ${JSON.stringify(assets)}::jsonb,
        ${JSON.stringify(defaultStyleSettings)}::jsonb,
        ${JSON.stringify(layout)}::jsonb,
        ${status}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "thumbnailUrl" = EXCLUDED."thumbnailUrl",
        category = EXCLUDED.category,
        features = EXCLUDED.features,
        html = EXCLUDED.html,
        css = EXCLUDED.css,
        assets = EXCLUDED.assets,
        "defaultStyleSettings" = EXCLUDED."defaultStyleSettings",
        layout = EXCLUDED.layout,
        status = EXCLUDED.status,
        "updatedAt" = now()
      RETURNING id, name, status, "updatedAt"
    `) as Array<{ id: string; name: string; status: string; updatedAt: string }>;

    if (rows.length === 0) fail(2, "no row returned from upsert");
    const r = rows[0];
    if (r.status === "draft") {
      console.log(`upserted as DRAFT: ${r.id} (${r.name})`);
      console.log(`  preview: http://localhost:3000/dev-preview/template/${r.id}`);
      console.log(`  确认无误后用 --publish 重跑同一命令切换到 published`);
    } else {
      console.log(`PUBLISHED: ${r.id} (${r.name})`);
    }
  } catch (e) {
    fail(2, `DB error: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
