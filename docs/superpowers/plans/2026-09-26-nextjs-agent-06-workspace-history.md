# P06：任务工作可视化、Diff 与选择性撤销

状态：进行中（任务 2、3、4 的投影层已完成；任务 5 的聚合与撤销语义已完成，但
**读取层接线与条件 undo 链路未接通**；任务 1、6、7 未开始）。依赖 P05。PoC：[交互状态演示](../pocs/2026-09-26-nextjs-agent-workspace.html)。这是现有产品内的连续改进，不重做全站视觉。

## 完成记录（分批）

### 已完成：任务 4 完整结构 Diff

- **落地**：`lib/resume-mutations/diff.ts`。
- **按 ID 匹配**，位置变化单独报 `moved`。优先级是先看内容再看位置：
  「挪了并改了」报 `modified` 并带真实新旧位置（信息量更大），
  只有纯粹换位置才报 `moved`。
- **无 ID 时受限比较并如实标注**：部分缺 ID 也算受限（混用两种对齐方式
  的结果自相矛盾，比明确的「不完整」更危险）。受限时**不报 `moved`**。
- **容器级覆盖** title/templateId/sectionOrder/styleSettings/singletonRichText；
  `sectionOrder` 区分重排与显示/隐藏。
- **验证**：`tests/unit/structured-diff.test.ts` 22 例。
- **笔记**：`docs/notes/implemented/architecture/2026-09-26-structured-diff-by-id.md`。
- **已知上限**：未接线到 UI；TipTap marks 级差异由既有模块的 token 比较间接覆盖。

### 已完成：任务 2 任务卡投影

- **落地**：`lib/ai-client/task-projection.ts`（纯函数：事件数组 → 任务卡）。
- **不虚构进度**：`running` 且无步骤时标题为 `null`，让 UI 保持沉默；
  不提供百分比字段（事件里没有进度信息）。
- **完成与保存分开**：`status` 由终态事件决定；`hasPersistedChanges`
  **唯一**依据是 `mutation.committed`。有回执但中断时仍为已保存
  （落盘是事实，不因断线撤销）。
- **面向用户的语言**：工具名映射成业务动作、错误码映射成可操作说明，
  未知项给兜底文案，不回显原始名/码；测试断言不含 apiKey / payload。
- **实测修复**：重放会让步骤重复显示 —— 我把「重放不重复」归给了 reducer，
  忘了任务卡是**独立投影**。改为按 toolCallId/mutationId/changeSetId 去重。
- **验证**：`tests/unit/ai-task-projection.test.ts` 28 例。

### 已完成：任务 3 提案卡投影

- **落地**：`lib/ai-client/change-set-card.ts`。
- **按 `itemId` 分组**（不按操作种类或语义猜）：`insert_item` 与指向该新条目的
  `set_field` 自然同组，避免用户点出「往不存在的条目写内容」这种必然失败的组合。
- **冲突组在折叠时保留**：`visibleGroups` 折叠时只返回有冲突的组。
- **`canApply` 表达「可提交」而非「已保存」**：刻意没有 `saved` 字段。
- **`locateOperation` 返回 itemId 而非下标**。
- **实测修复**：`insert_item` 的 `after` 为空（`readableValue` 对普通对象直接
  返回 null），用户看不到新增了什么；顺带加了递归深度保护。
- **验证**：`tests/unit/ai-change-set-card.test.ts` 32 例。
- **已知上限**：**「事实来源」未实现** —— 操作契约里没有 `evidenceRefs` 字段，
  需要先改契约，不能靠投影层编造。

### 已完成（部分）：任务 5 历史聚合与撤销语义

- **落地**：`lib/ai-client/version-history.ts`。
- **核实出的两个缺口**：
  ① 数据库 `resume_version` 已有 runId/changeSetId/mutationId/revision
  （迁移 0014），提交层也确实在写，但**读取层没取出来** ——
  因此 UI 无法聚合也无法跳回任务；
  ② `prepare` 生成的 `inverse` **从未被消费**，撤销链路完全未接线。
- **聚合键是 `runId` 而非版本 id**（一次任务可能产生多个版本）；
  无 runId 的记录各自成组。组键含 resumeId 且用 `\u0000` 分隔。
- **撤销目标是「那条记录」而非「时间上的前一条」**：plan 验收要求
  「修改 A 后补技能，再撤销 A，技能仍保留」；`findUndoTarget` 只找出那条记录，
  **不计算目标内容**（避免有人拿它绕过条件 undo）。
