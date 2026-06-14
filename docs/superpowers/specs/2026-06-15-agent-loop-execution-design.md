# Agent Loop Execution Design（在 v2 Runtime 之上做真 loop）

Date: 2026-06-15

## Summary

`2026-06-12-agent-workflow-runtime-v2-design.md` 已经规划并（在 PR #76 里）落地了
Agent v2 的**骨架**：durable agent session、resume workspace、event log、AG-UI
事件词表、context-status 指示器、propose→approve→apply 的安全边界。但**执行器本身
仍然是单次模型调用**——`streamAgentMessageEvents`（`apps/agent/src/http.ts`）只调一次
`provider.stream()`，把一份结构化 JSON 流式抠出可见文本，然后由
`buildWorkflowRuntimeEvents` / `toStreamingRuntimeTailEvents` 把这**一次**结果补成
工具事件；`toolCalls` 不是真正被执行并被观察的工具调用，`workflowId` 只是 prompt
里的一行提示。

本 spec 只解决一件事：**把单次执行器换成一个真正的 multi-step 工具循环**
（reason → 调工具 → 观察结果 → 再决策 → 直到本回合结束），并让这个 loop 从一开始
就是**可评测、可调优**的。会话/工作区/事件日志/审批 UI 继续复用 v2 已有的部分。

### 已拍板的关键决策（2026-06-15）

1. **写操作授权模型 = 全自主 loop + 末尾 draft 预览审批（2026-06-15 最终）。** loop 全程自主跑，
   所有工具调用对用户**完整可见**；所有写操作都写进 **draft（草稿副本）**，loop 内绝不碰真简历。
   loop 结束后，按 draft vs 真简历的 **change-set 出一个 preview**；用户可（a）**续上对话**让 loop
   在同一 draft 上继续迭代，或（b）**同意应用**，由 Web BFF 把 change-set 落成真正的简历改动。
   > 演进：末尾批量审批 → per-call → 现定为「全自主 + draft 预览」。loop 不被打断（最顺），
   > 真简历只在显式 apply 时由 Web 写。
2. **loop 引擎 = AI SDK 多步工具循环。** 复用现有 AI SDK openai-compatible 接入，用
   原生 function calling + 多步控制（`stopWhen` / `stepCountIs` / `prepareStep` 一类，
   具体 API 名以仓库实际安装版本为准，见「待验证」）。
3. **首个 PoC = create-from-zero（从零建简历）。** 最受益于 loop，也最能暴露
   「收集事实 → 起草 → 自检 → 追问」这条多步链路的设计问题。

### 核心设计（全自主 loop + draft 预览）

loop 像在一个 **draft 沙盒**里干活，结束后给一次 diff 预览，用户决定续聊还是应用——类似给简历
开一条「分支」，最后看 diff 再「合并」。

- **draft 生命周期**：optimize_existing 的 draft 初始 = 真简历的副本；create-from-zero 的 draft = 空白
  新简历。draft 存在 durable session 里，跨回合保留。
- **回合内（loop）**：读工具自动执行；写工具的 `execute` **直接写 draft**（不是真简历），所以 loop
  无需挂起、一次跑到完。每个工具调用都 emit AG-UI 事件，用户实时看到完整 loop。
- **loop 结束**：算 `change-set = diff(draft, 真简历)`，渲染 preview（复用现有 live-preview / 模板渲染
  + 变更高亮）。若遇硬阻塞（缺关键事实）可用 `ask_user` 提前结束并提问。
- **用户决策（在 loop 之外）**：
  - **续上对话** → 下一条消息触发新 loop，继续改同一个 draft，preview 刷新。
  - **同意应用** → BFF 把 change-set 应用到真简历（draft→real，唯一写真简历处），随后 draft 与真简历对齐。

因为 loop 一次跑到完、单次运行可能较长，**更要把长 SSE 流直连自托管 agent**（别穿 Vercel），
并把护栏当作 loop 唯一的边界（见下）。

