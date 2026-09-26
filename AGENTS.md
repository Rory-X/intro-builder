<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# intro-builder — Agent 协作手册

**第一次动手前请通读本文件。** 它是协作的唯一信息源（`CLAUDE.md` 只是
`@AGENTS.md` 转引）。保持简短、诚实、最新——如果哪条规则被你证伪了，
就在同一个 PR 里改掉它。

## 1. 一句话项目摘要

- **产品**：面向中文互联网求职者的在线简历排版与 AI 辅助工具。结构化编辑 /
  简历导入 → 实时分页预览 → 模板库与智能排版 → Agent 辅助诊断、润色、改写 →
  A4 PDF / 公开只读链接 `/r/[slug]` / 协作审阅。
- **当前阶段**：v0.5 编辑器内新手引导（待评审）。主线已从三套内置模板扩展到
  模板库、上传模板 Schema v2、协作批注、文档站、邮箱验证码登录，以及基于
  Next.js + AI SDK 的 AI 助手浮窗、长循环、流式对话、版本 Diff 与 Undo/Redo
  （独立的 Agent 微服务已退役归档，执行收敛到 Next.js 单一路线）。
  v0.4.2 已恢复安全、自动化和文档基线；v0.5 采用 BYOK-first「边做边学」路径，
  直接在真实编辑器中介绍编辑、预览、排版安全、AI 辅助与 Agent，不再建设独立
  的三步创建页。后续产品切片需另行筛选，不与依赖 major 升级混做。
- **远端事实**：当前工作区的 `origin` 指向
  `https://github.com/Rory-X/intro-builder.git`，是项目真实远端；`zoo` 指向
  `ZOO-AiiiPM/intro-builder-zoo.git`。用户说“远端 / 最新 / pull / PR”时，默认
  查 `Rory-X/intro-builder`、`origin/main` 和该仓库的 PR ref。不要假设存在
  `upstream` remote；先用 `git remote -v` 核对。
- **对 Agent 的预期**：交付小而可验证的切片。任何非平凡改动都必须走第 4 节
  的「spec → plan → 实现 → 验证 → 发布」回路。没有跑过第 6 节闸门
  之前，**不要**声称完成。

## 2. 技术栈速览

| 维度 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js **16.2** App Router | 见文件顶部红字。`middleware.ts` 现在叫 `proxy.ts`。 |
| 运行时 | React **19.2**，CI 使用 Node **22**、pnpm **10** | pnpm workspace 覆盖根、两个 app 与共享 packages（已退役的旧服务在 `archive/`，不是成员）。 |
| 鉴权 | Auth.js v5 + Resend 魔法链接 | `lib/auth.ts`；14 天数据库会话。 |
| 数据库 | Drizzle ORM + Postgres | `db/schema.ts`。`*.neon.tech` 走 Neon HTTP，其它走 `postgres.js` TCP。选择器在 `db/connection.ts`。 |
| 表单 | React Hook Form + Zod | `packages/shared/src/schemas/resume-schema.ts` 是简历内容的唯一契约。 |
| 富文本 | TipTap v3 + 扩展 | 存储是 TipTap JSON；只读渲染在 `components/preview/rich-text-renderer.tsx`；Agent 润色要走 JSON ↔ HTML 的既有转换工具。 |
| 拖拽 | `@atlaskit/pragmatic-drag-and-drop` | 分区与条目排序。 |
| PDF | Puppeteer + `@sparticuz/chromium` | 与预览复用同一 DOM，见第 8 节。 |
| Agent | Next.js + Vercel AI SDK | 前端在 `components/agent/` 与 `app/api/agent/*`，执行在 `lib/ai/` 与 `app/api/ai/*`（统一 Run）。旧微服务已归档，见 `archive/agent-microservice/`。 |
| 协作 | Yjs + PartyKit | 前端在 `components/collab/`，边缘服务在 `apps/partykit/`。 |
| 文档 | Fumadocs MDX | `app/docs`、`lib/source.ts`。 |
| 存储 | Vercel Blob | 仅头像；`app/api/upload-photo/route.ts`。 |
| 样式 | Tailwind v4 + shadcn 原语 | `components/ui/`；暗色模式走 `next-themes`。 |
| 测试 | Vitest + jsdom + Testing Library | `pnpm test` 递归执行 Web 与 PartyKit 测试（归档目录排除在外）。 |

## 3. 仓库地图（只列 Agent 真正要看的）

