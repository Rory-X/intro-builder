# Spec: Agent Panel UX P1 优化

**日期**: 2026-06-10
**作者**: Claude Code
**状态**: Draft

## 1. 背景

P0 解决了批量确认和 diff 展示，现在优化信任和透明度：

### 问题 1：可撤销性缺失
- 用户点"应用"后无法撤销
- 只能手动找到改动的地方、记住原文、手动改回
- 心理负担：担心误点，导致犹豫不决

### 问题 2：推理过程不透明
- 只看到"建议改成 X"，不知道为什么
- Agent 的诊断理由隐藏在工具调用中
- 无法判断建议是否符合自己的意图

## 2. 设计目标

### P1.1 可撤销性
- 已应用的操作显示"撤销"按钮（限时 5 分钟）
- 点击撤销后恢复到修改前的状态
- 基于 autosave 历史实现（不需要新的后端 API）

### P1.2 推理透明度
- 确认卡展示 Agent 的"为什么要改"
- 从 tool input 提取诊断理由
- 可折叠，默认收起

## 3. 技术方案

### 3.1 撤销功能

**方案 A：基于 React Hook Form 状态**（推荐）

```tsx
// 在 AgentConfirmationCard 中
const [undoSnapshot, setUndoSnapshot] = useState<{
  fieldPath: string;
  value: unknown;
  timestamp: number;
} | null>(null);

function handleApply(operation: ResumeOperation) {
  // 保存当前值
  const currentValue = form.getValues(operation.fieldPath);
  setUndoSnapshot({
    fieldPath: operation.fieldPath,
    value: currentValue,
    timestamp: Date.now(),
  });

  onApply(operation);
}

function handleUndo() {
  if (!undoSnapshot) return;
  if (Date.now() - undoSnapshot.timestamp > 5 * 60 * 1000) {
    // 超时
    setUndoSnapshot(null);
    return;
  }

  form.setValue(undoSnapshot.fieldPath, undoSnapshot.value);
  flushAutosave();
  setUndoSnapshot(null);
  setResolved(null);
}
```

**方案 B：基于 autosave 历史**
- 需要后端支持"获取上一版本"API
- 更复杂，但更可靠

**选择**：方案 A，足够简单且满足需求。

**限制**：
- 只能撤销最近一次应用
- 5 分钟后按钮消失（防止用户在后续编辑后撤销）
- 只在同一会话内有效

### 3.2 推理透明度

Agent server 的 `tool.input` 中包含诊断信息，例如：

```json
{
  "section": "experience",
  "diagnosis": "职责描述过于泛泛，缺少量化数据和具体成果",
  "suggestions": [...]
}
```

在 `AgentMessageResponse` 中扩展 `toolCalls` 类型，添加 `diagnosis` 字段。

在 `AgentConfirmationCard` 中：

```tsx
{operation.diagnosis ? (
  <details className="mt-2 text-xs text-muted-foreground">
    <summary className="cursor-pointer hover:text-foreground">
      为什么要改？
    </summary>
    <p className="mt-1">{operation.diagnosis}</p>
  </details>
) : null}
```

**数据流**：
1. Agent server 在 tool result 中包含 `diagnosis`
2. Web 端提取到 `ResumeOperation`
3. 确认卡展示

## 4. 实现步骤

### P1.1 撤销功能
1. 修改 `AgentConfirmationCard` 添加 undo 状态
2. "应用"时保存快照
3. 显示"撤销"按钮（5 分钟倒计时）
4. 实现撤销逻辑

### P1.2 推理透明度
1. 扩展 `ResumeOperation` 类型添加 `diagnosis` 字段
2. Agent server 在生成 operation 时提取 diagnosis
3. 确认卡展示 diagnosis（可折叠）

## 5. 验证标准

- [ ] 点"应用"后显示"撤销"按钮
- [ ] 撤销后恢复原文
- [ ] 5 分钟后按钮消失
- [ ] 确认卡显示"为什么要改"（如果有）
- [ ] 折叠/展开正常工作

## 6. 非目标

- ❌ 多步撤销（undo 栈）
- ❌ 跨会话的撤销
- ❌ 可视化 Agent 思维链