## Current Baseline（v2 已经有什么）

复用、不重做：

- `apps/web/lib/agent/session-store.ts`：durable session + event log + 快照 reduce。
- `packages/shared/src/types/agent-v2.ts`：session / workspace / interrupt / context 类型。
- `apps/agent/src/workflows/resume-workspace.ts`：facts / draftResume / changeSets 模型。
- `apps/agent/src/workflows/context-status.ts`：上下文预算的 schema 与指示器。
- AG-UI 事件词表 + assistant-ui 的 thread / question card / approval card / 批量审批。
- `signAgentToken` + JWT 边界 + 限流 + `isSafeModelBaseUrl` SSRF 校验。

需要替换/新增：

- **执行器**：`streamAgentMessageEvents` 的「单次调用 + 合成事件」换成真 loop driver。
- **工具**：从「模型 emit 的 JSON 字段」换成带 `execute()` 的真工具（见下）。
- **上下文工程**：`context-status.ts` 从「只报告」升级成「真压缩」。
- **续跑装配**：把 loop 的中间状态映射进现有 session snapshot，保证回合粒度可续。

约束（沿用 v2，不变）：

- 浏览器经 BFF 鉴权；改真简历只能由 Web 在用户确认后做（`ResumeOperation` /
  `ResumeChangeSet`）。Agent 不直接动 RHF / Postgres。
- `LivePreview` 保持 RHF 驱动；TipTap JSON 仍是富文本存储格式。

## Goals / Non-Goals

Goals：

1. 一个回合内能跑真 multi-step 工具循环，模型能「读到真实结果再决策」。
2. loop 全自主跑完、工具调用全程可见，所有写操作落 draft；结束后出一个 change-set preview。
3. 用户可续上对话继续改 draft，或同意应用（draft→真简历，由 Web 落盘）；create-from-zero 从空白 draft 起草，缺关键事实时 ask_user 或留待续聊补充。
4. loop 从第一天起就被 trace + 可离线回放评测，支持「改一个旋钮 → 重跑评测 → 比较」。

Non-Goals（本期不做）：

- loop 内的人工审批/挂起（已否决 per-call）；审批只发生在 loop 结束后的 preview 上。
- 多 agent / subagent 编排。
- workflow 真状态机（先保留 v2 的 cursor，作为软提示；要不要做实是后续决策）。
- 自动落地任何真简历改动（决策 1 已排除）。

## 架构

```text
Browser (assistant-ui / AG-UI)
  thread / composer / question card / approval card / interrupt controls
        │  SSE（建议：BFF 签 scoped JWT，浏览器直连自托管 agent 拿长流）
Web BFF (Vercel)
  auth · resume ownership · 签 JWT · 用户确认后把 change-set 落盘 · session 落库
        │
Agent Loop Runtime (自托管 apps/agent，无 serverless 时长上限)
  load session → 多步工具循环 → emit AG-UI 事件 → 持久化 workspace+event log
        │
Tools
  read（自动执行）/ stage-write（改 staging）/ control（ask_user, submit_draft）
```

回合内 loop 骨架（伪代码）：

```text
state = loadSession(sessionId)            // workspace / 历史 / cursor
ctx   = packContext(state, budget)        // 步间会重算（见「上下文工程」）
for step in 1..MAX_STEPS:
    result = model.step(system, ctx, tools)   // AI SDK 多步：原生 tool calling
    if result.toolCalls:
        for call in result.toolCalls:
            obs = execute(call)               // 读→查库/快照；写→改 staging 并回 diff
            ctx = append(ctx, obs)            // 观察结果回灌
            emit(TOOL_CALL_START/RESULT)
        continue                              // 继续观察-决策
    else:
        break                                 // 模型不再调工具 = 本步要收尾
exitReason = classifyExit(state)              // needs_facts | has_draft | done
persist(state); emit(STATE_DELTA, RUN_FINISHED{interrupt?})
```

