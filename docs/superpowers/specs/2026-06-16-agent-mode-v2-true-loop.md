# Agent Mode v2: True Agent Loop & Multi-Entry Chat

## Goal

用 AI SDK `streamText` + `tools` 真正多步工具循环替代当前的 prompt-driven JSON parsing，
使 Agent 能够在一个 run 里多次调用工具、基于真实执行结果推理，达到 JadeAI 级别的 agent
体验。同时增加悬浮聊天气泡入口、多会话历史、autoAccept 即时应用模式，以及用户追问补
充信息的中断工具 `resume_ask`。

## Scope

本 spec 覆盖四大交付物：

1. **真 Agent 工具循环** — AI SDK `streamText` + `tools` + `stopWhen` 替代 JSON parsing，模型在 run 内多步推理，每一步工具调用真实执行并返回结果给模型
2. **悬浮聊天气泡** — Agent Mode 的轻量化入口，可拖拽聊天气泡 + 弹出紧凑窗口，作为不同于左侧面板的第 2 种形态
3. **多会话历史** — 一个 resume 支持多个独立 agent session，可切换/重命名/删除，消息分页加载
4. **autoAccept 模式** — Agent 面板内 toggle 切换，autoAccept 开启时工具产生的 operation 自动 apply 到 RHF + autosave，无需逐条确认

## Non-Goals

- 不迁移 OCR、导入简历、AI 解析到 Agent 服务
- 不改变 Web 保留最终写入权的架构原则
- 不直接把 provider key 暴露给浏览器
- 不新增 workflow-specific 工具名（workflow 只改 prompt 和策略，不改 tool set）
- 不引入新的部署依赖（Redis/Caddy/Postgres 已有）

---

## 1. Architecture: True Agent Loop

### 1.1 Before / After

**现状（Phase 3B/3C）：**

```
用户消息 → buildAgentMessagePrompt (三段式) → generateText (Output.json)
→ 模型返回完整 JSON blob → parseAgentMessageProviderResponse
→ toAgUiAgentEvents → 前端渲染 text + tool cards + confirmation cards
```

toolCalls 数组里的调用**从未真实执行**——它们只是模型在 JSON 里声称的结果。
模型看不到工具执行效果，不能基于前一步结果做后续决策。

**改造后：**

```
用户消息 → AI SDK streamText({
    model,
    system prompt,
    messages,
    tools: { resume_read, resume_update_section, resume_delete_section,
             resume_insert_section, resume_reorder_sections,
             resume_polish_text, resume_set_text, resume_ask },
    stopWhen: stepCountIs(16),
    onStepFinish: emit AG-UI events (TOOL_CALL_START/ARGS/RESULT)
})
→ 模型调 resume_read → draft 沙盒执行 → 模型收到 result → 决定下一步
→ 模型调 resume_polish_text → 工具内部润色 + 保结构 → 模型收到 result
→ ... 多步循环 ...
→ 模型决定完成 → TEXT_MESSAGE_CONTENT + RUN_FINISHED
```

### 1.2 核心组件

