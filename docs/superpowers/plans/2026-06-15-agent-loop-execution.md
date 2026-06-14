# Agent Loop Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（或 subagent-driven-development）逐任务实现。步骤用 `- [ ]` 复选框跟踪。先写失败测试，再写实现（TDD）。
> 配套设计：`docs/superpowers/specs/2026-06-15-agent-loop-execution-design.md`（已锁定「全自主 loop + draft 预览」模型）。

**Goal:** 把 create-from-zero 的执行器从「单次结构化生成」换成一个**真 AI SDK 多步工具循环**：loop 全自主跑、工具调用全程可见、所有写操作进 **draft**，loop 结束按 `diff(draft, 真简历)` 出一个 change-set preview；用户可续上对话继续改 draft，或同意应用（draft→真简历，由 Web 落盘）。

**Architecture:** loop 跑在自托管 `apps/agent`（无 serverless 时长上限）。写工具的 `execute` 只改 draft，loop 不挂起、一次跑到完。AG-UI 继续做事件协议，assistant-ui 继续做 thread + tool 展示。真简历只在用户「同意应用」时由 Web BFF 写。复用 PR #76 的 durable session/event-log 携带 draft 跨回合。

**Tech Stack:** Next.js 16.2 / React 19.2、AI SDK（`streamText` + `tools` + `stopWhen: stepCountIs`）、`@ag-ui/*@0.0.56`、`@assistant-ui/react@0.14` + `@assistant-ui/react-ag-ui@0.0.36`、Vitest、自托管 Node Agent。提示词与工具 input schema 参考 `LingyiChen-AI/JadeAI`（Apache-2.0，需 attribution）。

---

## Scope

**本 plan = 第一个可发布切片：create-from-zero 的真 loop，端到端跑通。** 只做这一条竖切：

- 最小工具集：`resume_read`(draft)、`get_completeness`(draft)、`upsert_section`(写 draft)、`finish`、可选 `ask_user`。
- draft 持久化 + loop 末 change-set preview + 「同意应用」+「续上对话」。

**显式推迟到后续 plan（不在本切片）：** optimize_existing 的「draft=真简历副本」、写工具全集（delete/reorder/set_profile…）、真正的上下文压缩引擎（context-status 升级）、离线评测 harness、浏览器直连 agent 的流式迁移。

## File Structure

- 新增 `apps/agent/src/workflows/loop-runtime.ts`：多步 loop 驱动（streamText + tools + stopWhen + 护栏 + AG-UI 事件）。
- 新增 `apps/agent/src/workflows/tools.ts`：create-from-zero 工具集（read 带 execute；write 改 draft）。
- 新增 `apps/agent/src/workflows/draft.ts`：draft 模型 + `diff(draft, base)` → `ResumeChangeSet`。
- 修改 `apps/agent/src/http.ts`：create-from-zero 走 `loop-runtime` 而非单次执行器。
- 修改 `apps/web/lib/agent/ag-ui-stream.ts`：解析 tool-call（start/args/result）与 `change_set_preview` 事件。
- 修改/扩展 `apps/web/components/agent/agent-tool-card.tsx`：tool 调用的 running/args/result 状态展示。
- 修改 `apps/web/components/agent/agent-panel.tsx`：用 assistant-ui 的 tool content-part 渲染 loop 工具调用 + 末尾 preview 卡（含「同意应用 / 继续对话」）。
- 修改 `apps/web/app/api/agent/runs/route.ts` + 新增 apply handler：`loadAgentSessionSnapshot` 带 draft 续跑；apply 把 change-set 落真简历。
- 修改 `apps/web/lib/agent/session-store.ts`：draft 并入 session snapshot 的 reduce/persist。
- 测试：`apps/agent/tests/loop-runtime.test.ts`、`draft.test.ts`、`apps/web/tests/unit/agent-ag-ui-stream.test.ts`、`agent-panel-assistant-ui.test.tsx`、`agent-runs-route.test.ts`。

## Task 1: Loop 执行器（agent，多步工具循环）

**Files:** Create `apps/agent/src/workflows/loop-runtime.ts`; Modify `apps/agent/src/http.ts`; Test `apps/agent/tests/loop-runtime.test.ts`

- [ ] **Step 1 — 写失败测试**：注入一个 mock provider，脚本化产出 3 个 tool call（`resume_read` → `upsert_section` → `finish`）。断言 loop：依序执行工具、把每个 tool result 回灌、emit 顺序为 `RUN_STARTED → (TEXT delta)* → (TOOL_CALL_START/ARGS/RESULT)×N → RUN_FINISHED`，且最终拿到非空 draft。
- [ ] **Step 2 — 验证红**：`pnpm --filter @intro-builder/agent test -- tests/loop-runtime.test.ts`（FAIL：runtime 不存在）。
- [ ] **Step 3 — 实现 loop**：用 `streamText({ model, system, messages, tools, stopWhen: stepCountIs(MAX_STEPS) })`（API 名对照实际 AI SDK 版本，见 Risks）。流式 emit 可见文本 delta + 每个工具的 AG-UI 事件；`onStepFinish` 累积 draft。
- [ ] **Step 4 — 接线 http.ts**：create-from-zero（`mode==="create_from_zero"`）路由到 `loop-runtime`；其余维持原执行器。
- [ ] **Step 5 — 验证绿**：同上测试命令 PASS。

