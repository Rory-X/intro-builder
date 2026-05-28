/**
 * Idempotent: ensures a "dev-user" row exists in `user` (id = "dev-user")
 * and that it owns at least one resume. Lets us run the app locally with
 * AUTH_DEV_BYPASS=1 + AUTH_DEV_USER_ID=dev-user without round-tripping
 * a magic link.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/ensure-dev-user.ts
 *
 * Re-running is safe — both the user and the resume insertions ON CONFLICT
 * skip if they already exist.
 */
import { neon } from "@neondatabase/serverless";

async function withRetry<T>(label: string, fn: () => Promise<T>, max = 5): Promise<T> {
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cause = e instanceof Error && (e as Error & { cause?: { code?: string } }).cause?.code;
      const transient = /fetch failed|ECONNRESET|socket disconnected|network socket/i.test(msg + " " + (cause ?? ""));
      if (!transient || i === max) throw e;
      const delay = 500 * 2 ** (i - 1);
      console.warn(`  ! ${label} attempt ${i} transient error, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

const DEV_USER_ID = "dev-user";
const DEV_USER_EMAIL = "dev@local.test";
const DEV_USER_NAME = "Dev User";

const DEMO_CONTENT = {
  basics: {
    name: "张三",
    title: "前端工程师",
    email: "zhang@example.com",
    phone: "138 0000 0000",
    location: "北京",
    website: "github.com/zhangsan",
    summary: "3 年前端经验，专注 Web 性能与可访问性，熟悉 React / Next.js 技术栈。",
    photo: "",
    status: "在职",
  },
  education: [
    {
      school: "北京邮电大学",
      degree: "本科",
      major: "计算机科学与技术",
      location: "北京",
      start: "2018.09",
      end: "2022.06",
      gpa: "3.7/4.0",
      highlights: { type: "doc", content: [] },
    },
  ],
  experience: [
    {
      company: "字节跳动",
      title: "前端工程师",
      start: "2022.07",
      end: "至今",
      location: "北京",
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "主导企业协作工具的编辑器重构，核心链路加载耗时降低 40%" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "设计并落地组件库可访问性规范，WCAG AA 通过率 98%" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "推动 CI 中的视觉回归测试接入，减少 UI 回退事故 60%" }] }] },
            ],
          },
        ],
      },
    },
  ],
  projects: [
    {
      name: "intro-builder",
      role: "核心开发",
      location: "北京",
      start: "2024.04",
      end: "2024.06",
      stack: ["Next.js", "TypeScript", "Tailwind"],
      link: "",
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "面向求职者的开源简历生成器，支持多模板与公开分享链接" }] }] },
            ],
          },
        ],
      },
    },
  ],
  skills: [
    { category: "语言", items: ["TypeScript", "JavaScript", "Python"] },
    { category: "框架", items: ["React", "Next.js", "Vue"] },
    { category: "工具", items: ["Vite", "Playwright", "Docker"] },
  ],
  custom: [],
  sectionOrder: ["basics", "experience", "education", "projects", "skills"],
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — pass --env-file=.env.local");
  const sql = neon(url);

  await withRetry(
    "insert user",
    () => sql`
      INSERT INTO "user" (id, name, email, "emailVerified")
      VALUES (${DEV_USER_ID}, ${DEV_USER_NAME}, ${DEV_USER_EMAIL}, now())
      ON CONFLICT (id) DO NOTHING
    `,
  );
  console.log(`✓ user dev-user ensured`);

  const existing = await withRetry(
    "select resumes",
    () =>
      sql`SELECT id, "templateId", title FROM resume WHERE "userId" = ${DEV_USER_ID} LIMIT 5` as unknown as Promise<
        Array<{ id: string; templateId: string; title: string }>
      >,
  );

  if (existing.length === 0) {
    const newId = crypto.randomUUID();
    const rows = await withRetry(
      "insert resume",
      () =>
        sql`
          INSERT INTO resume (id, "userId", title, "templateId", content)
          VALUES (
            ${newId},
            ${DEV_USER_ID},
            '测试简历(dev)',
            'professional',
            ${JSON.stringify(DEMO_CONTENT)}::jsonb
          )
          RETURNING id, "templateId", title
        ` as unknown as Promise<Array<{ id: string; templateId: string; title: string }>>,
    );
    console.log(`✓ created resume ${rows[0].id} for dev-user`);
  } else {
    console.log(`✓ dev-user already has ${existing.length} resume(s):`);
    for (const r of existing) console.log(`  • ${r.id}  template=${r.templateId}  ${r.title}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