```
┌─ Agent Service ────────────────────────────────────────────┐
│                                                              │
│  http.ts /v1/agent/messages                                  │
│    ├─ 接受既有 AgentMessageRequest contract                  │
│    ├─ 解析请求 → 构建 system prompt + messages               │
│    ├─ runResumeLoop({ model, draft, tools, stopWhen })       │
│    │   ├─ 每个 step: 模型调 tool → draft 沙盒执行            │
│    │   ├─ 工具返回 { draftSnapshot, operation }             │
│    │   └─ onStepFinish: push AG-UI events to SSE            │
│    └─ 流结束 → 写 AI cache + 关闭 SSE stream               │
│                                                              │
│  workflows/loop-runtime.ts (增强现有骨架)                    │
│    ├─ runResumeLoop() — 用 AI SDK streamText + tools         │
│    ├─ buildLoopSystemPrompt() — mode-aware (两种 mode)      │
│    └─ createLoopModel() — 已有，支持 BYO key                │
│                                                              │
│  workflows/tools.ts (重写)                                  │
│    ├─ 6 个可执行 tool + 1 个中断 tool                       │
│    ├─ 每个 tool 操作 DraftState 沙盒                       │
│    └─ 富文本 tool 内部保结构（HTML→TipTap JSON 桥接）       │
│                                                              │
│  workflows/draft.ts (增强)                                   │
│    ├─ DraftState — 简历副本的内存表示                       │
│    ├─ draftSnapshot() — 提取给模型看的快照                  │
│    └─ applyOperationToDraft() — 把操作写入沙盒              │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │ AG-UI SSE (TOOL_CALL_RESULT 含 operation)
                       ▼
┌─ Browser ───────────────────────────────────────────────────┐
│                                                              │
│  AgentAgUiRuntimeProvider                                    │
│    ├─ 接收 TOOL_CALL_RESULT → 提取 operation                │
│    ├─ autoAccept ON: 自动 applyOperation → RHF → autosave   │
│    ├─ autoAccept OFF: 攒到 pendingOperations → 确认卡        │
│    └─ 接收 resume_ask interrupt → question card             │
│                                                              │
│  AgentPanel (左侧面板) / AgentBubble (悬浮气泡)              │
│    ├─ 共享同一个 AgentAgUiRuntimeProvider                    │
│    └─ autoAccept toggle 状态同步                             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 1.3 Draft 沙盒

Draft 沙盒是 tools 操作的唯一目标——**不是真实简历**。在 `workflows/draft.ts` 现有
`DraftState` 基础上增强：

- 初始化：从请求的 `context.sections`（optimize_existing）或 `workspace.draftResume`（create_from_zero）构建
- 每次 tool 调用：读/写沙盒内状态，不触碰外部
- 每个 tool result：返回 `{ draftSnapshot, operation }`
  - `draftSnapshot` — 操作后的沙盒状态（模型视角的反馈）
  - `operation` — 对应的 `ResumeOperation`（前端 apply 到真实简历）
- 中断恢复：`resume_ask` 触发时，draft 序列化到 session snapshot；新 run 从 snapshot 恢复

### 1.4 Tool Set（6+1 个工具）

| # | 工具名 | 输入 | 行为 | 返回 |
|---|--------|------|------|------|
| 1 | `resume_read` | `sectionKey?` | 读 draft 当前状态 | draft 全文或指定 section 的 plainText + key/label/type 元信息 |
| 2 | `resume_update_section` | `fieldPath`, `newContent` (TipTap JSON) | 替换 draft 中指定字段 | 更新后的 section 文本 + `ResumeOperation` |
| 3 | `resume_delete_section` | `fieldPath` | 从 draft 中移除条目 | 被删除条目摘要 + `ResumeOperation` |
| 4 | `resume_insert_section` | `sectionKey`, `content` (TipTap JSON), `position?` | 向 draft 插入新条目 | 新条目摘要 + `ResumeOperation` |
| 5 | `resume_reorder_sections` | `sectionKey`, `newOrder: string[]` | 重排 draft 中条目顺序 | 新顺序 + `ResumeOperation` |
| 6 | `resume_polish_text` | `fieldPath`, `instruction?` | LLM 纯文本润色 → 套回原字段 TipTap 结构 | 润色后 plainText + `ResumeOperation`（含完整 TipTap JSON） |
| 7 | `resume_set_text` | `fieldPath`, `plainText` | 纯文本 → TipTap JSON（按原字段结构），写入 draft | `ResumeOperation`（含生成的有效 TipTap JSON） |
| — | `resume_ask` | `question`, `field?` | **中断 loop**，保存 draft 到 session snapshot，前端弹 question card | 中断信号 + 问题消息 |

**工具设计原则**：

- 模型只需要纯文本推理，富文本结构保护由工具内部保证
- `resume_polish_text` 和 `resume_set_text` 负责 JSON ↔ HTML ↔ TipTap JSON 的桥接
- `resume_ask` 是唯一中断 loop 的工具；中断时 draft state 必须完整序列化

### 1.5 富文本结构保护

模型不直接生成 TipTap JSON。两个富文本工具内部负责桥接：

**`resume_polish_text` 流程**：
```
1. 从 draft 读取 fieldPath 对应的 TipTap JSON
2. 提取 plainText + 记录结构模板（node types / marks / attrs）
3. 发纯文本给 LLM 润色（不告知 TipTap 细节）
4. 润色结果套回步骤 2 的结构模板
5. 产出有效 TipTap JSON → 写入 draft + 生成 ResumeOperation
```

**`resume_set_text` 流程**：
```
1. 读原字段结构（是 paragraph / bulletList / orderedList？）
2. plainText 按段落/换行分拆
3. 每段套用原结构 node type + marks
4. 产出有效 TipTap JSON → 写入 draft + 生成 ResumeOperation
```

两端都经过 `lib/tiptap-types.ts` 的 schema 校验。列表结构保持列表，
加粗保持加粗。

---

## 2. Dual Mode: autoAccept Toggle

同一个 Agent 面板内，顶部一个 toggle 控制操作消费策略。

### 2.1 两种模式

| 维度 | 确认模式 (toggle OFF，默认) | autoAccept 模式 (toggle ON) |
|------|---------------------------|---------------------------|
| 工具执行 | 循环跑完，operation 攒齐 | 每个 step 的 operation 立即 apply |
| 前端行为 | RUN_FINISHED 后渲染确认卡，逐条 [应用] [忽略] | TOOL_CALL_RESULT 到达 → 自动 applyOperation |
| apply 路径 | RHF setValue + resume:flush-autosave | 同左 |
| 用户感知 | 看到工具在跑 → 等确认卡 | 看到工具实时生效 → 短暂 toast |
| 可撤回 | 逐条决策 | RHF undo 撤销整轮 |
| 安全机制 | 自然安全（每一步都要确认） | draft 沙盒 + RHF undo 双重保护 |

### 2.2 autoAccept 时的 UI 反馈

- 每个自动 apply 的 operation：toast `已应用：{label}`，1.5s 自动消失
- 一轮 run 产生 ≥6 个 operations 时：汇总 toast `本轮应用了 N 处修改，可以撤销`
- 工具卡片尾部显示 `✓ 已应用`，不阻塞后续工具执行

### 2.3 autoAccept 的安全护栏

**不需要按操作类型区分。** draft 沙盒 + RHF undo 已经足够。autoAccept 对所有 operation 一视同仁自动 apply。

唯一特殊处理：一轮 ≥6 个操作时弹汇总 toast。

---

## 3. Floating Chat Bubble

Agent Mode 的轻量化入口，在编辑器页面以可拖拽气泡形态存在。

### 3.1 形态关系

```
气泡点击 → 弹出紧凑聊天窗口 (320px)
气泡窗口 [展开] 按钮 → 切换到左侧 Agent 面板
左侧面板 [关闭] → 气泡重新出现
```

- **气泡**：右下角固定（默认位置），可拖拽改变位置
- **窗口**：320px 紧凑聊天窗口，从气泡弹出，顶部有标题栏 + [展开到面板] 按钮 + [最小化] 按钮
- **气泡窗口默认 autoAccept ON**（适应快速操作场景）
- **展开**：保留当前对话上下文，面板共享同一个 session/runtime
- **收起**：面板关闭后气泡重新出现

### 3.2 气泡组件结构

```
components/agent/
  agent-bubble.tsx           # 可拖拽气泡按钮 + 弹出窗口容器
  agent-bubble-chat.tsx      # 气泡窗口内的聊天内容（复用 AgentPanel 的核心收发逻辑）