## Task 2: create-from-zero 工具集

**Files:** Create `apps/agent/src/workflows/tools.ts`; Test in `loop-runtime.test.ts`

- [ ] **Step 1 — 写失败测试**：断言 `resume_read()` 返回当前 draft；`upsert_section({key,...})` 改 draft 并返回 diff 作为 tool result；`get_completeness()` 反映 draft 现状；`finish` 结束 loop。
- [ ] **Step 2 — 验证红**。
- [ ] **Step 3 — 实现工具**：读类带 `execute`（读 draft / 算完整度）；写类 `execute` **只改 draft**（不碰真简历），输出复用 `ResumeOperation` 形状。input schema 与 section 结构描述参考 JadeAI `updateSection`（含其防御性解析：双重 JSON 恢复、补 id、强制数组、null 拒绝）。值落到你的 `lib/resume-schema.ts` 契约 + TipTap JSON。
- [ ] **Step 4 — 验证绿**。

## Task 3: Draft 模型 + change-set diff + preview 事件

**Files:** Create `apps/agent/src/workflows/draft.ts`; Modify `loop-runtime.ts`, `apps/web/lib/agent/ag-ui-stream.ts`; Test `apps/agent/tests/draft.test.ts`, `apps/web/tests/unit/agent-ag-ui-stream.test.ts`

- [ ] **Step 1 — 写失败测试（agent）**：`diff(draft, base=空)` 产出一个 `ResumeChangeSet`（每段一个 insert op）；loop 末 emit 一个 `change_set_preview` 事件（draft + change-set）。
- [ ] **Step 2 — 写失败测试（web）**：`ag-ui-stream` 能从该事件解析出 change-set 与 draft 快照。
- [ ] **Step 3 — 验证红（两侧）**。
- [ ] **Step 4 — 实现**：draft 模型 + diff；loop 末计算并 emit；web 侧解析 helper（沿用现有 `extractAgUi*` 风格 + type guard）。
- [ ] **Step 5 — 验证绿（两侧）**。

## Task 4: Tool-call UI（assistant-ui）

