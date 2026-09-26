# P06：任务工作可视化、Diff 与选择性撤销

状态：未开始。依赖 P05。PoC：[交互状态演示](../pocs/2026-09-26-nextjs-agent-workspace.html)。这是现有产品内的连续改进，不重做全站视觉。

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
