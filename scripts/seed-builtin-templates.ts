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
 * Idempotent — uses ON CONFLICT DO UPDATE (same pattern as insert-template.ts).
 */
import { neon } from "@neondatabase/serverless";

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
  layout: object;
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
    layout: {
      frame: { kind: "vertical" },
      headerVariant: "professional",
      sectionTitleVariant: "professional",
      itemHeaderVariant: "professional",
      theme: { primaryColor: "#171717" },
      sectionIcons: {},
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
    layout: {
      frame: { kind: "vertical" },
      headerVariant: "classic",
      sectionTitleVariant: "classic",
      itemHeaderVariant: "classic",
      theme: { primaryColor: "#000000" },
      sectionIcons: {},
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
    layout: {
      frame: {
        kind: "horizontal",
        sidebar: {
          side: "left",
          width: "240px",
          sections: ["skills", "education"],
        },
      },
      headerVariant: "modern-sidebar",
      sectionTitleVariant: "modern",
      itemHeaderVariant: "modern",
      theme: { primaryColor: "#1f2937" },
      sectionIcons: {},
    },
  },
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) fail("DATABASE_URL not set — pass --env-file=.env.local to tsx");

  const sql = neon(dbUrl);

  for (const t of BUILTIN_TEMPLATES) {
    try {
      const rows = (await sql`
        INSERT INTO templates (
          id, name, description, "thumbnailUrl",
          source, decoration, layout, "customHtml", "customCss",
          category, features,
          status, "createdBy"
        ) VALUES (
          ${t.id},
          ${t.name},
          ${t.description},
          ${null},
          'builtin',
          ${null}::jsonb,
          ${JSON.stringify(t.layout)}::jsonb,
          ${null},
          ${null},
          ${t.category},
          ${JSON.stringify(t.features)}::jsonb,
          'published',
          'seed-builtin-templates'
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          source = EXCLUDED.source,
          layout = EXCLUDED.layout,
          category = EXCLUDED.category,
          features = EXCLUDED.features,
          status = EXCLUDED.status,
          "updatedAt" = now()
        RETURNING id, name, source, status
      `) as Array<{ id: string; name: string; source: string; status: string }>;

      if (rows.length === 0) fail(`no row returned for ${t.id}`);
      const r = rows[0];
      console.log(`✓ ${r.id} (${r.name})  source=${r.source}  status=${r.status}`);
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