```
apps/
  web/                # Next.js 主站
    app/              # App Router 路由
      (marketing)/    # 公开落地页
      (auth)/         # /login、/verify-request（魔法链接）
      (app)/          # 登录后：dashboard、templates、settings、/resume/[id]/edit
      api/pdf/[id]/   # Puppeteer PDF 路由（复用 /resume/[id]/preview）
      api/agent/      # 浮窗会话、模型列表、富文本润色与简历助手；api/ai/ 是统一 Run 入口
      api/collab/     # 协作邀请、加入、owner token、session 状态
      api/import-resume/ # PDF / Word 简历导入
      api/upload-photo/  # Vercel Blob 上传
      collab/[token]/ # 导师 / 协作者进入页
      docs/、blog/    # Fumadocs 文档与内容页
      r/[slug]/       # 公开只读简历
    components/       # UI 组件
      agent/          # Agent 面板、模式切换、工具卡、简历助手入口
      collab/         # 批注、高亮、协作者在线状态、语音控件
      editor/         # 各分区编辑器（basics、experience、education、…）
      preview/        # live-preview、preview-panel、template-renderer
      shell/          # app header、brand、user menu
      templates/      # 模板选择、缩略图与预览抽屉
      ui/             # shadcn 原语 —— 不要手改，必要时用 shadcn CLI 重新生成
    lib/              # Web 专用工具
      auth.ts         # NextAuth v5 实例与 handlers
      agent/          # 浮窗会话存储、模型设置、操作应用、surface 开关（旧 AG-UI 桥已归档）
      templates/      # registry、uploaded HTML slot 渲染、共享原语
      style-presets.ts # 密度 / 行高 / 页边距预设
      client/         # 仅客户端工具（导出预览图等）
      pdf-route-helpers.ts # Puppeteer launch 配置 + 字体等待
    hooks/            # React hooks
      use-resume-autosave.ts # 去抖串行队列
    db/               # Drizzle schema + migrations + 驱动选择器
    proxy.ts          # 鉴权拦截 /dashboard、/resume/*/edit、/resume/*/preview
    tests/unit/       # 每个单元一个文件；文件名镜像源文件路径
  partykit/           # WebSocket 协同服务
    src/              # PartyKit server
packages/
  shared/             # 跨应用共享代码（**简历内容契约在这里，不在 apps/web/lib**）
    src/
      types/          # 共享类型（resume、agent、tiptap）
      schemas/        # Zod schemas（resume-schema）—— 简历内容的唯一契约
      utils/          # 通用工具（migrate-content、tiptap、slug）
  config/             # 共享配置（eslint、typescript）
docs/
  superpowers/        # specs/ 与 plans/ —— 交付流程产物（一次交付的设计与步骤）
  notes/              # 决策笔记 —— 承重决策的归属地，见 §4.6
  notes-templates/    # 笔记模板（放在 notes 根之外，否则树校验会拦）
  schema-v2/          # 上传模板的 slot 协议与数据契约
scripts/              # monorepo 脚本
  db/                 # 数据库迁移、检查
  dev/                # 开发环境初始化
  notes/              # 决策笔记的校验与归档脚本（§4.6 的门禁）
  templates/          # 模板验证
```

## 4. Vibe 协作流程（不要跳步）

任何非平凡改动都走这条流水线。

| 步骤 | 产物 | 落地位置 | 说明 |
|---|---|---|---|
| 1. 头脑风暴 | 对意图与约束的共识 | 聊天 | — |
| 2. Spec | `docs/superpowers/specs/YYYY-MM-DD-<slug>.md` —— 解释「做什么 & 为什么」 | 仓库 | 与 plan 同族 |
| 3. Plan | `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` —— 有序步骤 + 风险 + DoD | 仓库 | 一份 plan = 一个可发布切片 |
| 4. TDD | 先写失败测试，再写实现 | `apps/web/tests/unit/*` | — |
| 5. 实现 | 让测试变绿的最小切片 | 代码 | — |
| 6. 决策笔记 | 非平凡改动留 Note；随代码**同批**提交 | `docs/notes/{implemented,proposed}/<class>/` | 见 §4.6 |
| 7. 验证 | 本地跑通第 6 节闸门，附输出 | 聊天 / PR | — |
| 8. 评审 | 带上 plan 链接请求 review | PR | — |
| 9. 发布 | 合并 + 关闭 plan + 记录 | 仓库 | — |

