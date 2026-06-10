# Spec: Agent Tool Result 回传机制

**日期**: 2026-06-10
**作者**: Claude Opus 4.8
**状态**: Draft

## 1. 背景与问题

### 当前实现

Agent panel 的 HITL (Human-In-The-Loop) 流程：

1. **Agent server** 返回 `toolCalls` 和 `proposedOperations`
2. **Web 端** 提取 operations → 展示确认卡片
3. **用户批准** → Web 写入表单 → `flushAutosave()`
4. **Agent 继续** → 下一轮对话

### 核心问题

**Agent 不知道用户批准了什么**：

- 用户批准 operation A、忽略 operation B
- Web 只写入了 A，但 Agent 在下一轮对话中不知道这个结果
- Agent 可能：
  - 重复建议 B（因为不知道被拒绝）
  - 假设 A 和 B 都应用了（产生幻觉）
  - 无法基于用户选择调整后续建议

### 用户期望

用户在问题描述中明确要求：

> "应用修改"要变成 HITL approval/tool result，Web 应用成功后把结果回传 runtime，再让 Agent 继续 stream 结尾。

---

## 2. 设计目标

### 目标

1. **结构化 interrupt** - Agent server 输出批准请求为结构化 interrupt（而非普通文本）
2. **Interrupt resume 流** - Web 通过 AG-UI 的 `submitInterruptResponses` API 回传批准结果
3. **Agent 获得反馈** - Agent resume 后能读取用户批准/拒绝的决策
4. **简历写入仍由 Web 控制** - Agent 不直接改数据，只拿确认结果继续推理

### 非目标

- ❌ 改变现有的 operation 数据结构
- ❌ 让 Agent server 直接写入简历数据
- ❌ 改变用户可见的 UI 交互

---

## 3. 技术方案

### 3.1 AG-UI Interrupt 协议

AG-UI 提供的 HITL 标准流程：

```typescript
// Agent server 输出
{
  type: EventType.RUN_FINISHED,
  outcome: {
    type: "interrupt",
    interrupts: [
      {
        id: "op_123",
        reason: "approval_required",
        message: "需要你确认：将「工作经历」第一条的职责改为...",
        toolCallId: "call_abc",
        metadata: { operation: {...} }
      }
    ]
  }
}

// Web 回传
runtime.submitInterruptResponses([
  {
    interruptId: "op_123",
    status: "resolved", // 或 "cancelled"
    payload: { approved: true }
  }
])

// Agent resume，能读取 payload
```

### 3.2 实现路径

有两个可选方案：

#### 方案 A：完整 Interrupt 协议（推荐）

**Agent server 改动**：

1. 检测 `proposedOperations.length > 0`
2. 生成 interrupt 列表（每个 operation 一个 interrupt）
3. 输出 `RUN_FINISHED` with `outcome: { type: "interrupt", interrupts: [...] }`
4. 支持 resume：接受 `resume[]` 参数，继续推理

**Web 改动**：

1. `agent-ag-ui-runtime-provider.tsx` 暴露 `submitInterruptResponses`（已有）
2. `agent-panel.tsx` 用户批准后调用 `submitInterruptResponses`
3. Runtime 发送 resume 请求，Agent 继续 stream

**优点**：

- ✅ 符合 AG-UI 标准
- ✅ Agent 能获得完整反馈
- ✅ 支持后续扩展（编辑参数、批量批准等）

**缺点**：

- ❌ 需要修改 agent server（`apps/agent/src/agent-messages.ts`）
- ❌ 需要实现 resume 逻辑（agent server 接受 `resume[]`，继续对话）

---

#### 方案 B：轻量级反馈（妥协方案）

**Agent server 改动**：无（保持现状）

**Web 改动**：

1. 用户批准 operation 后，构造一条 user message：
   ```
   "我已应用：operation A（工作经历更新）、operation C（教育经历润色）；
    已忽略：operation B（项目经历删除）"
   ```
2. 通过 `threadRuntime.append()` 发送，触发 Agent 新一轮对话

**优点**：

- ✅ 无需改 agent server
- ✅ Agent 能读取批准结果（作为 user message）

**缺点**：

