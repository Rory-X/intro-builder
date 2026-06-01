# Plan: 编辑页内直接套用收藏模板（模板收藏 · 第二阶段）

- **状态**：BLOCKED（等前提条件满足后开工）
- **创建日期**：2026-05-30
- **前置**：第一阶段「模板库用户级收藏」已完成并合入 main（commit `f327cce`）。

## Context

模板收藏需求拆成两阶段。第一阶段已落地：模板库 `/templates` 页可用五角星收藏、
「我收藏的」筛选、详情抽屉收藏，套用走「应用到当前简历」→ 跳编辑器。

但用户最初的诉求是「**简历编辑页面可以直接套用模板**」——即不离开编辑器、
从「我收藏的模板」里一键换模板。这就是第二阶段，本 plan 描述它。

第一阶段探索时发现的关键事实（节省二阶段重新摸索）：
- 编辑页 `app/(app)/resume/[id]/edit/editor-client.tsx` 里 **`changeTemplate(next)`
  函数已存在但无任何调用方**——模板选择器 UI 在 commit `8af1494` 被删（理由：
  模板浏览统一走 /templates 页）。`pendingTemplateId` state 和 `allTemplates`
  prop 也还在传，目前未使用。
- 套用后端 `setTemplate(id, templateId, {resetStyleSettings})` 完整可用
  （`edit/actions.ts`），含鉴权 + 模板 id 校验 + styleSettings 重置。
- 预览联动就绪：`template` state 变 → `resolvedTemplate` useMemo 重算 →
  `LivePreview` 重渲（`editor-client.tsx` 内）。
- 收藏数据层已就位（第一阶段交付）：`templateFavorites` 表 +
  `getFavoriteTemplateIds(userId)`（`app/(app)/templates/actions.ts`）。

所以第二阶段本质是**复活 `changeTemplate` + 接一个"我收藏的模板"选择 UI**，
后端和数据层基本不用再造。

## ⚠️ 开工前提（满足前不要动手）

1. **schema 化落地**：三个内置模板（professional/classic/modern）的 v2 slot
   契约已稳定并合入 main。否则编辑器内套用一个正在被重构的模板，预览是半成品。
2. **`editor-client.tsx` 稳定**：schema 化 session 对该文件的改动已合入 main、
   不再活动。否则二阶段改同一文件 = 与活动 session 冲突（第一阶段刻意避开了它）。

开工前先确认这两条都满足（`git log` 看 schema 化相关 commit 已在 main、
原工作树无针对 editor-client.tsx 的在途改动）。

## 实现步骤（待开工）

### 1. 编辑页 server 预取收藏模板
- `app/(app)/resume/[id]/edit/page.tsx`：用 `getFavoriteTemplateIds(userId)` +
  `listAllTemplatesAsync()` 解析出"该用户收藏的模板"列表（含展示用 meta/缩略图
  所需的 `SerializableResolvedTemplate`），传给 `editor-client.tsx`。
  - 注意：收藏里可能有已删除的 uploaded 模板 id（孤儿），解析时过滤掉不存在的。

### 2. 编辑器内"我收藏的模板"选择 UI
- 工具栏加一个入口（按钮 → popover/sheet），列出收藏的模板缩略图。
  复用 `components/templates/template-thumbnail.tsx` +
  `ClientTemplateRenderFromSerializable`。
- 点某个 → 调**已存在的** `changeTemplate(id)`（它内部调 `setTemplate` +
  乐观 setState + 失败回滚 toast，`pendingTemplateId` 显示 loading）。
- 空状态：没有收藏时提示去 /templates 收藏（带链接）。
- 当前模板在列表里高亮"使用中"。
- 暗色模式补 `dark:` 变体。

### 3. 复活 changeTemplate / 清理死 props
- 把 `changeTemplate` 接到上面的 UI；确认 `allTemplates` / `pendingTemplateId`
  这些原本预留、当前未用的 prop/state 正确接上或清理。

### 4.（可选）编辑器内顺手收藏
- 选择 UI 里每个模板也可加五角星，复用 `toggleTemplateFavorite`，让用户在
  编辑器里也能收藏/取消。视交互复杂度决定是否纳入本切片。

### 5. 测试
- editor-client 的"从收藏套用"交互测试：点收藏模板 → 调 `changeTemplate`/
  `setTemplate` → `template` state 翻转 + 预览 resolvedTemplate 变。
- 空状态渲染测试。

## 不在范围

- 模板库页（/templates）的收藏功能——第一阶段已交付。
- 收藏孤儿清理（uploaded 模板删除时级联清 favorites）——独立小任务，可另开。

## 验证（DoD）

闸门全绿：`pnpm test` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build`。
手工冒烟（`pnpm dev`，进 `/resume/<id>/edit`）：
1. 打开"我收藏的模板"入口 → 显示收藏列表（与 /templates 收藏一致）。
2. 点一个收藏模板 → 编辑器内当场换模板，预览立即更新，无需跳转。
3. 刷新页面 → templateId 已持久化（`setTemplate` 落库）。
4. 没收藏时 → 空状态 + 去模板库的链接。
5. 套用 v2 slot 模板 → 内容正确映射到 slot（验证前提①已满足）。
6. 暗色模式样式正常。

## 交接提示

- 第一阶段在 worktree `feat/template-favorites` 完成、ff 合入 main；该 worktree
  与 dev(3001) 完成后可清理。
- 第一阶段相关 commit：`83a63c1`（表+action+库UI）、`c0f7abc`（抽屉收藏）、
  `90ba542`/`f327cce`（收藏星位置调整）。
