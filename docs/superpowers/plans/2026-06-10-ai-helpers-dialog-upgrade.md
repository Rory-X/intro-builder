# Plan: AI 辅助功能 UX 升级 + 重写跳过的测试

**日期**: 2026-06-10  
**Spec**: [2026-06-10-ai-helpers-dialog-upgrade.md](../specs/2026-06-10-ai-helpers-dialog-upgrade.md)  
**状态**: Draft

## 概述

将 AI 诊断、AI 建议的 UI 从 Popover 改为 Dialog 形式，提升视觉层级和内容展示空间。同时重写之前跳过的 2 个 ag-ui runtime 测试。

**注意**: AI 润色保持现状（嵌入式面板），无需改动。

---

## 阶段 1: 创建共享组件

### 1.1 创建 `ResumeHelperDialog` 组件

**目标**: 为 AI 诊断和 AI 建议提供统一的 Dialog 包装

**文件**: `components/agent/resume-helper-dialog.tsx`

**Props**:
```typescript
{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  state: HelperState;
  maxWidth?: "xl" | "2xl";
}
```

**内容结构**:
- DialogHeader: 标题
- DialogContent: 根据 state 渲染 loading/error/ready
  - ready 状态：显示总结 + ResumeHelperCard 列表
- DialogFooter: 关闭按钮

**验证**:
- [ ] 组件渲染正常
- [ ] loading/error/ready 三种状态显示正确
- [ ] 关闭按钮工作正常

---

## 阶段 2: 重构 AI 诊断

### 2.1 修改 `ResumeDiagnoseButton`

**文件**: `components/agent/resume-diagnose-button.tsx`

**改动**:
1. 删除 Popover 相关代码
2. 添加 `dialogOpen` 状态
3. 点击按钮 → 发起请求 + 打开 Dialog
4. 使用 `ResumeHelperDialog` 替代 `ResumeHelperPopoverContent`

**前**:
```tsx
<Popover>
  <PopoverTrigger>...</PopoverTrigger>
  <ResumeHelperPopoverContent state={state} title="AI 简历诊断" />
</Popover>
```

**后**:
```tsx
<>
  <Button onClick={handleRequest}>AI 诊断</Button>
  <ResumeHelperDialog
    open={dialogOpen}
    onOpenChange={setDialogOpen}
    title="AI 简历诊断"
    state={state}
    maxWidth="2xl"
  />
</>
```

**验证**:
- [ ] 点击按钮打开 Dialog
- [ ] 诊断结果正确显示（最多 5 条）
- [ ] 建议卡片的"应用"和"忽略"操作正常
- [ ] 关闭 Dialog 重置状态

---

### 2.2 更新测试

**文件**: `tests/unit/resume-diagnose-button.test.tsx`

**改动**:
- 断言改为查找 Dialog 相关元素
- 测试 Dialog 打开/关闭逻辑

---

## 阶段 3: 重构 AI 建议

### 3.1 修改 `SectionHelperButton`

**文件**: `components/agent/section-helper-button.tsx`

**改动**:
1. 删除 Popover 相关代码
2. 添加 `dialogOpen` 状态
3. 使用 `ResumeHelperDialog` (maxWidth="xl")

**验证**:
- [ ] 点击按钮打开 Dialog
- [ ] 建议结果正确显示（最多 3 条）
- [ ] 操作正常

---

### 3.2 更新各编辑器中的使用

**文件列表**:
- `components/editor/experience-editor.tsx`
- `components/editor/projects-editor.tsx`
- `components/editor/education-editor.tsx`
- `components/editor/skills-editor.tsx`
- `components/editor/research-editor.tsx`
- `components/editor/custom-section-editor.tsx`

**改动**: 无需改动（SectionHelperButton 是内部实现变化）

**验证**:
- [ ] 各编辑器的 AI 建议按钮正常工作

---

## 阶段 4: 清理遗留代码

### 4.1 删除 `ResumeHelperPopoverContent`

**文件**: `components/agent/resume-diagnose-button.tsx`

**改动**:
- 删除 `ResumeHelperPopoverContent` 函数（行 123-156）
- 已被 `ResumeHelperDialog` 替代

---

## 阶段 5: 重写跳过的测试

### 5.1 重写测试 1: 错误恢复和重试

**文件**: `tests/unit/agent-panel.test.tsx`

**原测试**: "can dismiss an Agent error without clearing the conversation" (已跳过)

**新测试**: "recovers from Agent error and allows retry"

**测试逻辑**:
1. Mock fetch 第一次返回 503 错误
2. 触发 Agent 请求（点击 "诊断整份简历"）
3. 等待错误卡片出现（显示 requestId）
4. 点击 "重新发送上一条" 按钮
5. Mock fetch 第二次返回成功响应
6. 验证错误卡片消失，成功消息显示

**关键点**:
- 使用 `agUiResponse()` 生成标准 SSE 流
- 用 `await waitFor()` 等待异步事件
- 避免触发 unhandled rejection

