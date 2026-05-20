<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# intro-builder — Agent 协作手册

**第一次动手前请通读本文件。** 它是协作的唯一信息源（`CLAUDE.md` 只是
`@AGENTS.md` 转引）。保持简短、诚实、最新——如果哪条规则被你证伪了，
就在同一个 PR 里改掉它。

## 1. 一句话项目摘要

- **产品**：面向中文互联网求职者的在线简历排版工具。结构化编辑 → 实时预览
  → 一键导出 A4 PDF → 可选公开只读链接 `/r/[slug]`。
- **当前阶段**：v0.3 之后。三套模板已上线（默认 `professional`、`classic`、
  `modern`），v0.3 主线聚焦模板与编辑器排版质量。当前分支的 v0.3.x WIP 涉及
  富文本字号、autosave flush、dashboard 卡片跳转、预览图导出等。
- **对 Agent 的预期**：交付小而可验证的切片。任何非平凡改动都必须走第 4 节
  的「spec → plan → 实现 → 验证 → 发布」回路。没有跑过第 6 节闸门
  之前，**不要**声称完成。

## 2. 技术栈速览

| 维度 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js **16** App Router | 见文件顶部红字。`middleware.ts` 现在叫 `proxy.ts`。 |
| 运行时 | React **19**，CI 使用 Node **22**、pnpm **10** | |
| 鉴权 | Auth.js v5 + Resend 魔法链接 | `lib/auth.ts`；14 天数据库会话。 |
| 数据库 | Drizzle ORM + Postgres | `db/schema.ts`。`*.neon.tech` 走 Neon HTTP，其它走 `postgres.js` TCP。选择器在 `db/connection.ts`。 |
| 表单 | React Hook Form + Zod | `lib/resume-schema.ts` 是简历内容的唯一契约。 |
| 富文本 | TipTap v3 + 扩展 | 存储是 TipTap JSON；只读渲染在 `components/preview/rich-text-renderer.tsx`。 |
| 拖拽 | `@atlaskit/pragmatic-drag-and-drop` | 分区与条目排序。 |
| PDF | Puppeteer + `@sparticuz/chromium` | 与预览复用同一 DOM，见第 8 节。 |
| 存储 | Vercel Blob | 仅头像；`app/api/upload-photo/route.ts`。 |
| 样式 | Tailwind v4 + shadcn 原语 | `components/ui/`；暗色模式走 `next-themes`。 |
| 测试 | Vitest + jsdom + Testing Library | `tests/unit/`；`vitest.config.ts` 把 `@/` 别名指到仓库根。 |

## 3. 仓库地图（只列 Agent 真正要看的）

```
app/
  (marketing)/        公开落地页
  (auth)/             /login、/verify-request（魔法链接）
  (app)/              登录后：dashboard、/resume/[id]/edit、server actions
  api/pdf/[id]/       Puppeteer PDF 路由（复用 /resume/[id]/preview）
  api/upload-photo/   Vercel Blob 上传
  r/[slug]/           公开只读简历
components/
  editor/             各分区编辑器（basics、experience、education、…）
  preview/            live-preview、preview-panel、template-renderer
  shell/              app header、brand、user menu
  ui/                 shadcn 原语 —— 不要手改，必要时用 shadcn CLI 重新生成
db/                   Drizzle schema + migrations + 驱动选择器
hooks/                use-resume-autosave.ts（去抖串行队列）
lib/
  resume-schema.ts    Zod schema；简历内容契约
  auth.ts             NextAuth v5 实例与 handlers
  templates/          professional / classic / modern + 共享原语
  style-presets.ts    密度 / 行高 / 页边距预设
  client/             仅客户端工具（导出预览图等）
  pdf-route-helpers.ts Puppeteer launch 配置 + 字体等待
proxy.ts              鉴权拦截 /dashboard、/resume/*/edit、/resume/*/preview
docs/superpowers/     specs/ 与 plans/ —— vibe 流程的落地物
tests/unit/           每个单元一个文件；文件名镜像源文件路径
```

## 4. Vibe 协作流程（不要跳步）

任何非平凡改动都走这条流水线。每一步都有对应的 Cursor / Superpowers
skill —— **动手前先读它**。

| 步骤 | 产物 | 落地位置 | 对应 skill |
|---|---|---|---|
| 1. 头脑风暴 | 对意图与约束的共识 | 聊天 | `superpowers/brainstorming` |
| 2. Spec | `docs/superpowers/specs/YYYY-MM-DD-<slug>.md` —— 解释「做什么 & 为什么」 | 仓库 | `superpowers/writing-plans`（spec 与 plan 同族） |
| 3. Plan | `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` —— 有序步骤 + 风险 + DoD | 仓库 | `superpowers/writing-plans`、`superpowers/executing-plans` |
| 4. TDD | 先写失败测试，再写实现 | `tests/unit/*` | `superpowers/test-driven-development` |
| 5. 实现 | 让测试变绿的最小切片 | 代码 | — |
| 6. 验证 | 本地跑通第 6 节闸门，附输出 | 聊天 / PR | `superpowers/verification-before-completion` |
| 7. 评审 | 带上 plan 链接请求 review | PR | `superpowers/requesting-code-review`、`superpowers/receiving-code-review` |
| 8. 发布 | 合并 + 关闭 plan + 在下一份 plan 里记录 | 仓库 | `superpowers/finishing-a-development-branch` |

