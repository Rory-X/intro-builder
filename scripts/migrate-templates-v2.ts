/**
 * 迁移脚本：把 builtin 模板的 HTML+CSS 写入 DB 新字段，
 * 并把存量 uploaded 模板的 customHtml/customCss 复制到 html/css。
 *
 * 用法：pnpm exec tsx --env-file=.env.local scripts/migrate-templates-v2.ts
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(dbUrl);

const BUILTINS = [
  {
    id: "professional",
    htmlFile: "templates/html/professional.html",
    cssFile: "templates/html/professional.css",
    templateLayout: { type: "vertical" },
    defaultStyleSettings: {
      fontFamily: "sans",
      fontSize: 13,
      bodyLineHeight: 1.6,
      lineHeight: 1.6,
      headingGap: 8,
      pagePadding: 40,
      sectionGap: 16,
      itemGap: 12,
      photoScale: 1,
    },
  },
  {
    id: "classic",
    htmlFile: "templates/html/classic.html",
    cssFile: "templates/html/classic.css",
    templateLayout: { type: "vertical" },
    defaultStyleSettings: {
      fontFamily: "serif",
      fontSize: 13,
      bodyLineHeight: 1.6,
      lineHeight: 1.6,
      headingGap: 8,
      pagePadding: 40,
      sectionGap: 16,
      itemGap: 12,
      photoScale: 1,
    },
  },
  {
    id: "modern",
    htmlFile: "templates/html/modern.html",
    cssFile: "templates/html/modern.css",
    templateLayout: {
      type: "horizontal",
      sidebar: { side: "left", width: "240px", sections: ["skills", "education"] },
    },
    defaultStyleSettings: {
      fontFamily: "sans",
      fontSize: 12,
      bodyLineHeight: 1.5,
      lineHeight: 1.5,
      headingGap: 6,
      pagePadding: 32,
      sectionGap: 14,
      itemGap: 10,
      photoScale: 1,
    },
  },
];

async function main() {
  // 1. 写入 builtin 模板的 html/css
  for (const tpl of BUILTINS) {
    const html = readFileSync(resolve(tpl.htmlFile), "utf-8");
    const css = readFileSync(resolve(tpl.cssFile), "utf-8");

    await sql`
      UPDATE templates SET
        html = ${html},
        css = ${css},
        "templateLayout" = ${JSON.stringify(tpl.templateLayout)}::jsonb,
        "defaultStyleSettings" = ${JSON.stringify(tpl.defaultStyleSettings)}::jsonb,
        "updatedAt" = now()
      WHERE id = ${tpl.id}
    `;
    console.log(`✓ ${tpl.id}: html/css 已写入`);
  }

  // 2. 存量 uploaded 模板：customHtml → html, customCss → css
  const uploaded = await sql`
    SELECT id, "customHtml", "customCss", decoration
    FROM templates
    WHERE "customHtml" IS NOT NULL AND html IS NULL
  ` as Array<{ id: string; customHtml: string; customCss: string | null; decoration: unknown }>;

  for (const row of uploaded) {
    const assets = row.decoration
      ? [{ url: (row.decoration as { bgImageUrl?: string }).bgImageUrl ?? "", role: "decoration" }]
      : null;

    await sql`
      UPDATE templates SET
        html = ${row.customHtml},
        css = ${row.customCss},
        assets = ${assets ? JSON.stringify(assets) : null}::jsonb,
        "updatedAt" = now()
      WHERE id = ${row.id}
    `;
    console.log(`✓ ${row.id}: customHtml → html 迁移完成`);
  }

  console.log("\n迁移完成！");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