**代码框架**:
```typescript
it("recovers from Agent error and allows retry", async () => {
  let callCount = 0;
  const fetchMock = vi.fn(async () => {
    callCount++;
    if (callCount === 1) {
      return Response.json(
        { error: "Agent 服务暂不可用", code: "dependency_unavailable", requestId: "req_retry_test" },
        { status: 503 }
      );
    }
    return agUiResponse(["错误已恢复，我继续检查。"]);
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AgentPanel {...panelProps()} />);
  fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

  expect(await screen.findByText(/req_retry_test/)).toBeInTheDocument();
  
  fireEvent.click(screen.getByRole("button", { name: "重新发送上一条" }));
  
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByText("错误已恢复，我继续检查。")).toBeInTheDocument();
  expect(screen.queryByText(/req_retry_test/)).not.toBeInTheDocument();
});
```

**验证**:
- [ ] 测试通过
- [ ] 无 unhandled rejection

---

### 5.2 重写测试 2: 操作确认流程

**文件**: `tests/unit/agent-panel.test.tsx`

**原测试**: "applies proposed operation only after user confirms" (已跳过)

**新测试**: 保持相同名称，但使用 ag-ui 兼容的格式

**测试逻辑**:
1. Mock fetch 返回包含工具调用和操作的 ag-ui 响应
2. 触发 Agent 请求
3. 等待工具调用完成显示
4. 等待确认卡片出现
5. 验证 `applyOperation` 未被调用
6. 点击 "应用" 按钮
7. 验证 `applyOperation` 被正确调用
8. 验证状态更新为 "已应用"

**关键点**:
- 使用 `agUiResponseWithToolResult()` 辅助函数
- 分阶段验证，避免竞态条件
- 使用 `await waitFor()` 等待异步状态更新

**代码框架**:
```typescript
it("applies proposed operation only after user confirms", async () => {
  const applyOperation = vi.fn();
  const fetchMock = vi.fn(async () => {
    return agUiResponseWithToolResult({
      text: "我准备了一条改写建议。",
      toolCall: {
        id: "tool_1",
        name: "resume_update_section",
        status: "completed",
        title: "改写个人总结",
        summary: "生成一版更聚焦的个人总结。",
        input: {},
        result: {},
      },
      proposedOperation: {
        id: "op_1",
        toolCallId: "tool_1",
        label: "应用个人总结改写",
        section: "summary",
        fieldPath: "basics.summary",
        operation: "update_section",
        beforePlainText: "三年前端经验。",
        afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
        changeSummary: "让总结更具体。",
        riskFlags: [],
      },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AgentPanel {...panelProps({ applyOperation })} />);
  fireEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

  expect(applyOperation).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(screen.getByText("已完成 1 个工具调用")).toBeInTheDocument();
  });
  
  expect(screen.getByText("等待确认 1 条修改建议")).toBeInTheDocument();
  expect(await screen.findByText(/应用个人总结改写/)).toBeInTheDocument();

  expect(applyOperation).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  
  expect(applyOperation).toHaveBeenCalledWith(
    expect.objectContaining({ id: "op_1" }),
  );
  await waitFor(() => {
    expect(screen.getByText("已应用")).toBeInTheDocument();
  });
});
```

**验证**:
- [ ] 测试通过
- [ ] 操作确认流程正确
- [ ] 与现有成功测试保持一致

---

### 5.3 移除 `test.skip`

**文件**: `tests/unit/agent-panel.test.tsx`

**改动**:
- 删除两个旧的 `test.skip` 测试（行 345-420）
- 它们已被新测试替代

**验证**:
- [ ] 无跳过的测试
- [ ] 所有测试通过

---

### 5.4 移除测试环境的 unhandledRejection 处理器

**文件**: `tests/setup.ts`

**改动**:
- 删除行 7-18 的 unhandledRejection 处理器
- 原因：新测试不再产生 unhandled rejection

**代码**:
```typescript
// 删除这段
process.on("unhandledRejection", (reason) => {
  const isAgUiHttpError =
    reason &&
    typeof reason === "object" &&
    "status" in reason &&
    reason.status === 503;
  if (!isAgUiHttpError) {
    throw reason;
  }
});
```

**验证**:
- [ ] 所有测试通过
- [ ] 无 unhandled rejection 警告

---

## 阶段 6: 完整性验证

### 6.1 本地闸门

运行所有 DoD 命令：

```bash
pnpm test        # 所有测试通过，无跳过
pnpm tsc --noEmit
pnpm lint
pnpm build
```

**预期**:
- [ ] 测试：全部通过，0 跳过
- [ ] 类型：无错误
- [ ] Lint：无错误
- [ ] 构建：成功

---

### 7.2 手工冒烟测试