铁则：

- **Spec 回答「为什么/做什么」，Plan 回答「按什么顺序怎么做、退出条件
  是什么」**。两者不要混。
- **一份 plan 对应一个可发布切片**。一份 plan 步骤超过 10 步就拆开。
- **就地更新 plan**。被现实证伪后没更新的 plan 比没有 plan 更糟。
- 排查 bug 时先建立假设、收集证据（日志、失败用例），把根因写下来再打补丁。
- 可并行的任务只在**子任务真正独立、不会改到同一份文件**时才并行。

> **关于 skill**：上表步骤历史上对应 Superpowers 的 skill 名
> （`brainstorming`、`writing-plans`、`test-driven-development` 等）。这些
> skill **在本仓库的常用运行环境里并不存在**——本仓库没有 vendored 它们，
> 当前运行时的 skill 目录里也没有同名项。所以上表按**等价流程**执行，
> **不要伪造 skill 文件路径，也不要因为没有 skill 就跳过步骤**。
> 运行环境若确实提供了同名 skill，则先读它。
> 可用的等价 skill：`tdd`、`code-review`、`prototype`、`research`、
> `grilling`、`codebase-design`。

### 4.5 关键决策必须当面闭合（硬约束）

如果出现「选 A 还是 B」「保留还是废弃」这类**关键决策**——
判据：**选错会导致 ≥3 个文件返工，或会让下游架构推翻重做**——必须：

1. 用 `ask_user_question` 工具在聊天里弹出（**不要**只写进 spec 第 N 节）
2. 给出倾向方案 + 一行理由（≤30 字），让用户看一眼就能拍板
3. **用户答复前禁止开 plan / 禁止开始写实现代码**

为什么这样：把决策埋进文档，对「看效果不看文档」的用户**功能上等同于不问**——
等到 plan 跑完才发现决策错了，全部返工。这是项目里反复出现 v1/v2/v3/v4/v5
迭代图与连续 `fix:` commit 的根因。反例（绝对不要做）：在 spec §11 写
「待用户拍板：……」然后继续启动 plan。

不是关键决策的小事（按钮文案、间距 8px vs 12px、变量名）不要弹——
判据是「选错要重做 ≥3 个文件吗」，不是「我不确定吗」。

### 4.6 决策笔记：非平凡改动必须留 Note（机械门禁）

代码只能说清「系统现在怎么跑」，说不出「为什么必须这样跑、以及放弃了什么」。
仓库已经为此付过代价：Hono + AI SDK 重写被整体回退（`29bdb039b`），但
「为什么这条路不行」当时没有任何结构化沉淀，下个会话很容易再提一次。

**判定**：命中以下任一项即非平凡，**必须**留笔记——改了**行为**、**架构**、
**跨文件契约**、**流程与工具链**、**测试策略**、**落盘/网络/配置格式**，
或其他维护者日后可能重访的决定。纯机械改动（样式、格式化、错别字、无歧义
重命名、不改行为的依赖补丁、常规 CRUD）**直接提交代码，不要留笔记**。

**结构**：`docs/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`

- lifecycle：`proposed/`（动手前）、`implemented/`（已落地）、`rejected/`（否决，防重犯）、`archived/`（封存只读）
- class（封闭集，**不许自造**）：`feature`、`bug-fix`、`simplification`、`architecture`、`process`、`testing`
- **不要建 `INDEX.md`**：多分支并行时总索引是最抢手的冲突源，目录位置本身就是索引。
- 模板在 `docs/notes-templates/`（**放在 notes 根之外**，否则树校验会拦）。

**铁则**：

- **优先原地更新既有笔记的事实**（路径、符号、默认值），不要追加变更流水账。
- **决定翻转才新开一篇并互链**；**严禁**把 `## Decision` 改写成反面。
- `## Alternatives considered` **必写**：只记真实权衡过的对手方案，**先写它最强的
  理由再否定**。没考虑过的选项不要编，「不做」仅当当时真的权衡过才写。
- `## Consequences` 同时写**收益和代价**，并写明「什么信号发生时该重访」。
- **笔记与代码同一次 commit / 同一个 PR**，不让笔记掉队。

**门禁**（有机械牙齿，不靠自觉）：

```bash
pnpm notes:verify    # 树结构 + 头块骨架 + 归档封印（CI 跑这个）
pnpm notes:archive <note> [--superseded-by <new>]  # 归档：封印 + 死链报告
pnpm notes:anchors   # 软报告：源码 // Note: 锚点，恒退出 0，不进 CI
```

