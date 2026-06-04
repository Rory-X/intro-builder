# Plan: 彻底消除"内置模板(builtin)"概念,统一为 DB upload 行

**日期**: 2026-06-04
**类型**: 架构升级(非平凡,多文件 + RSC/CC 边界连锁)

## 背景与目标

历史上 classic/modern/professional 是"内置模板":数据劈成两半(`lib/templates/*/meta.ts` 存 name/category/features/默认排版 + `templates/html/*.{html,css}` 存结构样式),运行时由 `registry-server.ts` 读本地文件、走 builtin 特殊分支。

**目标终态**:内置概念彻底消失。三套模板就是 DB `templates` 表里的普通行,和用户上传模板**走完全相同的获取/渲染路径**。代码里**不许有任何 builtin 特殊分支,运行时不许读本地模板文件**。

这是个**部署的网站**:生产环境信任生产 DB,本地文件仅曾用于开发兜底,现一并退役。

## 已确认的决策(动手前不要再改)

1. **默认模板** = DB 行上的 `isDefault` 标记(新增列)。新建简历/导入/兜底都查"isDefault=true 的那行",不再用硬编码常量。
2. **本地文件 + seed 源都不留(B)**:`templates/html/*`、`lib/templates/*/meta.ts`、以及一次性 seed 脚本本身,迁移完成后全部删除。模板定义只存**生产 DB**;新环境/CI/灾备只能从生产库拷贝(dump/restore),仓库内不再有任何可重建模板的种子。
3. **DB 是唯一真源**:生产 DB 首次上线/换库时必须 seed 一次(一次性 bootstrap);无本地兜底——这是网站的正常形态,接受。
4. **客户端 props 化**:删掉打包进浏览器的 builtin meta 后,客户端组件不能再同步抓 meta,必须由服务器组件查 DB、用 props 传下去。

## 风险与铁律(最重要)

- **部署时序**:必须 **先 seed 生产 DB → 再部署"移除本地兜底"的代码**。顺序反了,线上会出现"一个模板都没有"。这是上线关口,写进发布步骤。
- **必须恰好一行 `isDefault=true`**:默认查询依赖它。seed 要保证 professional(或指定那套)唯一置 true;0 行或多行都会让"新建简历"行为异常。
- **RSC/CC 边界**:Phase 3 把同步 meta 改成 props,最易引入"client component 误 import server code 拖垮 bundle"或"少传 prop 渲染空"。每动一个组件,`pnpm build` 单独验一次。
- **空库 = 无模板,且无种子可种(决策 3 + B)**:生产靠首次一次性 bootstrap;之后任何新环境只能从生产库 dump/restore,仓库内不再有重建来源。**因此生产 DB 现在是模板的唯一副本——必须确保它开了自动备份 / PITR,否则丢库 = 模板彻底没了。**

## 阶段(按依赖顺序,每阶段独立 commit + 可回滚)

### Phase 0 — 数据落库 + 默认标记(不删任何旧东西)
1. `db/schema.ts`:templates 表加 `isDefault: boolean("isDefault").notNull().default(false)`。`drizzle-kit generate` 出 migration。
2. **一次性 seed 生产 DB(B)**:用现有 `scripts/seed-builtin-templates.ts`(读当前 `templates/html/*` + `meta.ts`)向**生产 DB** 灌入三套模板,professional 置 `isDefault=true`。这是**一次性 bootstrap**——生产库里有了这三行,seed 的使命就完成;脚本与本地文件将在 Phase 4 删除,此后不再保留任何种子(决策 B)。
3. 跑 seed 到生产 DB;`scripts/verify-templates.ts` 确认三行 published、professional `isDefault=true`、html/css/sectionIcons/defaultStyleSettings 完整。
4. 本阶段不动渲染代码——此时本地兜底仍在,app 照常。可单独 commit + 上线 seed。

