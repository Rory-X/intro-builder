# Agent Note: 新旧 AG-UI 协议适配 —— 两套事件语义单位不同

Status: implemented

## Problem

P07 任务 3 要把浮窗（`floating-agent-chat.tsx`）从旧微服务入口
`/api/agent/floating/chat` 切到统一 Run 路由 `/api/ai/runs`。

核实后发现两套协议**不是改几个字段名就能对上的** —— 它们的语义单位不同：

| 旧微服务协议 | 新 Run 事件流 | 差异 |
|---|---|---|
| `text-delta` | `text.delta` | 同构 |
| `tool-call-start` / `-delta` / `-result` | `tool.started` / `tool.arguments` / `tool.succeeded` | 旧协议一个工具发多条平铺事件，新协议按生命周期分事件 |
| `approval-request` | `proposal.ready` + 决策路由 | 新协议的批准是**独立请求**（`/change-sets/:id/decisions`），**不在流里** |
| `question-request` | `run.waiting_user` | 问题在事件 payload 里 |
| `done` | `run.completed` / `failed` / `cancelled` / `interrupted` | 旧协议一个 done，新协议区分四种终态 |

直接改 `fetch` 目标会让浮窗**一个事件都不认识** —— 而那种失效表现为
「发消息后界面不动」，不报错、不崩溃。

## Decision

新增 `lib/ai-client/floating-adapter.ts`：纯函数，事件 → 浮窗动作。

### 1. 只做翻译，不做状态管理

它不持有状态、不发请求，因此可以用事件数组穷举测试（35 例）。
真正的切流改动（替换 `fetch` 目标、替换状态更新）留在组件里，
与这里解耦 —— 那部分需要人工冒烟，而这部分可以机械验证。

### 2. 批准不在流里，这是协议差异而非遗漏

旧协议的 `approval-request` 是一条例外事件，浮窗收到后在消息里挂一张确认卡。
新协议里批准走**独立的路由**（`POST /api/ai/change-sets/:id/decisions`），
流里只发 `proposal.ready`。

因此适配层对 `proposal.ready` 产出的是一个 `{ kind: "proposal", changeSetId, … }`
动作 —— **调用方据此去拉 changeSet 并渲染提案卡**，而不是期待流里
再推一条批准请求。

### 3. 工具名与结果都做收敛（实测发现的两处真实泄漏）

**`tool.succeeded` 刻意不透传 `payload.result`。**

原因：浮窗的工具卡会把 `output` 直接 `JSON.stringify` 渲染
（`formatToolPayload`）。工具结果里可能含用户简历的完整快照、内部字段名 ——
那不该出现在聊天流里。

**测试抓到过这一点**：把 `payload.result` 原样放进去后，构造的
`{ raw: "sk-secret" }` 直接出现在适配结果里。

**未知工具名置空而非回显。**

浮窗用 `titleByName[toolCall.name]` 查标题，未命中时回退到 `summary`。
但把内部工具名放进数据结构，就总有某个渲染路径会把它显示出来 ——
名称对用户没有意义，`summary` 已表达「在做什么」。

因此 `publicToolName` 只放行**已知**工具名（查表命中或有已知前缀）。

### 4. 缺关键 id 时不编造

- `run.waiting_user` 缺 `questionId` → 降级为 `{ kind: "ended", status: "waiting_user" }`，
  **不编一个 id**：编的 id 会让后续「用户回答后标记已答」找不到目标。
- `proposal.ready` 缺 `changeSetId` → 不产生动作（没有 id 就无法拉取提案）。
- `tool.started` 缺 `toolCallId` → 不产生动作（无法挂到工具卡上）。

### 5. `waiting_user` 的语义要分开表达

两个函数，因为它们是两件事：

- `isEndStatus`：真终态（completed / failed / cancelled / interrupted）。
  `waiting_user` 为 **false** —— Run 还能继续。
- `isSuccessfulEnd`：本轮是否**正常收尾**（completed / waiting_user）。
  `waiting_user` 为 **true** —— 那一轮助手确实说完了话并抛出问题。

混成一个判断会导致「等待用户」被当成「还在运行」（界面永远转圈），
或者被当成「失败」（显示红色错误）。

## Alternatives considered

- **在浮窗里内联这段翻译**（不改数据结构）— 改动集中。
  否决原因：那个文件 2511 行，且内联意味着这段映射逻辑**无法单测** ——
  要 mock 整个组件环境。而它恰恰是最容易做错的部分（协议差异、id 编造、
  原始载荷泄漏）。抽成纯函数后 35 例可以直接驱动。
