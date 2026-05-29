/**
 * Migrate abbey-blue 模板：头像装饰 <div> → <img data-bind="basics.photo">，
 * 用上 v2 渲染器新的图片绑定能力。
 *
 * abbey-blue 的 source of truth 在 DB（非文件），故走「读改写」+ 幂等。
 * 默认 dry-run（只打印 before/after，不写库）；加 --commit 才执行 UPDATE。
 *
 * ⚠️ 部署顺序：此 migration 必须与引擎代码（html-slot-renderer 的 img
 * 绑定支持）**一起或之后**部署。若先改库、引擎旧版仍在线，旧引擎不认识
 * <img data-bind> → 线上 abbey-blue 头像位会渲染成无 src 的 img。
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/apply-avatar-img-migration.ts [--commit]
 */
import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL not set — pass --env-file=.env.local");
const sql = neon(DB_URL);
const COMMIT = process.argv.includes("--commit");

const OLD_HTML = `<div class="abbey-blue-avatar" aria-hidden="true"></div>`;
const NEW_HTML = `<img data-bind="basics.photo" class="abbey-blue-avatar" alt="头像" />`;

async function main() {
  const rows = (await sql`
    SELECT "customHtml", "customCss" FROM templates WHERE id = 'abbey-blue'
  `) as Array<{ customHtml: string; customCss: string }>;
  if (rows.length === 0) throw new Error("abbey-blue 模板不存在");
  const { customHtml, customCss } = rows[0];

  // 幂等：已迁移则跳过
  if (customHtml.includes('data-bind="basics.photo"')) {
    console.log("✓ abbey-blue 已迁移（customHtml 已含 <img data-bind>），跳过");
    return;
  }
  if (!customHtml.includes(OLD_HTML)) {
    throw new Error(`未找到预期 avatar div，HTML 可能已被改动，请人工核对。预期含:\n${OLD_HTML}`);
  }

  const newHtml = customHtml.replace(OLD_HTML, NEW_HTML);

  // CSS：在 .abbey-blue-avatar 块的 `display: block;` 后插 object-fit: cover
  let newCss = customCss;
  if (!/\.abbey-blue-avatar\s*\{[^}]*object-fit/.test(customCss)) {
    newCss = customCss.replace(
      /(\.abbey-blue-avatar\s*\{[^}]*?display:\s*block;)/,
      `$1\n    object-fit: cover;`,
    );
    if (newCss === customCss) {
      throw new Error("CSS 未匹配 .abbey-blue-avatar 的 `display: block;` 锚点，请人工核对");
    }
  }

  console.log("=== HTML 替换 ===");
  console.log("旧:", OLD_HTML);
  console.log("新:", NEW_HTML);
  console.log("\n=== CSS .abbey-blue-avatar 块 (after) ===");
  console.log(newCss.match(/\.abbey-blue-avatar\s*\{[^}]*\}/)?.[0] ?? "(块未找到)");

  if (!COMMIT) {
    console.log("\n[dry-run] 未写库。确认无误后加 --commit 执行 UPDATE。");
    return;
  }

  await sql`
    UPDATE templates
    SET "customHtml" = ${newHtml}, "customCss" = ${newCss}, "updatedAt" = now()
    WHERE id = 'abbey-blue'
  `;
  console.log("\n✓ 已 UPDATE abbey-blue。注意：这是共享库，确保引擎代码已/将一起部署。");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