- ❌ 不符合 AG-UI 标准
- ❌ 批准结果变成对话历史，不是结构化数据
- ❌ 无法支持 resume（Agent 必须重新推理）

---

### 3.3 推荐方案

**方案 A（完整 Interrupt 协议）**，理由：

1. **符合标准** - AG-UI 设计就是为 HITL 场景
2. **可扩展** - 未来支持编辑参数、批量批准、多轮批准
3. **清晰的数据流** - interrupt → approval → resume，每步都有结构化数据

---

## 4. 实现细节

### 4.1 Agent Server 改动

**文件**: `apps/agent/src/agent-messages.ts`

#### 检测批准需求

```typescript
export function toAgUiAgentEvents({
  requestId,
  threadId,
  result,
}: ToAgUiAgentEventsInput): BaseEvent[] {
  const runId = requestId;
  const messageId = result.message.id;
  const events: BaseEvent[] = [
    { type: EventType.RUN_STARTED, threadId, runId },
    // ... TEXT_MESSAGE_* events
  ];

  appendAgUiToolEvents(events, result, messageId);

  // 🔴 新增：检测是否需要批准
  const needsApproval = result.proposedOperations.length > 0;

  if (needsApproval) {
    events.push({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: {
        type: "interrupt",
        interrupts: result.proposedOperations.map((op) => ({
          id: op.id,
          reason: "approval_required",
          message: `${op.label}：${op.changeSummary}`,
          toolCallId: op.toolCallId,
          metadata: { operation: op },
        })),
      },
    });
  } else {
    events.push({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: { type: "success" },
    });
  }

  return events;
}
```

#### Resume 处理

**文件**: `apps/agent/src/http.ts`（或新建 `agent-resume.ts`）

```typescript
// POST /v1/agent/messages 支持 resume[] 参数
function handleAgentMessageRequest(body: unknown) {
  const parsed = validateAgentMessageRequest(body);
  if (!parsed.ok) return error(parsed.message);

  // 🔴 新增：检查是否是 resume 请求
  const resume = Array.isArray(parsed.resume) ? parsed.resume : [];

  if (resume.length > 0) {
    // 构造系统消息，告诉 Agent 用户的批准结果
    const feedbackMessage = buildApprovalFeedback(resume);
    parsed.messages.push({
      role: "system",
      content: feedbackMessage,
    });
  }

  // 继续正常流程
  return streamAgentMessage(parsed);
}

function buildApprovalFeedback(resume: ResumeEntry[]): string {
  const approved = resume.filter(r => r.status === "resolved" && r.payload?.approved);
  const rejected = resume.filter(r => r.status === "cancelled" || !r.payload?.approved);

  return [
    "用户批准结果：",
    approved.length > 0 ? `已应用：${approved.map(r => r.interruptId).join(", ")}` : null,
    rejected.length > 0 ? `已拒绝：${rejected.map(r => r.interruptId).join(", ")}` : null,
  ].filter(Boolean).join("\n");
}
```

---

### 4.2 Web 改动

#### 暴露回传函数

**文件**: `components/agent/agent-ag-ui-runtime-provider.tsx`

已有 `useAgentAgUiInterruptSubmit` → 无需改动

#### 确认卡片调用回传

**文件**: `components/agent/agent-confirmation-card.tsx`

```typescript
export function AgentConfirmationCard({
  operation,
  onApply,
  onReject, // 🔴 新增
}: {
  operation: ResumeOperation;
  onApply: (operation: ResumeOperation) => void;
  onReject: (operationId: string) => void; // 🔴 新增
}) {
  return (
    <div>
      {/* ... */}
      <Button onClick={() => onApply(operation)}>应用</Button>
      <Button onClick={() => onReject(operation.id)}>忽略</Button> {/* 🔴 改动 */}
    </div>
  );
}
```

#### Panel 处理回传

**文件**: `components/agent/agent-panel.tsx`

