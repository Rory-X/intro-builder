# intro-builder — Design Spec

**Date:** 2026-04-28
**Owner:** @qianjiahao
**Status:** Draft, awaiting user review

## 1. Problem & Users

**Problem.** 互联网行业求职者缺少一个"结构化 + 可在线迭代 + 随时导出 PDF"的免费简历工具。现有产品要么模板丑、要么付费卡 PDF 导出、要么数据存浏览器 localStorage 一清就丢。

**Primary user.** 互联网方向（前端/后端/算法/产品）求职者，中文为主、英文可选。

**Success criteria (MVP).**
1. 任何人 60 秒内可用邮箱登录并开始编辑简历
2. 编辑动作在 2 秒内自动入库（防抖 Server Action）
3. 一键导出规整的 A4 PDF，可直接投递
4. 100 人并发 / 月级流量运行在免费额度内

**Non-goals (MVP 不做).** AI 润色、团队协作、多语言自动翻译、模板市场、付费墙。

## 2. Tech Stack（已用 Context7 校验 2026-04 当前可用性）

| 层 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js 15 App Router + React 19 | Server Components + Server Actions |
| 语言 | TypeScript strict | 全链路类型 |
| 包管理 | **pnpm** | 锁 Vercel 构建 |
| 部署 | Vercel Hobby | 100 GB 带宽 / 月 |
| 数据库 | **Neon Postgres**（Vercel Marketplace 原生集成） | `@vercel/postgres` 已废弃，官方迁移到 Neon |
| ORM | Drizzle ORM + `@neondatabase/serverless`（HTTP driver） | Edge-ready，无连接池 |
| 迁移 | drizzle-kit | `generate` + `migrate` 本地执行 |
| 鉴权 | Auth.js v5（NextAuth）+ Resend Provider + Drizzle Adapter | Magic Link，无密码 |
| 邮件 | Resend 免费档（3000/月） | `from: login@<domain>` |
| UI | Tailwind CSS v4 + shadcn/ui + Radix Primitives | 复制源码到仓库，零运行时 |
| 拖拽 | @dnd-kit/core + @dnd-kit/sortable | 分区 / bullet 排序 |
| 表单 | react-hook-form + zod + @hookform/resolvers | schema 驱动 |
| PDF 导出 | **@react-pdf/renderer（服务端路由 + Node runtime）** | 一键下载 .pdf，中文字体注入思源黑体子集 |
| 图标 | lucide-react | 与 shadcn 搭配 |

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Browser                                                      │
│  ┌──────────────┐      ┌──────────────┐                      │
│  │ Editor (CSR) │ <--> │ Preview (CSR)│  shared Zod schema   │
│  └──────┬───────┘      └──────────────┘                      │
│         │ debounced Server Action (2s)                       │
└─────────┼────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Next.js 15 on Vercel (Node runtime, not Edge)                │
│  • Server Actions: saveResume / createResume / deleteResume  │
│  • Route Handlers: /api/auth/* (Auth.js), /api/pdf/:id       │
│  • Middleware: session redirect for /dashboard, /resume/*    │
└─────────┬────────────────────────────────────────────────────┘
          ▼
┌──────────────────────────────────────────────────────────────┐
│ Neon Postgres (via @neondatabase/serverless HTTP)            │
│   user, account, session, verificationToken, resume          │
└──────────────────────────────────────────────────────────────┘
```

Design notes:
- **PDF route runs on Node runtime**, not Edge — `@react-pdf/renderer` needs `fs` for font loading.
- **Server Actions** 用于 CRUD，避免手写 route handler；PDF 走独立 route handler 方便 `Content-Disposition: attachment`。
- **Middleware** 拦截受保护路由，未登录 302 `/login?next=...`。

## 4. Data Model

```ts
// auth.js required tables (Drizzle adapter standard)
user(id pk, name, email unique, emailVerified, image)
account(userId fk, provider, providerAccountId, ...) — 保留（未来接 GitHub OAuth）
session(sessionToken pk, userId fk, expires)
verificationToken(identifier, token, expires)

// business
resume(
  id uuid pk,
  userId fk → user.id on delete cascade,
  title text not null default '我的简历',
  templateId text not null default 'classic',
  content jsonb not null,                // ResumeContent (zod)
  slug text unique,                       // /r/[slug] 公开预览
  isPublic boolean default false,
  createdAt timestamp default now(),
  updatedAt timestamp default now()
)
create index resume_user_idx on resume(userId);
```

`content` 字段存储结构（见下 `ResumeContent` zod schema）。jsonb 的原因：**模板迭代期字段会频繁加减**，关系型表会被改到哭。

```ts
ResumeContent = {
  basics: { name, title, email, phone, location, website?, summary },
  education: Array<{ school, degree, major, start, end, gpa?, highlights: string[] }>,
  experience: Array<{ company, title, start, end, location?, bullets: string[] }>,
  projects: Array<{ name, stack: string[], link?, bullets: string[] }>,
  skills: Array<{ category, items: string[] }>,
  custom: Array<{ title, content }>   // 获奖、证书、开源
}
```

## 5. Routes

| Route | Kind | Auth | 说明 |
|---|---|---|---|
| `/` | RSC | public | landing page + CTA 登录 |
| `/login` | RSC | public | 输入邮箱，调 `signIn('resend')` |
| `/verify-request` | RSC | public | "请检查邮箱" 提示页 |
| `/dashboard` | RSC | required | 简历列表 + 新建 |
| `/resume/[id]/edit` | RSC + CSR 子树 | required + owner | 左编辑 / 右预览 |
| `/resume/[id]/preview` | RSC | required + owner | 纯预览（打印样式） |
| `/r/[slug]` | RSC | public | 公开只读链接（仅当 `isPublic=true`） |
| `/api/auth/[...nextauth]` | Route handler | - | Auth.js |
| `/api/pdf/[id]` | Route handler (Node) | required + owner | 返回 `application/pdf` |

## 6. Key Flows

**Sign-in.** `/login` → 输入邮箱 → `signIn('resend', { email })` → Auth.js 生成 token 入 `verificationToken` → Resend 发 magic link → 点击 → `/api/auth/callback/resend?token=...` → 会话写入 `session` 表 → 302 `/dashboard`。

**Save resume.** 编辑器 onChange → debounce 2s → `saveResume(id, content)` Server Action → zod 校验 → `db.update(resumes).where(id && userId)` → `revalidatePath('/resume/[id]/edit')`。

**Export PDF.** 点"下载 PDF" → `GET /api/pdf/:id` → 服务端 `db.query.resumes.findFirst` → render React PDF 文档 → `new Response(pdfStream, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="..."' } })`。中文字体：`public/fonts/NotoSansSC-Regular.otf` + `Font.register` + subset。

**Public share.** Dashboard 勾选"公开" → 生成 `nanoid(10)` 写入 `slug` 并置 `isPublic=true` → `/r/<slug>` RSC 直接查 db，查不到或非 public 返回 404。

## 7. Templates (MVP 两套)

```
lib/templates/
  classic/          # 大厂保守，黑白，单栏
    Layout.tsx      # React 组件，编辑器预览用
    Pdf.tsx         # @react-pdf/renderer 组件，导出 PDF 用
    meta.ts         # { id, name, thumbnail }
  modern/           # 技术风，双栏，左侧技能/教育，右侧经历
    Layout.tsx
    Pdf.tsx
    meta.ts
  index.ts          # 模板注册表
```

**关键约束：** 同一份 `content` 必须在 Layout 与 Pdf 两端渲染出视觉一致的结果。我们 **不做 DOM→PDF 截图**，而是在两端用相同数据驱动两套组件，减少字体/布局踩坑。

## 8. Env Vars

```
DATABASE_URL             # Vercel → Neon 集成自动注入
AUTH_SECRET              # openssl rand -base64 32
AUTH_URL                 # https://intro-builder.vercel.app
AUTH_RESEND_KEY          # Resend 控制台
AUTH_EMAIL_FROM          # login@<your-domain>
```

## 9. Capacity for 100 users / month

| 资源 | 免费额度 | 估算 | 余量 |
|---|---|---|---|
| Vercel 带宽 | 100 GB | ~2 GB | ✅ 50x |
| Vercel 函数 | 100 GB·h | <5 GB·h | ✅ 20x |
| Neon 存储 | 0.5 GB | 10 KB × 1000 resume = 10 MB | ✅ 50x |
| Neon 计算 | 191 h | 自动 suspend | ✅ |
| Resend 邮件 | 3000/月 | ~500 | ✅ 6x |
| PDF 生成 | 10s timeout (Hobby) | 单份 <1s | ✅ |

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Neon 冷启动 ~500ms 首请求抖动 | loading skeleton；公开链接加 `export const revalidate = 60` |
| Vercel Hobby 函数 10s 上限 | PDF 单份生成 <1s；避免长 job；监控超时告警 |
| Magic Link 跨设备体验差 | 保留 `account` 表，后续加 GitHub OAuth |
| Resend 需要域名验证 | 初期用 Resend 提供的 onboarding 域名做 dev，上线前绑定自己域名 |
| 用户误删简历 | 软删除 `deletedAt`（P1），MVP 硬删但加二次确认 |
| jsonb schema 演进破坏老数据 | zod `safeParse` 失败则兜底返回空结构 + 提示"数据需要迁移"，不崩溃 |

## 11. Explicit Out-of-Scope

- AI 润色（P1，需用户提供 API Key 或平台代付）
- 多人协作 / 评论
- 自定义模板上传
- 付费 / 订阅
- 移动端深度优化（MVP 响应式可用即可）
- SEO / og-image 生成（P1）

## 12. Implementation Order (feeds into plan)

1. 脚手架：create-next-app + pnpm + tailwind + shadcn init
2. Drizzle schema + Neon 连接 + 迁移跑通
3. Auth.js v5 + Resend + DrizzleAdapter + login/verify 页
4. Middleware + `/dashboard` 列表 + createResume Server Action
5. `/resume/[id]/edit` 编辑器骨架 + zod schema + saveResume debounce
6. 分区编辑组件：basics / education / experience / projects / skills
7. 模板 classic Layout.tsx（预览端）
8. 模板 classic Pdf.tsx + `/api/pdf/[id]` + 中文字体
9. 模板 modern
10. 公开分享 `/r/[slug]`
11. 响应式打磨 + 错误边界 + 部署

---

## Self-Review (填空 / 矛盾 / 模糊 / 越界 检查)

- **Placeholders.** 无 TODO。
- **Contradiction.** §7 说"不做 DOM→PDF 截图"与 §2 选型一致（react-pdf）。✅
- **Ambiguity.** §6 export PDF 未说明未登录公开链接能否下载 PDF → **裁定：MVP 公开链接只读 HTML，不提供 PDF 下载按钮**（省去 rate-limit 烦恼）。已在 §5 `/api/pdf/:id` 标 required + owner 明确。
- **Scope.** §11 已列 out-of-scope。AI、模板市场、协作均排除。
- **Feasibility.** react-pdf 在 Vercel Node runtime 正常工作，已在 §10 列出字体注入路径。
