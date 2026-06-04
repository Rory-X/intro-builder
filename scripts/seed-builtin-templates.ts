/**
 * Seed the 3 built-in templates into the `templates` DB table.
 *
 * After this script the built-in templates (professional / classic / modern)
 * live in the same table as uploaded templates, share the same Zod schema
 * validation, and can be queried with a single SQL call.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/seed-builtin-templates.ts
 *
 * Idempotent — uses ON CONFLICT DO UPDATE.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

type BuiltinSeed = {
  id: string;
  name: string;
  description: string;
  category: string;
  features: [string, string, string];
  htmlFile: string;
  cssFile: string;
  sectionIcons: Record<string, { icon: string; color?: string }>;
  defaultStyleSettings: object;
};

const BUILTIN_TEMPLATES: BuiltinSeed[] = [
  {
    id: "professional",
    name: "专业",
    description: "单栏清晰，适合中文互联网求职",
    category: "tech",
    features: [
      "单栏布局清晰，重点突出工作经历与项目",
      "适合中文互联网求职（字节 / 阿里 / 美团 / 腾讯）",
      "字号字体可调，ATS 友好排版兼容投递系统",
    ],
    htmlFile: "templates/html/professional.html",
    cssFile: "templates/html/professional.css",
    sectionIcons: {},
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
    name: "经典",
    description: "大厂保守，黑白单栏",
    category: "business",
    features: [
      "黑白单栏，传统稳重不张扬",
      "适合金融 / 咨询 / 律所 / 银行 / 国企等保守行业",
      "衬线字体兼容打印与正式投递",
    ],
    htmlFile: "templates/html/classic.html",
    cssFile: "templates/html/classic.css",
    sectionIcons: {
      basics: { icon: "LayoutList", color: "#64748b" },
      experience: { icon: "Briefcase", color: "#3b82f6" },
      education: { icon: "GraduationCap", color: "#22c55e" },
      projects: { icon: "FolderGit2", color: "#a855f7" },
      skills: { icon: "Wrench", color: "#f97316" },
      research: { icon: "FlaskConical", color: "#14b8a6" },
      summary: { icon: "LayoutList", color: "#06b6d4" },
      awards: { icon: "Award", color: "#eab308" },
      portfolio: { icon: "Palette", color: "#ec4899" },
    },
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
    name: "现代",
    description: "技术风双栏",
    category: "tech",
    features: [
      "双栏布局，深色 sidebar 突出技能与联系方式",
      "适合技术岗、设计岗，信息密度大",
      "紧凑排版适合内容丰富的简历",
    ],
    htmlFile: "templates/html/modern.html",
    cssFile: "templates/html/modern.css",
    sectionIcons: {},
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
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail("DATABASE_URL not set — pass --env-file=.env.local to tsx");

  const sql = neon(dbUrl);

  for (const t of BUILTIN_TEMPLATES) {
    const html = readFileSync(resolve(t.htmlFile), "utf-8");
    const css = readFileSync(resolve(t.cssFile), "utf-8");

    try {
      const rows = (await sql`
        INSERT INTO templates (
          id, name, description,
          category, features,
          html, css,
          "sectionIcons", "defaultStyleSettings",
          status
        ) VALUES (
          ${t.id},
          ${t.name},
          ${t.description},
          ${t.category},
          ${JSON.stringify(t.features)}::jsonb,
          ${html},
          ${css},
          ${JSON.stringify(t.sectionIcons)}::jsonb,
          ${JSON.stringify(t.defaultStyleSettings)}::jsonb,
          'published'
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          category = EXCLUDED.category,
          features = EXCLUDED.features,
          html = EXCLUDED.html,
          css = EXCLUDED.css,
          "sectionIcons" = EXCLUDED."sectionIcons",
          "defaultStyleSettings" = EXCLUDED."defaultStyleSettings",
          status = EXCLUDED.status,
          "updatedAt" = now()
        RETURNING id, name, status
      `) as Array<{ id: string; name: string; status: string }>;

      if (rows.length === 0) fail(`no row returned for ${t.id}`);
      const r = rows[0];
      console.log(`✓ ${r.id} (${r.name})  status=${r.status}`);
    } catch (e) {
      fail(`DB error for ${t.id}: ${(e as Error).message}`);
    }
  }

  console.log("\nDone — 3 built-in templates seeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
