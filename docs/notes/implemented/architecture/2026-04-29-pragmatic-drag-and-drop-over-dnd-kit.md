# Agent Note: 拖拽统一使用 Pragmatic D&D，不再回头用 dnd-kit

Status: implemented

## Problem

编辑器的分区与条目排序最初由 `dnd-kit` 实现（`f1d4d60cc`）。它在编辑器这个场景下持续暴露两类问题：拖拽状态与 React 重渲染耦合，编辑器本来就重（每次击键要跑 LivePreview 与 autosave），拖拽期间整棵树跟着重渲导致卡顿；同时它的 `DndContext` / `SortableContext` 声明式模型要求把可拖拽结构包在 provider 树里，分区与条目两层嵌套时上下文互相干扰，排序边界（跨分区移动条目）难以表达。

这段代码很容易被后来的 Agent 凭「dnd-kit 更主流、组件库更全」重新引入——因为**代码本身只留下了「现在用 Pragmatic D&D」这个事实，说不出当初为什么换、换掉了什么**。

## Decision

所有拖拽能力统一走 `@atlaskit/pragmatic-drag-and-drop`（`d30ed01f1` 完成迁移）。分区拖拽在 `apps/web/components/editor/section-wrapper.tsx`，条目拖拽在 `item-wrapper.tsx`，两者用 `useEffect` 注册 `draggable` / `dropTargetForElements` / `monitorForElements` 这套命令式 API，不把拖拽状态放进 React 渲染路径。跨容器排序的索引计算由 `lib/array-move.ts` 承担。

选择它的核心理由是**命令式、脱离 React 渲染循环**：注册与解绑都在 effect 里完成，拖拽过程不触发编辑器重渲，与 `useWatch` 订阅式预览天然兼容。代价是它不提供现成的 UI，骨架、放置指示线、键盘可达性都要自己写。

**绝不再引入 `dnd-kit`**：仓库里两层嵌套排序已经按命令式模型写好，混用两套拖拽库会让同一次拖拽走两条事件链，难以调试。

## Alternatives considered

- **继续留用并修复 `dnd-kit`** — 它的声明式模型上手快、有 `Sortable` 预设，社区组件多。但它把拖拽状态挂进 React 树，与「编辑器不允许因拖拽整体重渲」这条硬约束正面冲突；分区 + 条目两层嵌套时上下文互相干扰，修复成本高于换库。
- **HTML5 原生 draggable** — 零依赖。但原生 API 的事件模型（`dragstart` / `dragover` / `drop`）在各浏览器行为不一致，且不提供跨容器排序语义，等于把现在 Pragmatic D&D 帮我们兜的边界情况全部手写一遍。
- **自己写基于 pointer events 的拖拽层** — 最可控，能完全贴合分区/条目两级模型。但排序算法、自动滚动、放置指示、触摸适配都要自己维护，属于把成熟的通用能力重新手搓一遍，违背「优先选用持续维护的依赖」的方向。

## Consequences

- **收益**：拖拽不再进入 React 渲染路径，编辑器在拖拽期间保持可交互；分区与条目两层排序用同一套命令式原语表达，跨容器移动的索引语义集中在一处。
- **代价与已知上限**：没有现成的 UI 与键盘可达性，`section-wrapper` / `item-wrapper` 里的自定义代码是我们自己的维护面。**若将来出现「拖拽需要丰富的内置视觉反馈」或「需要第三方拖拽组件生态」的诉求，要重访这个决定**——届时应先评估在 Pragmatic D&D 上补齐，而不是直接换库。

## Verification

- 实现：`apps/web/components/editor/section-wrapper.tsx`、`item-wrapper.tsx`、`apps/web/lib/array-move.ts`。
- 单元测试：`apps/web/tests/unit/array-move.test.ts`。
- 回归方式：`pnpm dev` 进 `/resume/<id>/edit`，拖拽分区与条目，确认编辑器不卡顿、跨分区移动条目后顺序正确。