铁则：

- **Spec 回答「为什么/做什么」，Plan 回答「按什么顺序怎么做、退出条件
  是什么」**。两者不要混。
- **一份 plan 对应一个可发布切片**。一份 plan 步骤超过 10 步就拆开。
- **就地更新 plan**。被现实证伪后没更新的 plan 比没有 plan 更糟。
- 排查 bug 时切到 `superpowers/systematic-debugging`：先建立假设、收集证据
  （日志、失败用例），把根因写下来再打补丁。
- 可并行的任务用 `superpowers/dispatching-parallel-agents`（或
  `subagent-driven-development`），但**只在子任务真正独立、不会改到同一份
  文件**时才并行。

## 5. Skill 索引（按需 `Read`）

下列路径全部用 `Read` 工具加载到上下文：

- 选题/构思：`~/.agents/skills/superpowers/brainstorming/SKILL.md`
- 写 plan：  `~/.agents/skills/superpowers/writing-plans/SKILL.md`
- 执行 plan：`~/.agents/skills/superpowers/executing-plans/SKILL.md`
- TDD：      `~/.agents/skills/superpowers/test-driven-development/SKILL.md`
- 系统化调试：`~/.agents/skills/superpowers/systematic-debugging/SKILL.md`
- 完成前验证：`~/.agents/skills/superpowers/verification-before-completion/SKILL.md`
- 发起评审：  `~/.agents/skills/superpowers/requesting-code-review/SKILL.md`
- 接受评审：  `~/.agents/skills/superpowers/receiving-code-review/SKILL.md`
- 收尾分支：  `~/.agents/skills/superpowers/finishing-a-development-branch/SKILL.md`
- worktree：  `~/.agents/skills/superpowers/using-git-worktrees/SKILL.md`
- 部署：      `~/.codex/skills/web-deploy/SKILL.md`（Vercel / 域名 / 环境变量）
- 保 PR 绿：  `~/.cursor/skills-cursor/babysit/SKILL.md`

## 6. 完成定义（Definition of Done）

声称完成或开 PR 之前，本地必须全绿。CI（`.github/workflows/ci.yml`）跑同一
组命令；本地通过是**必要条件，不是充分条件**。

```bash
pnpm test             # vitest，jsdom
pnpm tsc --noEmit     # 类型检查
pnpm lint             # eslint
pnpm build            # 生产构建（捕获 RSC / 路由错误）
```

任何 UI / 数据流改动还要补一次手工冒烟：

- `pnpm dev` 走一遍你动过的流程。
- PDF / 预览改动：进 `/resume/<id>/edit` 点「下载 PDF」，对比 PDF 与实时
  预览是否一致。
- 鉴权 / proxy 改动：登出后访问受保护路径，确认跳到
  `/login?next=…`。

绝不允许：

- 「改动很小」就跳过闸门。
- 在同一 diff 里压制 lint 却不解释原因。
- 落「dev 环境看着没问题」的代码。

## 7. 项目约定

- **路径别名**：用 `@/...`（`tsconfig.json` 与 `vitest.config.ts` 都已配置）。
- **Server Actions**：放在就近的 `actions.ts`（`app/(app)/…`）。action 里
  必须**重新 `auth()` 并重新跑一遍 Zod 解析**。
- **Schema 是契约**：改 `lib/resume-schema.ts` 会牵动表单、模板、autosave、
  PDF、分享与测试。新增字段保持向后兼容（`.default()` / `.optional()`），
  并在 plan 里记录。
- **测试镜像源码路径**：一文件一单元，命名等于源文件路径换连字符。
  `components/editor/projects-editor.tsx` → `tests/unit/projects-editor.test.tsx`。
- **模板**必须复用 `lib/templates/shared/*` 原语 —— 不要在单个模板里重复
  定义分区间距、prose 类名等。
- **编辑器状态**走 React Hook Form。`LivePreview` 通过 `useWatch()` 订阅；
  **不要**把 content 当 prop 往下传，否则每次击键都会重渲编辑器。
- **Autosave** 是 2 秒去抖串行队列（`hooks/use-resume-autosave.ts`）。
  在途保存永不会覆盖更新的编辑。事件处理里不要 `await` 它；如需立即
  保存，派发 `resume:flush-autosave` window 事件。
- **暗色模式**：新增的每个表面都要补 `dark:` 变体，用 header 里的主题切换
  按钮回归。