运行位置 & Vercel：loop 在自托管 agent 上跑（无 60s/800s 限制）。强烈建议长 SSE 流
**浏览器直连 agent**（BFF 只负责签发 scoped JWT 与「确认落盘」），这样 Vercel 函数时长
永远不在 loop 关键路径上。详见 2026-06-13 的 BFF/直连分析。

## 工具面（Tool surface）

把今天「模型 emit 的 `proposedOperations` JSON」换成真工具，分三类：

- **读类（自动执行，安全）**：`resume_read`（读当前 draft/真简历快照）、
  `get_completeness`、`read_uploaded_source`（如有上传材料）、`list_templates`。
  返回结构化结果回灌给模型。
- **写类（带 `execute`，直接写 draft）**：`upsert_section`、`set_profile`、`reorder_sections`、
  `delete_section` 等。`execute` 改的是 **draft**（不是真简历），返回 diff 作为 tool result 让模型
  观察；改动累积进 `workspace.draftResume` / `changeSets`。loop 不因写操作挂起。
- **控制类**：可选 `ask_user(questions[])`（仅硬阻塞时用，提前结束 loop 提问）、`finish(summary)`
  收尾。审批不在工具层——而是 loop 结束后对整份 change-set 出 preview。

结构化最终产物：不再要求「整条回复是一个 JSON」（v2 已指出这让长 loop 变脆）。改成
**用工具调用承载结构**——模型通过调用工具的参数（zod schema 校验）来「返回结构」，自由文本
只用于流式可见消息。这样 loop 不会因为一次 JSON 解析失败而晚期崩溃。

## 护栏（这是你之后要调的旋钮）

- `MAX_STEPS`（每回合最大步数）+ `MAX_TOOL_CALLS_PER_STEP`。
- 预算：token / 估算成本 / 墙钟，任一超限 → 优雅收尾（带 `near_limit` 警告）。
- 无进展检测：同一工具 + 同一参数重复 N 次 → 中断并收尾，避免打转。
- **硬门**：任何改真简历的动作都不允许出现在 loop 内；loop 只能 stage。
- 每个 stage-write 后跑现有校验（防编造 / 格式风险 / 必填事实缺失），写进
  `qualityReport`。

## 上下文工程（让 context-status 从指示器变引擎）

real loop 会快速堆积工具结果，必须真压缩：

- 步间 `packContext` 按 v2 已定义的 priority/treatment 真正执行：保留
  required+pinned+working_set，旧 tool_result 摘要成 `conversation_summary`，低优先级
  `omitted`。产出 `lastCompactionAt`、对应 warnings。
- **修掉硬编码 200k**：`effectiveInputBudgetTokens` 必须按实际模型窗口算
  （DeepSeek 64–128k ≠ 200k），否则 `healthy` 是假的。token 估算也从「字数/2」换成
  更贴近中文/英文混排的估法（或调用 provider 的 tokenizer）。

## Preview / 续聊 / 应用

- **loop 结束**：算 `change-set = diff(draft, 真简历)`，emit 一个 preview 事件（draft 渲染 + 变更高亮）。
- **续上对话**：用户再发消息 → BFF `loadAgentSessionSnapshot`（带 draft）→ 新 loop 继续改同一 draft →
  preview 刷新。draft 跨回合持久化在 session snapshot。
- **同意应用**：BFF 校验归属后，把 change-set 的每个 `ResumeOperation` 应用到真简历（唯一写真简历处），
  应用后把 draft 基线对齐到真简历，并记一条 applied 决策。
- **回放**：能从 event log 重建 session 的 draft 与 change-set（评测/审计依赖）——需专门测试覆盖。

## 评测与调优（「后续计划就是调优 loop」的落点）

调优的前提是能量化**整条轨迹**，复用 Langfuse + event log：

- **金标准集**：每个 workflow N 个真实任务 + 评分细则（问题修了吗 / 有没有编造 /
  追问了几次 / 最终质量分 / 误改率）。