- **`canUndo` 三条排除**：撤销记录本身、无 mutationId、无主的系统操作。
- **撤销失败说明每条都明确「你的内容未受影响」**。
- **验证**：`tests/unit/ai-version-history.test.ts` 25 例。
- **笔记**：`docs/notes/implemented/architecture/2026-09-26-version-history-grouping.md`。
- **未完成（重要）**：读取层与 UI **未接线**；**条件 undo 链路未接通**
  （`inverse` 仍无消费者，提交层还没有「按 undoOf 构造反向命令」的入口）。

### 未完成（本切片剩余）

任务 1（PoC 产品回归与人工核对）、任务 6（刷新与错误：恢复后还原已完成工具、
已应用/已拒绝建议、等待问题；重放不重复 toast/写入；四类错误文案）、
任务 7（RTL 验证与人工冒烟）。

**接线的关键路径**：四个投影模块（task-projection / change-set-card /
structured-diff / version-history）都已完成但**都未接到 UI**。
下一步应当先把它们接进 `floating-agent-chat.tsx` 与
`version-history-popover.tsx`，并补上读取层字段（runId/changeSetId 等），
再补条件 undo 的提交路径。

## 文件范围

现有：`components/agent/floating-agent-chat.tsx`、`agent-confirmation-card.tsx`、`components/editor/version-history-popover.tsx`、`components/preview/resume-diff-preview.tsx`、`lib/resume-diff.ts`、editor-client。
拟新增：`components/agent/task-progress.tsx`、`resume-change-set-card.tsx`、`lib/ai-client/task-projection.ts`、`lib/resume-mutations/diff.ts`。不手改生成的 `components/ui/`。

## 任务

1. **PoC 产品回归。** 查看单页，核对待确认/失败/冲突/撤销语言；保持现有主题字体/颜色 token 和暗色模式。实装前确认变化只是任务可视化，不将模拟样式整页替换现有编辑器。POC 状态测试不能替代真实布局与可访问性验证。
2. **任务卡投影。** 从服务器事件生成当前步骤、完成项、等待原因；没有事件不虚构进度或百分比。模型完成和修改保存分开。长任务可以折叠，用户滚走时不强制拉回底部。
3. **提案与正文定位。** 一组任务对应一张 changeSet 卡；显示具体位置、前后差异、理由、事实来源、批准/拒绝状态。点击定位稳定 itemId；生成中不偷改正文。允许依赖无关组部分接受，冲突组保持可见。
4. **完整结构 Diff。** 按 ID 匹配条目并明确移动；覆盖自定义模块、标题、模板、样式、sectionOrder、显示状态和 TipTap marks。历史无 ID 时标旧记录并使用受限比较，不能按下标渲染成可信的来源证明。
5. **历史聚合与撤销。** 列表按任务聚合，展开看各 revision 和 source；单条记录能回到 task/run。撤销调用服务端条件 undo，失败保留用户内容；恢复整版需明确提示并走 commit。保留纯未保存输入的本地 undo 体验。
6. **刷新与错误。** 恢复后还原已完成工具、已应用/已拒绝建议及等待问题；重放 event 不重复 toast/写入。无终态 EOF、没有模型 key、未完成保存、找不到条目都有可操作中文文案。
7. **验证与发布。** RTL 验证用户可见行为，人工冒烟浮窗/停靠、移动端、暗色、键盘、预览定位、冲突和撤销。focused+总门禁，记录实际截图/路径而非文字声称像 PoC。提交建议 `feat(ai): connect task progress with resume changes and history`。

## 验收命令

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/version-history-popover.test.tsx tests/unit/resume-diff-preview.test.tsx tests/unit/resume-diff.test.ts tests/unit/editor-client-version-history.test.tsx tests/unit/ai-task-progress.test.tsx tests/unit/ai-change-set-card.test.tsx
```

后两份为拟新增。再跑总门禁。

## 用户可见验收

- 所有「已保存」均可查到 version/receipt；错误卡不能同时显示绿色成功。
- 任务卡只描述可观察行动和简短理由，不暴露内部推理链或原始 key/payload。
- 修改 A 后用户补技能，再撤销 A，技能仍保留；修改 A 同字段后撤销需冲突处理。
- 两条经历仅交换位置，Diff 显示移动而非互相全文改写。
- 真实执行过程中输入和滚动流畅；文本流不会等待数据库回执而整段停顿。

## 回滚

UI 可以退回简化展示，但服务器必须继续保留统一事件和历史。禁止回退到前端单独补快照的留痕实现。