- **中文是用户文案的母语**。英文只用于代码、文件名、面向开发者的日志。
- **Commit 信息** 走 Conventional Commits（`feat:`、`fix:`、`chore:`、
  `docs:`、`test:`），可加 scope（`feat(editor): …`）。参考 `git log`。

## 8. 不显然的坑（排查前先扫一遍）

- **是 `proxy.ts`，不是 `middleware.ts`** —— Next.js 16 改名。鉴权拦截
  在这。改错文件不会报错，只是没效果。
- **PDF 路由复用预览页**：`/api/pdf/[id]` 用 Puppeteer 打开
  `/resume/[id]/preview?_pdf=1` 并转发 session cookie。预览坏了 PDF 必然
  坏。先修预览。
- **两个 DB 驱动，一份 schema**：`db/connection.ts` 按主机名挑驱动。**永远
  通过 `db/index.ts` 拿 `db`**，不要直接 import Neon client。
- **构建期占位 DATABASE_URL**：`db/index.ts` 在 `next build` 时回退到
  占位串，运行时仍会失败。这是有意为之，不要「修掉」那条警告。
- **TipTap 内容是 JSON，不是 HTML**：存储用 `TipTapJSON`，转换工具在
  `lib/tiptap-types.ts` 和 `lib/migrate-content.ts`。只有模板渲染器
  应该产出 HTML。
- **头像上传是公开可读的**：因为共享简历要直接展示。要改成私有前必须
  重新设计 `/r/[slug]`。
- **拖拽用 Pragmatic D&D，不是 dnd-kit**（`d30ed01` 已迁移）。不要把
  dnd-kit 加回来。
- **`shadcn/ui` 是生成的**：要改去 `components/editor/*` 包一层，或者
  用 shadcn CLI 重新生成。

## 9. 改这块？先看这里（Playbook）

| 你要改的东西 | 入口 |
|---|---|
| 内容模型 / 新字段 | `lib/resume-schema.ts` → 对应 `components/editor/` 编辑器 → `lib/templates/*` 模板 → `tests/unit/resume-schema.test.ts` |
| 某个模板的版式 | `lib/templates/<id>/Layout.tsx` + `lib/templates/shared/*` |
| 编辑器分区交互 | `components/editor/<section>-editor.tsx`（拖拽看 `section-wrapper`、`item-wrapper`） |
| 实时预览卡顿 | `components/preview/live-preview.tsx`（用 `useWatch`）—— **不要**改成 prop 传 content |
| Autosave / 「保存失败」 | `hooks/use-resume-autosave.ts`、`lib/format-save-error.ts`、`app/(app)/resume/[id]/edit/actions.ts` |
| Dashboard | `app/(app)/dashboard/page.tsx` + `actions.ts`（`duplicateResume` 等） |
| 鉴权跳转 / 受保护路径 | `proxy.ts`、`lib/auth.ts`、`app/(auth)/login/*` |
| PDF | `app/api/pdf/[id]/route.tsx` + `lib/pdf-route-helpers.ts` + `/resume/[id]/preview` 页 |
| 公开分享 | `app/r/[slug]/page.tsx`、`lib/slug.ts`、`toggleShare` action |
| 样式 / 主题 | `app/globals.css`、`components/ui/*`、`app/layout.tsx` 里的 `next-themes` |
| 新增模块类型（如「个人总结」） | `lib/resume-schema.ts` 的 `MODULE_PRESETS` + `lib/section-meta.ts` + `module-manager.tsx` + （可选）专用编辑器 |

## 10. 绝不要做的事

- DB schema 改了，但没有 Drizzle migration **以及**针对存量 `jsonb`
  的回填方案。
- 引入新的全局可变状态。表单状态归 RHF，跨模块状态走 server 数据 + URL。
- 加新依赖却不评估 `pnpm-lock.yaml` 体积影响、不在 plan 里写理由。
- 用 `// @ts-expect-error` 或 `as any` 蒙混类型检查。要么修类型，要么把
  schema 明确放宽。
- 同一处面向用户的文案中英混搭。
- 提交 `.env*`、真实 `DATABASE_URL`、Blob token 或 Resend key。
- 直接推 `main` —— 必须开 PR，CI 必须绿。

## 11. 交接给下一个 Agent

每个有产出的会话结束时，留一段交接笔记（聊天里、PR 描述里、或对应的
plan 文件里）：

1. **本次目标** —— 一句话。
2. **落了什么** —— 改了哪些文件、交付了什么行为、加了哪些测试。
3. **验证到哪一步** —— 闸门输出（`pnpm test`、`tsc`、`lint`、`build`）。
4. **遗留事项** —— 暂缓的 bug、TODO、下一步的 plan 节点。
5. **奇怪的发现** —— 下一位不应再踩一次的坑。

每次新 Agent 启动都会读到这份文件；请保持它的准确度，让未来的你不必
再考古一遍。