```

气泡窗口复用 `AgentAgUiRuntimeProvider` 和 assistant-ui thread/composer primitives，
与左侧面板共享核心逻辑。差异仅在容器尺寸和入口行为。

### 3.3 气泡行为

- 可拖拽到屏幕任意位置，位置存入 localStorage
- 有未读 agent 消息时气泡显示红色角标
- 编辑器不在前台时气泡隐藏
- 模板选择页/仪表盘页面不显示气泡

---

## 4. Multi-Session Chat History

一个 resume 可以创建多个独立 agent session，支持切换、重命名、删除、
消息分页加载。

### 4.1 数据模型增强

现有 `agentSessions` 表已支持多 session（由 `(id, userId, resumeId)` 组合键）。
需要增强的点：

- session 增加 `title` 字段（已有，需确保首条用户消息触发自动标题）
- 新增 `GET /api/agent/sessions?resumeId=...` 列表接口
- 新增 `DELETE /api/agent/sessions/:id` 删除接口
- 新增 `PATCH /api/agent/sessions/:id` 重命名接口
- session `stateJson` 保留完整 snapshot（含 workspace/draft/workflow cursor），支持跨 run 恢复

### 4.2 前端会话列表

```
┌─ Agent 面板头部 ───────────────────────────┐
│  💬 Agent 模式        [autoAccept toggle]  │
│  ┌──────────────────────────────────┐      │
│  │ 📋 STAR优化-后端经历          ▼  │      │
│  └──────────────────────────────────┘      │
│  ┌─ 下拉菜单 ──────────────────────┐      │
│  │ + 新建对话                       │      │
│  │ ──────────────────────────────── │      │
│  │ 📝 目标岗位匹配        06/15    │      │
│  │ 📝 STAR优化-后端经历    06/16    │      │
│  │ 📝 语法终检             06/14    │      │
│  └──────────────────────────────────┘      │
└─────────────────────────────────────────────┘
```

### 4.3 消息分页

- 每个 session 超过 50 条消息时，向上滚动到顶部触发 `loadMore`
- 分页从 `agentSessionEvents` 表按 sequence 倒序查询
- 气泡窗口同样支持分页（共享 session store）

### 4.4 气泡的会话行为

- 气泡窗口共享与面板相同的会话列表
- 从气泡创建的新对话可在面板中继续，反之亦然
- 气泡默认打开最近活跃的会话

---

## 5. resume_ask Interrupt & Question Card

### 5.1 中断流程

```
Agent Service                     Browser
  │                                 │
  │ step N: model 调 resume_ask     │
  │   → loop 中断                   │
  │   → draft 序列化到 snapshot     │
  │                                 │
  │ RUN_FINISHED {                  │
  │   outcome: {                    │
  │     type: "interrupt",          │
  │     interrupts: [{              │
  │       reason: "question",       │
  │       message: "你上一家公司..."│
  │       metadata: { field, ... }  │
  │     }]                          │
  │   }                             │
  │ }                               │
  │ ──────────────────────────────> │
  │                                 │  渲染 question card
  │                                 │  用户输入回答
  │                                 │  新 POST /api/agent/runs
  │  新 run：从 snapshot 恢复 draft │  (含 answer + 原 sessionId)
  │  模型看到问答上下文             │
  │  继续推理...                     │