- **轨迹级指标**：任务成功率、平均步数、工具报错率、每任务 token/成本、墙钟、审批
  往返数、编造率、误删改率。
- **离线回放 harness**：把金标准集跑过 loop，用 LLM-as-judge 评质量 + 确定性检查抓
  编造/格式问题。扩展现有 `langfuse-agent-message-experiment` 到多步轨迹。
- **可调旋钮**：system/节点策略、工具描述、`MAX_STEPS` 与预算、停止条件、压缩阈值、
  模型/温度。**改一个 → 重跑评测 → 比较 → 留更好的**。
- **线上信号**：用户的 approve/reject `decisions` 已在库里——按操作类型统计**拒绝率**，
  直接驱动「该不该提议这种改动」的 prompt/策略调整。

## PoC（按 AGENTS.md：先做、过了再开 plan）

文件：`docs/superpowers/pocs/2026-06-15-agent-loop-trajectory-poc.html`（单页、可视化）。

PoC 要回答（可视地）：

- create-from-zero 一个回合内多步轨迹长什么样：reason → 调工具 → 观察 → 再决策。
- staging 工作区如何被逐步填充；护栏计数器如何走。
- 回合末两种中断（缺事实追问 / 草稿审批）的 UX。

PoC 通过判据：你看完轨迹后认可「这就是我想要的 loop 行为与回合切分」；否则改 spec
或换方案，**不开 plan**。

## 复用 JadeAI（Apache-2.0）

参考 `LingyiChen-AI/JadeAI`（Apache-2.0，可商用；借用需保留 LICENSE/NOTICE、标注改动、
attribution 到 LICENSE 里的版权人）。它是同栈（Next 16 / AI SDK v6）的真工具循环
（`streamText + tools + stopWhen: stepCountIs(25)`），但工具 `execute()` **直接写库、无审批**
——我们正好把它反过来做 per-call 审批。

借：
- `updateSection` 描述里那份**各 section 内容结构文档**，以及 JD 分析 / 语法 / 翻译的 prompt 与
  JSON 输出约束。
- 工具里的**防御性解析**（双重 JSON 恢复、字段名纠偏、null 拒绝、强制数组、补 id；它标注过 issue #69）。

不借 / 改写：
- 所有写工具的 `execute()`-直接写**真库** → 改成写 **draft**；真简历只在 loop 结束后用户「同意应用」时由 BFF 落盘。
- 它的通用 `{type,title,content}` 数据模型 → 适配到 `lib/resume-schema.ts` 的 Zod 契约 + TipTap JSON。

## 待验证（开 plan 前要落实）

- AI SDK v6 多步 API（JadeAI 已示范 `stopWhen: stepCountIs(n)`）与「工具 + 流式可见文本」如何并存
  ——对着你装的版本核实。（写工具直接写 draft，不再需要 HITL 挂起 API。）
- DeepSeek（或你选的 provider）原生 function calling 的稳定性；不稳则需结构化兜底。
- staging 写工具的 diff 形状能否 1:1 复用现有 `ResumeOperation` / `ResumeChangeSet`。

## 影响面 & DoD

预计触及：`apps/agent/src/http.ts`（执行器）、新增 `apps/agent/src/workflows/loop-runtime.ts`
与 `tools/*`、`context-status.ts`（压缩）、`resume-workspace.ts`（staging 落点）、
`session-store.ts`（中间状态映射）、对应测试。

DoD：

- create-from-zero 单回合真多步（≥3 步、含至少一次「观察后改决策」），可视轨迹与 PoC 一致。
- 写操作只写 draft；loop 结束出 change-set preview；用户「同意应用」后才由 Web 落真简历。
- loop 全程 trace；金标准集能离线回放打分。
- 从 event log 重建 session 的测试通过。
- `pnpm test / tsc / lint / build` 全绿（AGENTS.md §6）。