**执行记录(2026-06-04)**:
- 已删过期镜像文档 `docs/data-schema.md`;当前 schema 真源只认 `db/schema.ts`。
- 已加 `templates.isDefault`、手写 `0009_add_template_is_default.sql`,并更新 seed/verify 脚本。由于 `0007/0008` 是手写迁移且缺 snapshot,本阶段没有使用 `drizzle-kit generate`。
- 当前 `.env.local` 连接的库已执行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "isDefault"` 并 seed 成功:professional/classic/modern 三行 published,且 professional 是唯一默认模板。
- 本地验证通过:`pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts`,`pnpm test`,`pnpm tsc --noEmit`,`pnpm lint`,`pnpm build`。lint 为 0 errors,仍有既有 warnings。
- **进入 Phase 1 前必须确认生产库也已执行同样 migration + seed**;不要在未确认生产 DB 的情况下删除本地兜底。
- 迁移注意:`db/migrations/meta/_journal.json` 已补 `0007/0008/0009` 记录,但 `meta/0007_snapshot.json+` 仍缺失。下次再用 Drizzle 自动生成迁移前,先修 snapshot 漂移,否则生成器仍可能从旧 `0006_snapshot` 推导出错误 diff。

### Phase 1 — gut 解析引擎(`lib/templates/registry-server.ts`)
删除:`getBuiltinHtmlFallback`、`getBuiltinHtmlFallbackTemplate`、`listBuiltinHtmlFallbackTemplates`、`import { readFileSync }`、`UNIFIED_BUILTIN_IDS`、`isBuiltinId`、`isUnifiedBuiltinId`、`usesUnifiedBuiltinRenderer`。
重写:
- `getTemplateMetaAsync(id)`:有 id → `fetchUploadedTemplate(id)`;无 id 或查不到 → 查 `isDefault=true` 的行。永远返回 DB 结果,无 builtin/本地分支。
- `listAllTemplatesAsync()`:只查 DB(published)+ 排序,删掉与 `TEMPLATES` 常量的合并逻辑。
- `getTemplateDefaultStyleSettings`:从 DB 行的 `defaultStyleSettings` 取,删 builtin 分支。
- 新增一个 `getDefaultTemplateId()`(查 isDefault 行)供消费方用。

### Phase 2 — gut 客户端 registry + 类型
- `lib/templates/registry.ts`:删 `TEMPLATES`、`getTemplateMeta`、`resolveTemplateId`、对 `*/meta.ts` 的 import。保留仍需的纯类型(`TemplateCategory`、`AllTemplatesItem`——其 `source` 不再是 builtin/uploaded 联合,收敛掉)。
- `lib/templates/types.ts`:删 `BUILTIN_TEMPLATE_IDS`、`BuiltinTemplateId`、`DEFAULT_TEMPLATE_ID`;`TemplateId` 收敛为 `string`。
- `lib/templates/render.tsx`:删 `SerializableResolvedTemplate` 的 `source:"builtin"` 变体 + 对应 throw 分支;确认所有模板都走 unified(每行都有 html)。
- `lib/templates/index.ts`:删 builtin/meta 相关 re-export。

### Phase 3 — 消费方 + 客户端 props 化(决策 4)
逐个改(每个改完单独 `pnpm build` 验):
- `app/(app)/dashboard/actions.ts`、`app/api/import-resume/create/route.ts`:硬编码/`DEFAULT_TEMPLATE_ID` → 服务端 `getDefaultTemplateId()`。
- `app/(app)/resume/[id]/edit/page.tsx`:删 `BUILTIN_TEMPLATE_IDS` 过滤(DB 行就是全部,不用跳过)。
- `app/(app)/resume/[id]/edit/editor-client.tsx`、`components/templates/template-thumbnail.tsx`、`components/editor/module-manager.tsx` 等**客户端组件**:不再 import registry 的同步 meta;改由其**服务器父组件**查好(meta/默认排版)用 props 传入。
- `app/(marketing)/page.tsx`、`app/(app)/templates/page.tsx`:删 `TEMPLATES`/`listBuiltinHtmlFallbackTemplates`,只用 `listAllTemplatesAsync()`;结果统一 `source:"unified"`。
- `lib/completeness-score.ts`、`components/collab/mentor-editor-client.tsx`、`app/(app)/templates/actions.ts` 等:清掉对 builtin 常量/概念的引用。

**执行记录(2026-06-04)**:
- Phase 1 已完成:`registry-server.ts` 删除本地文件 fallback 和 builtin 分支,模板解析只查 DB row;未知/空 id 回退到唯一 `isDefault=true` 的 published row。
- Phase 2 已完成:`registry.ts/types.ts/render.tsx/index.ts` 不再导出 `TEMPLATES`/`DEFAULT_TEMPLATE_ID`/`BUILTIN_TEMPLATE_IDS`/`BuiltinTemplateId`/`resolveTemplateId`;客户端只保留类型和服务端传入的序列化模板。
- Phase 3 已完成:dashboard 新建、导入简历、编辑页、模板库页、营销页、模板抽屉等改为 DB/default props 路径;测试 fixture 改为 DB/unified 模板。
- 验证通过:`pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts`,`pnpm test`,`pnpm tsc --noEmit`,`pnpm lint`,`pnpm build`。当前 lint 为 0 errors,9 warnings。
- 旧静态模板常量 grep 已清零:`TEMPLATES`/`DEFAULT_TEMPLATE_ID`/`BUILTIN_TEMPLATE_IDS`/`BuiltinTemplateId`/`TEMPLATE_IDS`/`resolveTemplateId`/`getTemplateMeta(` 无残留。
- **Phase 4 暂停门槛**:删除 `templates/html/*` 和 `scripts/seed-builtin-templates.ts` 前,必须确认生产 DB 已完成 `isDefault` migration + seed;否则删除 seed 源会破坏上线顺序。

### Phase 4 — 删本地文件 + meta.ts + 注释 + dev 脚手架
前提:Phase 0-3 完成且生产已 seed,确认无人读本地。
- 删 `templates/html/*.{html,css}`(含 `red-tag.*` 孤儿)。
- 删 `lib/templates/{classic,modern,professional}/meta.ts`(及空目录)。
- 删 `scripts/seed-builtin-templates.ts`(决策 B:一次性 bootstrap 已完成,种子退役)。
- 删 `app/dev-preview/template/*`(classic-v2 / handcoded-crimson / *-legacy 等 readFileSync 本地的对照页)。
- 更新 `db/schema.ts` 两段注释(templates 表 + templateFavorites):改成"所有模板都在本表"。
- 清理 `scripts/apply-templates-migration.ts` 等引用已删列/概念的旧脚本。

**执行记录(2026-06-04)**:
- 已确认 Phase 4 前置条件:生产 DB 已完成 `isDefault` migration + seed;professional/classic/modern 都是普通 published 行,且 professional 是唯一默认模板。
- 已删除 `templates/html/*.{html,css}`、`lib/templates/{classic,modern,professional}/meta.ts`、`scripts/seed-builtin-templates.ts`、`app/dev-preview/template/*`。
- 已删除仍引用旧模板列/旧本地模板概念的一次性脚本:`apply-avatar-img-migration.ts`、`backfill-frame-vertical.ts`、`dump-uploaded-templates-css.ts`、`migrate-uploaded-css-vars.ts`、`patch-template-headers.ts`。
- 已更新 `db/schema.ts`、模板收藏 action、thumbnail 注释与 `scripts/verify-templates.ts` 说明,统一为"所有模板都来自 DB 行"口径。

### Phase 5 — 测试 + 终验
- `tests/unit/html-slot-renderer.test.tsx`:本地文件已删、且无 seed 模块(决策 B),改成**测试自带的最小 html/css fixture**(单测只需任意合法模板验渲染器,不依赖真实模板)。
- 全仓 grep 必须**零残留**:`builtin`/`UNIFIED_BUILTIN`/`BUILTIN_TEMPLATE_IDS`/`BuiltinTemplateId`/`DEFAULT_TEMPLATE_ID`/`getBuiltinHtmlFallback`/`readFileSync.*templates/html`(排除 seed 模块与 docs)。
- 闸门:`pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` 全绿。
- 手工冒烟(`pnpm dev`,需连到已 seed 的 DB):
  1. 新建简历 → 自动套用默认模板(isDefault 那套)。
  2. 模板库 → 三套 former-builtin 和上传模板**并列、外观一致、无特殊标记**。
  3. 编辑器实时预览 + 切换模板正常。
  4. 下载 PDF 与预览一致。
  5. 故意访问不存在的 templateId → 回退到默认模板,不崩。

**执行记录(2026-06-04)**:
- `tests/unit/html-slot-renderer.test.tsx` 已改为测试内最小 HTML/CSS fixture,不再读取 `templates/html/*`。
- 旧概念扫描通过:在 `app components db hooks lib scripts tests` 下 `TEMPLATES`/`DEFAULT_TEMPLATE_ID`/`BUILTIN_TEMPLATE_IDS`/`BuiltinTemplateId`/`TEMPLATE_IDS`/`resolveTemplateId`/`getTemplateMeta(`/`getBuiltinHtmlFallback`/`UNIFIED_BUILTIN`/`isBuiltinId`/`isUnifiedBuiltinId`/`usesUnifiedBuiltinRenderer`/`templates/html`/`seed-builtin-templates`/`readFileSync.*templates/html` 零命中。
- DB 校验通过:`pnpm exec tsx --env-file=.env.local scripts/verify-templates.ts` 显示 professional/classic/modern 三行完整,published,且 professional 是唯一默认模板;模板列表共 6 行,全部来自 DB。
- 四闸门通过:`pnpm test`(49 files / 267 tests),`pnpm tsc --noEmit`,`pnpm lint`(0 errors,9 existing warnings),`pnpm build`。
- 本地冒烟通过:`pnpm dev` 在 `http://localhost:3002`;`/templates` 重试后 200 且 6 个 DB 模板并列展示;`/dashboard` 200 且卡片预览走 `data-template-id="modern"`;`/resume/856a0f5c-4ee1-49e2-8df9-951d3056ae04/edit?from=dashboard` 200 且编辑器实时预览正常渲染;`getTemplateMetaAsync("does-not-exist")` 回退到 DB 默认模板 professional。
- PDF 冒烟时发现 `/api/pdf/[id]` 仍只用 `auth()`、未吃 dev bypass,本地无 session 会 401。已改为 API 专用 `currentUserId()`(真实 session 优先,dev bypass 仅开发环境),复测 `POST /api/pdf/856a0f5c-4ee1-49e2-8df9-951d3056ae04` 返回 `application/pdf`,332KB,3 页。
- 新建简历冒烟前发现 dashboard server actions 也只用 `auth()`、未吃 dev bypass。已改为页面同源的 `requireUserId()`(真实 session 优先,dev bypass 仅开发环境),避免本地点击"新建简历"跳登录;相关 `dashboard-actions` 单测随全量 `pnpm test` 通过。

## Definition of Done
- 五个阶段全部完成,各自 commit。
- 第 5 阶段 grep 零残留 + 四闸门全绿 + 手工冒烟通过。
- 生产 DB 已 seed(三行 + 唯一 isDefault),发布按"先 seed 后部署"时序。
- `templates` 表 = 所有模板的唯一存储;代码中无 builtin 分支、无运行时本地读取。

## 交接笔记(给执行 agent)
- 严格按 Phase 顺序;**Phase 0 的 seed 必须先到生产**再推进删本地的阶段。
- Phase 3 是工作量与风险最大的一段(RSC/CC),小步走、逐组件 build 验。
- skill 侧(`template-studio-skill/`)不在本 plan 范围,但它若仍引用 builtin 常量/默认 id,需通知 skill owner 同步——本 plan 改完会让那些引用失效。
- 每阶段结束按 AGENTS.md §11 留交接;别推 main,开 PR 等绿。