已被证实的拦截：自造 class 目录、`implemented` 残留 `## Proposal`、缺
`## Alternatives considered`、笔记间死链、以及**归档被改一个字符即 seal
mismatch**（`--write` 无法洗白，git 基线独立兜底）。

### 4.7 新视觉 / 新交互 / 新架构必须先做最小 PoC

spec 涉及以下任一类时，写 plan 之前先做**最小 PoC**：

- **新视觉风格**：新模板、新装饰元素、新布局
- **新交互模式**：新拖拽方式、新编辑器组件、新预览机制
- **新底层架构**：新数据结构、新渲染管线、新 schema 字段语义

PoC 标准：

1. **是单文件 / 单页面 / 静态 demo**，不接 DB、不接 auth、不走完整流程
2. **产出可视化结果**（截图 / 链接），**不要用文字描述效果**
3. **PoC 不通过就改 spec 或换方案，禁止开 plan**

判据：**写代码时如果发现「这个不符合假设」——说明 PoC 应该提前做**。
（历史教训：模板 v2 的 crimson 迭代线反复改版，正是假设验证太晚。）

## 5. Skill 索引（按需读取）

**本仓库 vendored 的 skill**：`.agents/skills/frontend-design/SKILL.md`
（做 UI 设计时读）。`template-studio-skill/SKILL.md` 是把参考简历转成
schema-v2 模板的产出工具。

**`.cursor/rules/*.mdc` 已废弃**：那 4 份领域规则（DB 演进、Server Action 鉴权、
模板/PDF 一致性、编辑器状态）写于 monorepo 重构之前，`globs` 指向的
`db/**`、`lib/**`、`components/**` 等路径**已不存在**（现为 `apps/web/**`、
`packages/shared/**`），且 `.cursor/` 在 `.gitignore` 中被整目录忽略——
**它们从未进入仓库，也不会被任何运行环境加载**。其中的承重内容已迁入
`docs/notes/`，以那里的笔记为准。

第 4 节的步骤**不依赖任何特定 skill 存在**。运行环境若提供同名 skill 则先读；
没有就按等价流程执行，**不要伪造 skill 文件路径，也不要因为缺少 skill 就跳过步骤**。

## 6. 完成定义（Definition of Done）

声称完成或开 PR 之前，本地必须全绿。CI（`.github/workflows/ci.yml`）跑
lint、typecheck、unit tests、**以及决策笔记门禁**；本地还要跑生产构建，
因为构建能捕获 RSC / 路由错误（CI 目前不跑 build）。加上
`.github/workflows/deploy-partykit.yml` 的协同服务部署闸门。
本地通过是**必要条件，不是充分条件**。

```bash
pnpm test             # 递归执行 Web 与 PartyKit 的 vitest
pnpm typecheck        # 递归 tsc --noEmit（web / partykit / shared / config）
pnpm lint             # eslint
pnpm build            # 生产构建（捕获 RSC / 路由错误）
pnpm notes:verify     # 决策笔记门禁（§4.6）
```

> **命令注意**：不要用 `pnpm tsc --noEmit`——根 `package.json` 没有 `tsc`
> script，正确入口是 `pnpm typecheck`。`tsconfig` 的 `exclude` 含 `tests`，**测试文件不参与
> 类型检查**，测试里的类型错误只能靠 Vitest 运行时暴露。

> **运行时版本**：CI 用 **Node 22 + pnpm 10**。更新的本地 Node（如 26）曾让
> `localStorage` 与 `req.formData()` 在 jsdom 下失效，产生过上百个假失败——
> 已在 `apps/web/tests/setup.ts` 里做了运行时对齐。若你仍遇到成片的
> 「本地红、CI 绿」，先用 `node -v` 对照 CI 版本，**不要**急着去改业务代码。

任何 UI / 数据流改动还要补一次手工冒烟：

- `pnpm dev` 走一遍你动过的流程。
- AI 助手改动：`pnpm dev` 走一遍浮窗打开、发送消息、工具卡展示或富文本润色流程。
  （不再需要单独启动 Agent 服务 —— 执行已在 Next.js 进程内。）
- 协作改动：同时跑 Next 与 PartyKit dev，确认邀请链接、在线状态、批注同步。
- PDF / 预览改动：进 `/resume/<id>/edit` 点「下载 PDF」，对比 PDF 与实时
  预览是否一致。