```typescript
function AgentTurnArtifactsPanel({
  turnArtifact,
  // ...
}: {
  // ...
}) {
  const submitInterrupts = useAgentAgUiInterruptSubmit();

  async function handleApply(operation: ResumeOperation) {
    // 1. Web 写入表单
    applyOperation(operation);
    onOperationApplied(turnArtifact.id, operation.id);
    flushAutosave();

    // 2. 🔴 新增：回传 runtime
    if (submitInterrupts) {
      await submitInterrupts([{
        interruptId: operation.id,
        status: "resolved",
        payload: { approved: true },
      }]);
    }
  }

  async function handleReject(operationId: string) {
    // 🔴 新增：回传拒绝
    if (submitInterrupts) {
      await submitInterrupts([{
        interruptId: operationId,
        status: "cancelled",
        payload: { approved: false },
      }]);
    }
  }

  return (
    <div>
      {turnArtifact.operations.map((operation) => (
        <AgentConfirmationCard
          key={operation.id}
          operation={operation}
          onApply={handleApply}
          onReject={handleReject}
        />
      ))}
    </div>
  );
}
```

---

## 5. 数据流示意

### 完整流程

```
User: "帮我优化工作经历"
  ↓
Agent server:
  - 生成 3 个 operations
  - 输出 RUN_FINISHED with interrupts: [op1, op2, op3]
  ↓
Web:
  - 展示 3 个确认卡片
  - 用户批准 op1、op2，忽略 op3
  ↓
Web 调用 submitInterruptResponses([
  { interruptId: "op1", status: "resolved", payload: { approved: true } },
  { interruptId: "op2", status: "resolved", payload: { approved: true } },
  { interruptId: "op3", status: "cancelled", payload: { approved: false } },
])
  ↓
AG-UI runtime:
  - 发送 POST /v1/agent/messages with resume: [...]
  ↓
Agent server:
  - 读取 resume，构造反馈消息
  - 继续推理："好的，我已看到你批准了前两条。接下来我建议..."
  ↓
Web:
  - 显示 Agent 的后续回复
```

---

## 6. 验收标准

### 功能

- [ ] 用户批准 operation 后，Agent 在下一轮对话中能读取批准结果
- [ ] 用户拒绝 operation 后，Agent 不会重复建议
- [ ] 批准/拒绝决策通过结构化 interrupt 回传（不是文本消息）

### 技术

- [ ] Agent server 检测到 operations 时输出 `RUN_FINISHED` with `interrupts`
- [ ] Agent server 支持 `resume[]` 参数
- [ ] Web 调用 `submitInterruptResponses` 回传批准结果
- [ ] Runtime 自动发送 resume 请求

### 回归

- [ ] 现有测试通过
- [ ] 没有 operations 时，流程不变（`outcome: { type: "success" }`）
- [ ] 用户可见的 UI 不变

---

## 7. 风险与缓解

### 风险 1：AG-UI runtime 不支持 resume

**检查**: 查看 `@assistant-ui/react-ag-ui` 文档，确认 `submitInterruptResponses` 是否会自动发送 resume 请求

**缓解**: 如果不支持，需要手动调用 `threadRuntime.append()` 触发新一轮

### 风险 2：Agent server resume 逻辑复杂

**缓解**:
- 先实现简单版本：直接把 resume 结果拼成文本，append 到 messages
- 后续优化：Agent provider 支持结构化 resume 数据

### 风险 3：用户批准速度慢

如果用户花 10 秒逐个批准 3 个 operations：

**缓解**:
- 支持批量批准（未来优化）
- 或：只在用户点「继续对话」后才 submit（不是逐个 submit）

---

## 8. 后续优化

1. **批量批准** - 用户一次性批准/拒绝多个 operations，一次性 submit
2. **编辑参数** - interrupt 支持 `editedArgs`，用户修改 operation 内容后批准
3. **部分应用** - operation 应用失败时，回传失败原因给 Agent

---

## 9. 相关文件

### Agent Server

- `apps/agent/src/agent-messages.ts` - 生成 interrupt
- `apps/agent/src/http.ts` - 处理 resume 请求
- `apps/agent/tests/agent-messages.test.ts` - 测试 interrupt 生成

### Web

- `components/agent/agent-panel.tsx` - 调用 submitInterruptResponses
- `components/agent/agent-ag-ui-runtime-provider.tsx` - 暴露 submit 函数
- `components/agent/agent-confirmation-card.tsx` - 确认卡片
- `tests/unit/agent-panel.test.tsx` - 测试回传逻辑