- **让新路由额外发一条「批准请求」事件以兼容旧浮窗** — 浮窗改动最小。
  否决原因：那是**为了迁就调用方而在协议里加冗余**。新协议的批准走独立路由
  是刻意设计（决策需要版本绑定、可幂等、可越权校验），在流里再发一条
  会让「批准」有两个真相来源。
- **`tool.succeeded` 透传 result，靠渲染层过滤敏感字段** — 展示更丰富。
  否决原因：那是「污染源头、在下游清理」。浮窗有多条渲染路径
  （工具卡、消息详情），每条都要记得过滤。在适配层不透传是单点收口。
- **未知工具名回显**（便于排查）— 开发更方便。
  否决原因：用户看到的应该是「在做什么」，不是内部函数名。
  开发排查有日志与 tool ledger。
- **`waiting_user` 用同一个函数判断**（`isEndStatus` 返回 true）—
  代码更少。否决原因：它在两种语义下答案相反（「本轮结束」为真、
  「Run 终态」为假）。合成一个必然让某一处错。
- **`endStatusFromRunStatus("running")` 返回 running**（忠实映射）—
  更「正确」。否决原因：这个函数只在**流已结束**时被调用，
  此时服务端说「running」意味着连接断了而不是还在跑。
  返回 `interrupted` 让界面如实显示「连接中断」而不是永远转圈。

## Consequences

- **收益**：切流的协议翻译部分可机械验证（35 例）；两处真实泄漏被收口；
  「等待用户」的两种语义分离。
- **代价**：多一层适配（约 330 行）；工具名映射表与 `task-projection` 里的
  重复（刻意分开 —— 两处受众与上下文不同）。
- **已知上限**：
  - **浮窗尚未切换**。本模块提供翻译能力，但组件仍走旧入口。
    切流需要改那个 2511 行组件的 `fetch` 目标与事件分发 —— 属后续工作，
    且需要人工冒烟（浮窗/停靠、移动端、暗色）。
  - **工具参数（`tool.arguments`）的累积语义未实现**。当前每段增量
    作为 `input` 透出，但浮窗需要的是「累计后的完整参数」。
    真正的累计应由调用方做（它持有工具卡状态）。
  - **未做历史回填的一致性校验**。刷新恢复时用 `adaptRunEvents` 批量翻译，
    但浮窗的 `parts` 结构需要按 id 去重合并 —— 那部分逻辑在组件里，
    尚未实现。
- **什么信号发生时该重访**：切流后若出现「发消息后界面不动」，
  第一个怀疑对象是事件分发没换成适配层的输出（旧分支一个都不认识）。
  若用户反馈「工具卡显示了奇怪的技术名称」，检查 `publicToolName`
  的前缀白名单是否漏了新增工具。

## Verification

- `apps/web/tests/unit/ai-floating-adapter.test.ts`（35 例）：
  - **文本**：delta → text 动作、**空 delta 不产生动作**；
  - **工具生命周期**：started → running、succeeded → completed、
    failed → error（**errorText 是可操作中文且不含原始码**）、
    未识别码有兜底、**未知工具不回显内部名**、前缀能匹配具体动作、
    **缺 toolCallId 不产生动作**、arguments 增量透出、空增量无动作、
    **刻意不透传原始 result**（含泄漏断言）；
  - **提案与回执**：proposal.ready → proposal 动作、缺 id 无动作、
    **mutation.committed 是唯一驱动「已保存」的动作**、回执缺 revision 为 null、
    conflict → conflict 动作、缺 message 有默认、
    **proposal.ready 不产生 committed**；
  - **等待用户**：带出问题与 id、target → field、
    **缺 questionId 不编 id**（降级为结束）、无 question 同样降级；
  - **终态**：四种终态各自映射、**`waiting_user` 在两个判断下答案相反**、
    `endStatusFromRunStatus` 把 running 视为 interrupted；
  - **无动作事件**：attempt.started、decision.recorded 返回 null、不崩；
  - **批量**：过滤无动作事件且保留顺序、空数组、纯函数；
  - **不泄漏**：适配结果不含工具原始参数、密钥、事件 id。
- 红 → 绿：35 例中 2 例一开始失败，暴露了**两处真实泄漏**
  （透传 `payload.result`、回显未知工具名）。修正后 1 例既有断言需更新
  （它断言会带 output，与新的刻意设计冲突），改完后 35/35 通过。
- 全量：`pnpm test` 1621 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