```

### 5.2 Question Card UI

```
┌─ ❓ Agent 需要补充信息 ────────────────────┐
│                                              │
│  你上一家公司的名称是什么？                    │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ 输入回答...                           │    │
│  └──────────────────────────────────────┘    │
│                                [发送]        │
└──────────────────────────────────────────────┘
```

---

## 6. Tool Call Visibility (UX)

### 6.1 工具卡片渲染

每个 step 的 tool call 渲染为可展开卡片：

- **运行中**：spinner + 工具中文标签 + "正在执行..."
- **完成**：折叠为一行摘要（如 `✓ resume_read · 读取了 summary, experience, education`），可展开查看 args/result
- **autoAccept 应用后**：尾部显示 `✓ 已应用`
- **确认模式**：含 `ResumeOperation` 的 card 附 [查看修改] [应用] [忽略] 操作

### 6.2 Step 时间线

工具调用按 step 顺序展示在消息流中，形成可见的 agent 工作痕迹：

```
[assistant text]
  ├─ 🔍 resume_read
  ├─ ✏️ resume_polish_text
  └─ ✏️ resume_polish_text
[assistant text]
```

---

## 7. Data Flow & Contract

### 7.1 Request/Response Contract（保持不变）

`POST /v1/agent/messages` 的 request body（`AgentMessageRequest`）和 Web BFF 路由
保持现有 contract。改动在 Agent 服务内部的处理方式，外部接口不变。

### 7.2 AG-UI Event Sequence（正常流程）

```
RUN_STARTED
STATE_SNAPSHOT               ← 初始 workspace snapshot
TEXT_MESSAGE_START
TEXT_MESSAGE_CONTENT          ← 模型首段文本（解释意图）
TOOL_CALL_START               ← step 1: resume_read
TOOL_CALL_ARGS
TOOL_CALL_RESULT
  (content: { toolCall, operation?, draftSnapshot })
TEXT_MESSAGE_CONTENT          ← 模型评估结果，决定下一步
TOOL_CALL_START               ← step 2: resume_polish_text
TOOL_CALL_ARGS
TOOL_CALL_RESULT
  (content: { toolCall, operation, draftSnapshot })
TEXT_MESSAGE_CONTENT          ← 模型说明修改
... 更多步骤 ...
TEXT_MESSAGE_END
STATE_DELTA (/workspace)      ← 最终 workspace 状态
RUN_FINISHED { outcome: "success" | "interrupt" }
```

### 7.3 AG-UI Event Sequence（resume_ask 中断）

```
... preceding steps ...
TOOL_CALL_START               ← resume_ask
TOOL_CALL_ARGS
TOOL_CALL_RESULT
  (content: { question, field? })
