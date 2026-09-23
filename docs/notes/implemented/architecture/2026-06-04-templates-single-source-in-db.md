# Agent Note: 模板统一从数据库读取，不再有内置硬编码模板

Status: implemented

## Problem

模板渲染曾经有两条路：少数内置模板（classic / modern / professional）以 React 组件硬编码在 `lib/templates/<name>/` 下，用户通过 Skill 上传的模板走另一条 DB + HTML 渲染路径。两套并存的直接后果是**渲染行为漂移**：

Dashboard 缩略图与 PDF 导出走的是 `components/preview/template-renderer.tsx` 里的 legacy builtin-only switch，而编辑器预览已经切到 canonical 渲染器。于是当简历用了 Skill v2 上传模板时，**缩略图和 PDF 会静默回退到 professional**——不报错，只是渲染出错误的模板。同一处代码还因为用同步的 `getTemplateMeta`（只认内置）读模板名，在 dashboard 上显示错了 chip 文案。

根因不是某个 bug，而是「如何渲染一个模板」这个问题的答案分散在多于一处。

## Decision

**模板只有一种存储：`apps/web/db/schema.ts` 的 `templates` 表。** classic / modern / professional 与用户上传模板都是该表里的普通行，一视同仁，不再有「内置硬编码、不入表」的特殊处理（`5f282c52c`，105 个文件、净删约 5000 行）。

渲染收敛到两个 canonical 入口，按上下文二选一：

- 服务端 → `TemplateRender`（`apps/web/lib/templates/render-server.tsx`）
- 客户端 → `ClientTemplateRenderFromSerializable`（`apps/web/lib/templates/render.tsx`）

legacy builtin-only switch 已删除。**新增模板一律是往 `templates` 表插一行**（走 `template-studio-skill` 或 `lib/templates/uploaded/*` 的 slot 协议），不再写 React 模板组件。表是字段的唯一真源，列的含义写在列旁注释里，**不要再另起文档镜像它**（会漂）。

## Alternatives considered

- **保留内置模板作为「无 DB 时的兜底」** — 听起来稳健，但它正是这个 bug 的成因：兜底路径会在正常路径出问题时静默接管，把「渲染错了」变成「渲染成另一个模板」，让故障难以察觉。真正的兜底应该是显式失败。放弃。
- **保留两套渲染但加一致性测试锁死** — 能靠测试提醒漂移。但两套实现意味着每加一个模板要写两遍、每改一次 slot 语义要同步两处，测试只能证明「当前没漂」，不能消除漂移的结构性来源。收敛到一处比给两处加护栏更省。
- **只在 dashboard 与 PDF 两条路径上打补丁**（把它们的 switch 也指向 canonical 渲染器）— 改动最小、能立刻修掉那个具体 bug。但 `template-renderer.tsx` 这个 switch 会继续存在，下一条新路径还会照着它写——治标不治本。故直接删掉 switch 本身。

## Consequences

- **收益**：「如何渲染模板」在仓库里只有一个答案，新路径不可能再走岔；dashboard / 编辑器 / PDF 三处渲染必然一致，缩略图与 PDF 不再静默回退；删掉了约 5000 行内置模板代码与其专属测试。
- **代价与已知上限**：渲染现在**依赖数据库**，没有 DB 就没有模板可渲染（本地开发需要 seed 模板数据）；且模板不再是静态可分析的前端产物，样式问题要在运行期才能看到。**重访触发条件**：若将来需要「无后端也能渲染的模板预览」这类离线场景，应当新增独立的静态预览工具，而不是把内置模板路径加回来。
- **配套清理**：这次重构还清理了一批一次性产物（`scripts/seed-builtin-templates.ts`、`db/seed/template-abbey-stub.ts` 等），已全部删除。教训是**一次性迁移脚本不要当作「seed 脚本留在仓库是标准做法」而长期保留**——先看文件的实际用途再判断去留。

## Verification

- 存储：`apps/web/db/schema.ts` 的 `templates` 表（含「唯一存储」的注释契约）。
- 渲染入口：`apps/web/lib/templates/render-server.tsx`、`apps/web/lib/templates/render.tsx`；注册与解析在 `registry.ts` / `registry-server.ts`。
- 单元测试：`apps/web/tests/unit/templates-*.test.tsx`、`apps/web/tests/unit/html-slot-renderer.test.tsx`。
- 回归方式：用一份 Skill v2 上传模板的简历，确认 dashboard 缩略图、编辑器预览、下载的 PDF 三处渲染的是同一个模板。