- 鉴权 / proxy 改动：登出后访问受保护路径，确认跳到
  `/login?next=…`。

绝不允许：

- 「改动很小」就跳过闸门。
- 在同一 diff 里压制 lint 却不解释原因。
- 落「dev 环境看着没问题」的代码。
- 非平凡改动却没有对应的决策笔记（§4.6）。

## 7. 项目约定

- **路径别名**：用 `@/...`（`tsconfig.json` 与 `vitest.config.ts` 都已配置）。
- **Server Actions**：放在就近的 `actions.ts`（`app/(app)/…`）。action 里
  必须**重新 `auth()` 并重新跑一遍 Zod 解析**。
- **Schema 是契约**：改 `packages/shared/src/schemas/resume-schema.ts` 会牵动
  表单、模板、autosave、PDF、分享与测试。新增字段保持向后兼容
  （`.default()` / `.optional()`），并在 plan 里记录。**重命名或删除字段**必须
  在 `packages/shared/src/utils/migrate-content.ts` 加读侧迁移并补样本单测——
  详见 `docs/notes/implemented/architecture/2026-06-11-resume-content-lazy-migration.md`。
- **测试镜像源码路径**：一文件一单元，命名等于源文件路径换连字符。
  `components/editor/projects-editor.tsx` → `tests/unit/projects-editor.test.tsx`。
- **模板**必须复用 `lib/templates/shared/*` 原语 —— 不要在单个模板里重复
  定义分区间距、prose 类名等。
- **编辑器状态**走 React Hook Form。`LivePreview` 通过 `useWatch()` 订阅；
  **不要**把 content 当 prop 往下传，否则每次击键都会重渲编辑器。
- **Autosave** 是 2 秒去抖串行队列（`hooks/use-resume-autosave.ts`）。
  在途保存永不会覆盖更新的编辑。普通输入继续后台保存；需要确认已经落盘的
  Agent / 恢复流程必须 `await requestResumeAutosaveFlush()`，只有 fire-and-forget
  场景才直接派发 `resume:flush-autosave` window 事件。
- **暗色模式**：新增的每个表面都要补 `dark:` 变体，用 header 里的主题切换
  按钮回归。
- **中文是用户文案的母语**。英文只用于代码、文件名、面向开发者的日志。
- **Commit 信息** 走 Conventional Commits（`feat:`、`fix:`、`chore:`、
  `docs:`、`test:`），可加 scope（`feat(editor): …`）。参考 `git log`。
- **远端同步** 默认以 `origin/main` 为基准。检查 PR 状态时用
  `Rory-X/intro-builder` 的 PR 信息与 refs；需要更新 PR 分支时，再把确认后的
  本地结果推到承载该 PR 的分支。

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
  `packages/shared/src/types/tiptap.ts` 和
  `packages/shared/src/utils/migrate-content.ts`。只有模板渲染器
  应该产出 HTML。
- **Agent 消息不是普通聊天 JSON**：前端适配层在 `lib/agent/` 与
  `components/agent/`，服务端契约在 `lib/ai/`（统一 Run 的事件模型）。
  改流式、工具调用或缓存前先看 `docs/notes/` 里 AI 相关的决策笔记与已有测试。
  旧微服务的契约在 `archive/agent-microservice/2026-09-26/source/`（只读考古）。
- **上传模板走 HTML slot 协议**：入口在 `lib/templates/uploaded/*` 与
  `docs/schema-v2/*`。不要把上传模板退回内置 React 模板思路。
- **头像上传是公开可读的**：因为共享简历要直接展示。要改成私有前必须
  重新设计 `/r/[slug]`。
- **拖拽用 Pragmatic D&D，不是 dnd-kit**（`d30ed01` 已迁移）。不要把
  dnd-kit 加回来。
- **PartyKit CLI 没有 `build` 子命令**：`apps/partykit` 的 `build` 脚本用
  `tsc --noEmit` 做离线校验。看到 CLI 帮助页不代表构建成功。协作 token 必须由
  Web 与 PartyKit 共用 `COLLAB_JWT_SECRET`，生产部署缺失时应 fail closed。
- **`shadcn/ui` 是生成的**：要改去 `components/editor/*` 包一层，或者
  用 shadcn CLI 重新生成。