TEXT_MESSAGE_END
STATE_DELTA (/workspace)      ← 中断前的 draft state
RUN_FINISHED {
  outcome: {
    type: "interrupt",
    interrupts: [{ reason: "question", message, metadata }]
  }
}
```

### 7.4 AG-UI Event Sequence（错误）

```
... preceding steps ...
RUN_ERROR { code, message, requestId }
```

---

## 8. Safety & Rollback

- **Draft 沙盒**是首要安全机制——模型从不直接操作真实简历
- `ResumeOperation` 的 apply 路径仍是现有 RHF setValue → autosave
- autoAccept 模式下 RHF undo（ctrl+z）可撤销整轮操作
- Agent 服务不可用时编辑器、preview、autosave 继续正常工作
- 现有 AI cache（Redis）仍然有效：cache key 基于 content hash，loop 完成后的最终结果可被缓存

---

## 9. Component Changes Summary

### 9.1 Agent Service (apps/agent)

| 文件 | 变更类型 | 描述 |
|------|---------|------|
| `src/workflows/tools.ts` | 重写 | 6+1 个真 AI SDK 工具定义，操作 draft 沙盒 |
| `src/workflows/loop-runtime.ts` | 增强 | 两种 mode 的 system prompt，streamText + tools，onStepFinish→AG-UI |
| `src/workflows/draft.ts` | 增强 | DraftState 完整 CRUD，applyOperationToDraft |
| `src/http.ts` | 修改 | /v1/agent/messages 集成 runResumeLoop，替代 parseAgentMessageProviderResponse |
| `src/agent-messages.ts` | 精简 | 保留 validation/contract 类型；移除 prompt/parser 逻辑（被 loop-runtime 替代） |
| `src/agent-tools.ts` | 保留 | ResumeOperation schema 校验不变 |
| `src/workflows/dev-preview-provider.ts` | 移除 | 被真 loop 替代 |
| `tests/` | 大幅更新 | 新增 loop-runtime、tools、draft 沙盒测试 |

### 9.2 Web App (apps/web)

| 文件 | 变更类型 | 描述 |
|------|---------|------|
| `components/agent/agent-panel.tsx` | 修改 | 新增 autoAccept toggle，session 选择器，question card 渲染 |
| `components/agent/agent-bubble.tsx` | **新增** | 可拖拽悬浮气泡 + 弹出聊天窗口 |
| `components/agent/agent-bubble-chat.tsx` | **新增** | 气泡窗口内的聊天内容（复用 panel 核心逻辑） |
| `components/agent/agent-tool-card.tsx` | 修改 | 实时显示 tool 运行状态，autoAccept 时显示"已应用" |
| `components/agent/agent-ag-ui-runtime-provider.tsx` | 修改 | 支持 autoAccept 自动 apply，处理 resume_ask interrupt |
| `components/agent/agent-confirmation-card.tsx` | 保留 | 确认模式下仍使用 |
| `lib/agent/session-store.ts` | 增强 | 多 session CRUD，消息分页查询 |
| `lib/agent/direct-run-client.ts` | 保留 | 直连 Agent SSE 的路径不变 |
| `app/api/agent/direct-runs/route.ts` | 保留 | Bootstrap JWT 签发不变 |
| `app/api/agent/runs/route.ts` | 保留 | BFF 代理路径不变 |
| `app/api/agent/sessions/route.ts` | **新增** | 多 session 列表/创建/删除/重命名 |
| `db/schema.ts` | 修改 | agentSessions 表可能的小调整（确认 title 字段） |
| `tests/unit/` | 大幅更新 | agent-panel, agent-bubble, session-store, tool cards 测试 |

---

## 10. Implementation Order

建议按以下顺序，每个切片独立可验证：

1. **Agent 服务真 loop** — runResumeLoop 替代 parseAgentMessageProviderResponse，tools 操作 draft 沙盒，AG-UI 事件流
2. **autoAccept 模式** — Agent 面板 toggle + 自动 apply，现有路径不变（gate: 确认模式仍工作）
3. **富文本工具** — resume_polish_text + resume_set_text，保结构桥接
4. **resume_ask** — 中断工具 + question card + draft 恢复
5. **悬浮气泡** — 可拖拽气泡 + 弹出窗口，复用 runtime
6. **多会话历史** — session CRUD + 消息分页

每个切片完成后跑 `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build`。