**Files:** Modify `apps/web/components/agent/agent-tool-card.tsx`, `agent-panel.tsx`; Test `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [ ] **Step 1 — 写失败测试**：渲染一条带工具部件的 assistant 消息，断言每个工具显示名称 + 状态（running→done）+ 结果摘要；`upsert_section` 显示变更摘要 chip。
- [ ] **Step 2 — 验证红**。
- [ ] **Step 3 — 实现**：用 assistant-ui 的 tool content-part 渲染（`MessagePrimitive.Content` 的 `components.tools`：`by_name` 给已知工具、`Fallback` 给其余；或 `makeAssistantToolUI`——以 0.14 实际 API 为准），把现有 `AgentToolCard` 升级成支持 running/args/result 三态。tool call 经 `@assistant-ui/react-ag-ui` 运行时自然流入消息部件。
- [ ] **Step 4 — 验证绿**。

## Task 5: Preview / 应用 / 续聊（web BFF + 面板）

**Files:** Modify `apps/web/app/api/agent/runs/route.ts`（+ 新增 apply handler）, `apps/web/lib/agent/session-store.ts`, `agent-panel.tsx`; Test `apps/web/tests/unit/agent-runs-route.test.ts`, `agent-session-store.test.ts`

- [ ] **Step 1 — 写失败测试**：(a) draft 并入 session snapshot 的 reduce/persist 往返；(b) 续上对话时 `loadAgentSessionSnapshot` 带出 draft 注入下一次 run；(c) apply handler 校验归属后把 change-set 的 `ResumeOperation` 应用，create-from-zero 时创建新简历。
- [ ] **Step 2 — 验证红**。
- [ ] **Step 3 — 实现**：session-store 加 draft 字段映射；preview 卡（复用 live-preview + 变更高亮）+「同意应用 / 继续对话」按钮；apply 走现有「Web 落真简历」边界（唯一写真简历处），应用后 draft 基线对齐。
- [ ] **Step 4 — 验证绿**。

## Task 6: 护栏 + trace + 完成验证

**Files:** Modify `loop-runtime.ts`, `apps/agent/src/observability.ts`

- [ ] **Step 1 — 护栏测试**：MAX_STEPS 截断、token/墙钟预算超限优雅收尾、无进展检测（同工具同参重复 N 次中止）。
- [ ] **Step 2 — 实现护栏 + 每步 Langfuse span**（扩展现有 `traceGeneration`）。
- [ ] **Step 3 — 闸门（AGENTS.md §6）**：`pnpm test`、`pnpm tsc --noEmit`、`pnpm lint`、`pnpm build` 全绿。
- [ ] **Step 4 — 手工冒烟**：`pnpm dev` + `pnpm agent:dev`，create-from-zero 走一遍：loop 全程 tool call 可见 → draft 成形 → 末尾 preview → 「同意应用」生成真简历 / 「继续对话」迭代同一 draft。

## Risks / 待验证（开工前先落实）

- **AI SDK 多步 + HITL 无关**：本切片写工具直接写 draft、loop 不挂起，所以**不需要** HITL 挂起 API。但要核实你装的 AI SDK 版本里 `streamText` 的多步 API（`stopWhen: stepCountIs` vs `maxSteps`）、`onStepFinish`、以及「`tools` + 可见文本流」如何并存。JadeAI 用的是 `stopWhen: stepCountIs(25)` + `convertToModelMessages`，可作参照。
- **Provider 原生 function calling 稳定性**：DeepSeek 等的 tool calling 不稳会导致 loop 卡顿；准备一个「无 tool call 即收尾」的兜底（参 JadeAI 的防御性解析）。
- **draft diff 复杂度**：你的内容是 TipTap JSON，diff/preview 要走既有 JSON↔HTML 工具，别在这里重造。
- **长 loop × Vercel**：loop 一次跑完可能 >60s；本切片仍走 BFF 转发可先用，但要给 `runs` 路由设 `maxDuration` 并尽快推进「浏览器直连自托管 agent」（独立 plan）。
- **assistant-ui 版本**：`@assistant-ui/react@0.14` 的 tool content-part API 以实际版本为准；优先用其内置 tool 渲染而非手搓。

## Definition of Done

- create-from-zero 单次 loop 真多步（≥3 步、含至少一次「读到结果后改决策」），工具调用在面板全程可见。
- 所有写操作只改 draft；loop 末出 change-set preview；「同意应用」后才由 Web 落真简历；「继续对话」能在同一 draft 上迭代。
- loop 全程 trace；护栏（步数/预算/无进展）生效。
- 从 event log 能重建 session 的 draft 与 change-set（测试覆盖）。
- `pnpm test / tsc / lint / build` 全绿 + 手工冒烟通过。

## 后续 plan（不在本切片）

1. optimize_existing：draft=真简历副本 + 增量改写。
2. 写工具全集（delete/reorder/set_profile…）+ 质量校验（防编造/格式）。
3. 上下文压缩引擎（context-status 从指示器升级为真摘要/裁剪，修硬编码 200k）。
4. 离线评测 harness（金标准集 + 轨迹级指标 + 回放，扩展 langfuse-agent-message-experiment）——「调优 loop」的落点。
5. 浏览器直连自托管 agent 的流式迁移（绕开 Vercel 时长限制）。

## 落地进度（2026-06-15，分支 codex/agent-loop-execution）

**已落地 + 已测（agent 侧，165 tests 全绿 + tsc clean）：**

- Task 1/2/3：`apps/agent/src/workflows/{draft,tools,loop-runtime}.ts` —— draft 模型 +
  change-set diff、create-from-zero 工具集（read/get_completeness/set_goal/upsert_section）、
  AI SDK v6 多步 loop（`streamText`+`tools`+`stopWhen(stepCountIs(16))`）。新增 17 个单测，
  其中关键一条把 loop 产物喂给既有 `validateAgentToolOutput` 锁兼容。
- 接线：`http.ts` 新增 `streamAgentLoopEvents`，create-from-zero 经真 loop，复用既有
  head 发射 + `toStreamingRuntimeTailEvents`（工具事件 / workspace / change-set 走既有管线）。
- 安全开关：`AGENT_LOOP_ENABLED`（默认 false）。关 = 旧单次路径（main 行为不变）；开 = 真 loop。
- 续聊：`rehydrateDraft` 从 durable session 还原 draft（含 last-write-wins），下一回合接着改。

**剩余（需在本机跑 Next 构建 + 手工冒烟验收）：**

- Task 5 真正缺口：create-from-zero「同意应用」对**全新数组分区项**（如还不存在的 experience.0）
  的创建——现已支持 `basics.summary`、`skills` 及已存在索引的 tiptap 字段（loop 产出的 op 现在
  自带 `replacementTiptapJson`，`applyAgentOperation` 也已接受 `insert_section`）；新增数组项需接
  编辑器的「加一项」流程。
- Task 6 剩余：loop 路径接 Langfuse trace；`pnpm build` 全量 + 手工冒烟（开 flag、配真 provider 走一遍）。
  已完成的护栏：`stepCountIs(16)` + 草稿写操作上限 `MAX_DRAFT_OPERATIONS=24`（新字段超限拒绝、更新不受限）。

**已完成的 web 侧：** Task 4 工具卡升级（动作 chip + 目标字段 + 「已写入草稿」，`agent-tool-card.tsx`，
面板测试 15/15 通过）；Task 5 续聊（`rehydrateDraft`）+ `insert_section` 应用（`editor-client.tsx`）。

**启用方式：** agent 服务设 `AGENT_LOOP_ENABLED=true` 并配好 `AGENT_MODEL_*`，create-from-zero
即走真 loop。