- **测试环境的 jsdom 与 Node 原生对象会打架**：`apps/web/tests/setup.ts` 里有两处
  运行时对齐（Storage 兜底、`File`/`FormData` 配对）。它们修的是 Node 26 与
  jsdom 的冲突，**删掉会退回上百个假失败**。看到「成片测试挂 + 栈里全是
  `window.localStorage` 或 `webidl.is.File`」就是这一类，先查 Node 版本，
  不要去改业务代码。
- **`pnpm-workspace.yaml` 里的 `verifyDepsBeforeRun: false` 是有意为之**：
  pnpm 11 默认在每条 script 前跑一次隐式 `pnpm install`，在非交互 shell 里会
  以 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 失败，导致 `pnpm test` 之类
  根本没执行就报错。不要「修掉」这个配置。

## 9. 改这块？先看这里（Playbook）

| 你要改的东西 | 入口 |
|---|---|
| 内容模型 / 新字段 | `packages/shared/src/schemas/resume-schema.ts` → 对应 `components/editor/` 编辑器 → `lib/templates/*` 模板 → `tests/unit/resume-schema.test.ts` |
| 模板版式 / slot 渲染 | `lib/templates/render*.tsx` + `lib/templates/uploaded/*` + `docs/schema-v2/*` |
| 模板库页面 / 缩略图 | `app/(app)/templates/*` + `components/templates/*` |
| 编辑器分区交互 | `components/editor/<section>-editor.tsx`（拖拽看 `section-wrapper`、`item-wrapper`） |
| 实时预览卡顿 | `components/preview/live-preview.tsx`（用 `useWatch`）—— **不要**改成 prop 传 content |
| Autosave / 「保存失败」 | `hooks/use-resume-autosave.ts`、`lib/format-save-error.ts`、`app/(app)/resume/[id]/edit/actions.ts` |
| Dashboard | `app/(app)/dashboard/page.tsx` + `actions.ts`（`duplicateResume` 等） |
| AI 助手 / 流式 / 工具调用 | `components/agent/*` + `lib/ai/*` + `lib/ai-client/*` + `app/api/ai/*`（统一 Run） |
| AI 富文本润色 | `app/api/agent/rich-text/polish/route.ts` + `lib/ai/capabilities/polish*.ts` + `components/editor/rich-text-editor.tsx` |
| 协作批注 / 导师链接 | `components/collab/*` + `hooks/use-collab-*` + `app/api/collab/*` + `partykit/src/*` |
| 鉴权跳转 / 受保护路径 | `proxy.ts`、`lib/auth.ts`、`app/(auth)/login/*` |
| PDF | `app/api/pdf/[id]/route.tsx` + `lib/pdf-route-helpers.ts` + `/resume/[id]/preview` 页 |
| 公开分享 | `app/r/[slug]/page.tsx`、`lib/slug.ts`、`toggleShare` action |
| 样式 / 主题 | `app/globals.css`、`components/ui/*`、`app/layout.tsx` 里的 `next-themes` |
| **决策笔记 / 门禁脚本** | `docs/notes/*`（承重决策读这里）、`scripts/notes/*`（校验与归档） |
| 新增模块类型（如「个人总结」） | `packages/shared/src/schemas/resume-schema.ts` 的 `MODULE_PRESETS` + `lib/section-meta.ts` + `module-manager.tsx` + （可选）专用编辑器 |

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
- **非平凡改动不留决策笔记**，或让笔记与代码不同批提交（§4.6）。
- 只改代码而让 `docs/notes/` 里的既有笔记**变陈旧**——事实变了就地更新，
  决定翻转才新开一篇。错误的笔记比没有笔记更危险。

## 11. 交接给下一个 Agent

每个有产出的会话结束时，留一段交接笔记（聊天里、PR 描述里、或对应的
plan / Note 文件里）。**承重决策写进 `docs/notes/`（§4.6），不要只留在聊天里**——
聊天会随会话消失，笔记不会。内容包含：

1. **本次目标** —— 一句话。
2. **落了什么** —— 改了哪些文件、交付了什么行为、加了哪些测试。
3. **验证到哪一步** —— 闸门输出（`pnpm test`、`tsc`、`lint`、`build`）。
4. **遗留事项** —— 暂缓的 bug、TODO、下一步的 plan 节点。
5. **奇怪的发现** —— 下一位不应再踩一次的坑。

每次新 Agent 启动都会读到这份文件；请保持它的准确度，让未来的你不必
再考古一遍。