**AI 诊断**:
1. 打开简历编辑页
2. 点击 "AI 诊断" 按钮
3. 验证 Dialog 打开，背景有遮罩
4. 等待诊断结果显示
5. 点击某条建议的 "应用"
6. 验证简历内容更新
7. 关闭 Dialog

**AI 建议**:
1. 进入工作经历编辑器
2. 点击 "AI 建议" 按钮
3. 验证 Dialog 打开
4. 查看建议列表（最多 3 条）
5. 测试 "应用" 和 "忽略" 操作

**AI 润色**:
1. 在富文本编辑器中输入内容
2. 点击 "AI 润色" 按钮
3. 验证 Dialog 打开
4. 查看差异对比视图
5. 点击 "应用润色"
6. 验证编辑器内容更新
7. 再次点击润色，测试 "放弃" 操作

**预期**:
- [ ] 所有功能正常工作
- [ ] Dialog 动画流畅
- [ ] 移动端响应式布局正常

---

## 阶段 8: 提交与发布

### 8.1 Git 提交

**Commit 顺序**:

1. `feat(agent): add ResumeHelperDialog and PolishResultDialog components`
2. `refactor(agent): migrate AI diagnose to Dialog UX`
3. `refactor(agent): migrate AI suggestions to Dialog UX`
4. `refactor(editor): migrate AI polish to Dialog UX`
5. `refactor(agent): remove legacy Popover components`
6. `test(agent): rewrite skipped tests for ag-ui runtime`
7. `test: remove unhandledRejection handler from setup`

---

### 8.2 创建 PR

**标题**: `feat(agent): upgrade AI helpers to Dialog UX + rewrite skipped tests`

**描述模板**:
```markdown
## 概述

将 AI 诊断、AI 建议、AI 润色的 UI 从 Popover/嵌入式改为 Dialog 形式，提升视觉层级和内容展示空间。同时重写了之前跳过的 2 个 ag-ui runtime 测试。

## 主要变更

### UX 升级

- ✅ AI 诊断：Popover (w-96) → Dialog (sm:max-w-2xl)
- ✅ AI 建议：Popover (w-96) → Dialog (sm:max-w-xl)
- ✅ AI 润色：嵌入式面板 → Dialog (sm:max-w-3xl)

### 新增组件

- `ResumeHelperDialog` - AI 诊断/建议的统一 Dialog 包装
- `PolishResultDialog` - AI 润色专用 Dialog

### 测试改进

- ✅ 重写 "recovers from Agent error and allows retry" 测试
- ✅ 重写 "applies proposed operation only after user confirms" 测试
- ✅ 移除测试环境的 unhandledRejection 处理器
- ✅ 所有测试通过，0 跳过

## 验证

### 本地闸门

```bash
pnpm test        # ✅ 全部通过 (0 skipped)
pnpm tsc --noEmit  # ✅
pnpm lint         # ✅
pnpm build        # ✅
```

### 手工测试

- ✅ AI 诊断 Dialog 正常工作
- ✅ AI 建议 Dialog 正常工作
- ✅ AI 润色 Dialog 正常工作
- ✅ 移动端响应式布局正常

## 截图

（TODO: 添加前后对比截图）

## 相关文档

- Spec: `docs/superpowers/specs/2026-06-10-ai-helpers-dialog-upgrade.md`
- Plan: `docs/superpowers/plans/2026-06-10-ai-helpers-dialog-upgrade.md`
```

---

## DoD 检查清单

- [ ] 所有阶段完成
- [ ] 测试全部通过（0 skipped）
- [ ] 类型检查通过
- [ ] Lint 通过
- [ ] 构建成功
- [ ] 手工冒烟测试通过
- [ ] Spec 和 Plan 已提交
- [ ] PR 已创建
- [ ] CI 通过

---

## 风险与缓解

### 风险 1: Dialog 可能影响性能

**可能性**: 低  
**影响**: 中  
**缓解**: Dialog 内容懒加载，只在打开时渲染

### 风险 2: 移动端 Dialog 体验不佳

**可能性**: 中  
**影响**: 高  
**缓解**: 使用响应式设计，移动端 Dialog 占据大部分屏幕，测试时重点验证

### 风险 3: 测试重写后仍不稳定

**可能性**: 低  
**影响**: 中  
**缓解**: 参考成功的 ag-ui 测试模式，使用相同的辅助函数和等待策略

---

## 估算

**总工作量**: 约 4-6 小时

- 阶段 1-2: 1.5 小时
- 阶段 3-4: 1.5 小时
- 阶段 5: 0.5 小时
- 阶段 6: 1.5 小时
- 阶段 7-8: 1 小时

---

## 参考

- Spec: `docs/superpowers/specs/2026-06-10-ai-helpers-dialog-upgrade.md`
- 现有 Dialog 示例: `components/templates/resume-picker-dialog.tsx`
- 现有 ag-ui 测试: `tests/unit/agent-panel-assistant-ui.test.tsx`
- 跳过的测试: `tests/unit/agent-panel.test.tsx` 行 345-420
