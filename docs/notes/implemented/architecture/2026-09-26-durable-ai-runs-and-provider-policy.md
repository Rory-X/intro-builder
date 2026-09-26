# Agent Note: AI Run 的持久化运行存储与 provider 出站策略

Status: implemented

## Problem

旧 Agent 链路把「一次执行」等同于「一次 HTTP 连接」：

- 进度只存在于内存与 SSE 流里，连接一断就没有任何可恢复的依据；
- 工具执行没有账本，因此**无法判断某个写操作到底做过没有** —— 恢复时要么重放
  （可能重复改简历），要么放弃（用户丢失已完成的工作）；
- 取消只是中止当前请求，平台硬杀后旧请求可能「晚到」继续写入；
- 事件顺序靠消息数组下标推断，跨实例没有全局顺序。

同时，用户自带模型服务地址（BYOK）意味着 **provider URL 是用户可控的**。不加限制地
用它发起服务端请求等于给了一个 SSRF 原语：可探测内网、读云厂商 metadata 端点。

## Decision

### 1. 三张表：Run / 工具账本 / 事件日志（`0015_add_ai_runs.sql`）

- **`ai_run`**：绑定 user/resume/session；`UNIQUE(userId, requestId)` 让重复的 start
  请求复用同一个 Run（不二次调用模型）；`leaseOwner` + `leaseExpiresAt` + `fenceToken`
  提供租约与 fencing；`status` 受 CHECK 约束为封闭集合。
- **`ai_tool_execution`**：`UNIQUE(runId, attemptId, toolCallId)`。
  刻意用**独立表**而不是把整份运行 JSON 覆盖当记录 —— 恢复时要能精确回答
  「这个 toolCallId 执行过没有」，覆盖式 JSON 在并发下不可靠。
- **`ai_run_event`**：`UNIQUE(runId, sequence)`；`sequence` 由数据库分配，
  因此跨实例天然有序。`UNIQUE(sourceEventId)` 让文档提交 outbox 的投影天然去重。

全部 additive。旧 `agent_session` / `agent_session_event` 保持只读不动。

### 2. lease 与 fencing：拦阻晚到写入

`buildAcquireLeaseStatement` 是一条**条件 UPDATE**：只有「Run 不属于终态、且当前没有
活跃租约（或已过期）」时才能改到行。两个并发 start 因此只有一个能拿到租约，
不存在「先查空闲再写入」的双持有者窗口。接管时 `fenceToken + 1`，
旧持有者的 token 随即失效。

这不只是理论：平台硬杀后旧请求可能仍在飞行。**数据库 fence 才是阻止晚到提交的保障**，
模型侧的 AbortSignal 只是节省资源。

### 3. 「不假称完成」是机械判定的

`resolveEofOutcome(lastKnownStatus, sawAttemptEndEvent)`：连接结束但没有任何结束事件
→ `interrupted`，**永远不推断成 `completed`**。终态 Run 不因 EOF 被改写。
`assertSingleAttemptEnd` 保证每个 attempt 只能落一个结束结果（不覆盖已有终态）。

### 4. 事件序号：计数器列，而不是 MAX() 或 advisory lock

给事件分配 `sequence` 试了三种做法，前两种**实测都会出错**：

1. **「先读 MAX 再插入」**（两条语句）→ 8 路并发时落败方反复重试仍耗尽次数，
   事件**直接丢失**。丢的可能是 `mutation.committed`，UI 会永远显示「未保存」。
2. **把 `MAX()` 与 `INSERT` 放进同一个 CTE** → 仍撞唯一键。原因是语句快照在加锁
   **之前**就已确定，并发语句的 `allocated` 子查询看到同一份快照，算出同一个序号。
   `FOR UPDATE` 与 `pg_advisory_xact_lock` 都救不了 —— 锁在快照取定之后才生效。
3. **`ai_run.eventSequence` 计数器列**（当前方案）：
   `UPDATE ... SET "eventSequence" = "eventSequence" + 1 RETURNING "eventSequence"`
   对同一行加行级锁并在锁内重新读取，**这才是真正的串行化点**。
   取号与插入在同一语句内完成，不会出现「取到号但插入失败」的空洞。

### 5. provider 出站策略：默认拒绝 + 如实报告上限

`validateProviderUrl` 只接受 https + 公网主机，明确拒绝：非 https、userinfo、
localhost/`.local`、私网 IPv4（10/172.16-31/192.168/127/169.254/0）、
私网与链路本地 IPv6、IPv4-mapped/兼容形式、云 metadata 端点、单标签主机名。

**同时在模块里写明剩余风险**（`describeProviderPolicyLimitation()`）：字符串层无法防御
DNS rebinding（域名先解析到公网、再改指向内网）。彻底修复需要在**实际出站传输**时
校验或固定解析结果；当前平台不具备该能力。因此文档与日志必须引用这段说明，
而不是宣称 SSRF 已消除。这是明确的已知上限，不是被忽略的问题。

### 6. provider 装配层：校验在构造之前，脱敏在抛出之前（`lib/ai/provider.ts`）

把策略真正接到 SDK 上的是装配层。它的职责刻意收窄为三件事，每件都对应一个
「不报错但行为错」的失败模式：

1. **校验必须在创建 provider 之前**。`createProviderStreamer` 先跑
   `validateProviderUrl`，不通过就返回 `{ ok: false, code }` 且**不构造** SDK 客户端。
   把校验放在构造之后，等于先造出一个可用的 `streamModel` 再补检查 ——
   任何一处提前调用都会绕过它。校验失败**返回而不抛异常**：那是用户输入问题，
   路由要把它变成 4xx，而不是冒泡成 500。
2. **错误必须脱敏**。SDK / fetch 会把目标 URL 拼进错误消息，而 BYOK 的 baseUrl
   允许带 query（有些代理用 `?key=`）。`redact()` 把 apiKey 与完整 baseUrl
   替换掉，baseUrl 只保留 `protocol//host`。否则用户密钥会流进日志与响应。
3. **预算与取消必须真的透传**。`abortSignal` 传丢 → 取消无效（数据库 fence 只拦
   提交，不拦已在跑的模型调用）；`maxSteps` 传丢 → 步数无上限，不报错只烧额度。
   两者都在这里显式绑定（`stopWhen: stepCountIs(maxSteps)`）。

另外两条设计约束：

- **构造 `streamModel` 不等于开始一次模型调用**。模型调用只发生在真正消费流的
  时候（返回的异步生成器被迭代时）。这是「打开面板/刷新页面就烧一次额度」这类
  问题的结构性防线 —— 该行为有专门的测试锁住。
- **本层不做协议解释**。SDK 的 `fullStream` 片段原样透出，翻译由 `stream-adapter`
  负责。两个转换点会让同一段流被解释两遍，迟早得出不同结论。

用生成器包裹 `streamText` 而非直接返回 `result.fullStream`：这样「同步抛出」与
「迭代中抛出」两类错误都走同一条脱敏路径（直接返回裸 stream 会绕过包装）。

## Alternatives considered

- **把运行状态存进 Redis（沿用旧微服务思路）** — 旧链路已有 Redis，复用最省事。
  否决原因：本方案的整个前提就是**退役**微服务与 Redis 依赖（规格 §3 成功标准要求
  「Redis/Agent URL 完全不可用」时新聊天/润色/保存仍然正常）。把新运行存储建在
  待销毁的组件上，等于把退役工作推倒重来。
- **把工具账本塞进 `ai_run.checkpoint` 这一个 jsonb 字段** — 少一张表，读取一次到位。
  否决原因：checkpoint 会被整体覆盖写入，而并发下「读-改-写」整个 JSON 会丢更新；
  工具账本是追加式事实记录，必须按唯一键独立插入。契约也明确首选独立表。
- **用进程内自增给事件编号** — 实现最简单，单实例下也对。否决原因：无服务器平台上
  同一 Run 的请求可能落到不同实例，内存自增会产生重号或乱序；数据库分配是唯一
  可靠的跨实例顺序来源。
- **对 provider URL 只做字符串层校验就算完成** — 挡住绝大多数误配与直接攻击，
  成本最低。否决原因：**不足以宣称安全**。因此在保留字符串层校验的同时，把
  DNS rebinding 这个真实缺口显式写进代码注释与导出函数，让调用方无法「不知道」。
  若将来需要更强保证，应改为服务端配置的 provider host 白名单。
- **取消时直接中断请求，不写数据库状态** — 足够快，且用户体验上「停止」了。
  否决原因：拦截不了晚到写入。取消必须写共享状态，让提交前的 fencing 核验看到它。

## Consequences

- **收益**：进度现在可恢复（事件日志 + 工具账本 + checkpoint）；重复 start 不重复
  调用模型；取消与平台硬杀都有明确判定；文档提交事件有去重的投影通道；
  provider 地址的明显越界用法在字符串层即被拒绝。
- **代价与已知上限**：新增三张表与一套 lease 协议，写入路径变长（每次事件都要走
  数据库分配 sequence）。`ai_run_event` 会随运行累积，需要后续的清理策略（当前未做）。
  SSRF 的 DNS rebinding 缺口未闭合，**必须**按 `describeProviderPolicyLimitation()`
  的口径表述，不得声称已消除。
- **什么信号发生时该重访**：若事件表增长到影响查询延迟，需要引入按时间的清理或归档。
  若未来能控制出站解析（例如自建代理或平台提供出站校验），应把 provider 策略升级为
  传输层校验并删除上述限制说明。

## 实测发现（下一位不要重踩）

1. **部分唯一索引上的 `ON CONFLICT` 必须复述谓词**。`ai_run_event.sourceEventId` 的
   唯一索引带 `WHERE "sourceEventId" IS NOT NULL`，写 `ON CONFLICT ("sourceEventId")`
   会抛 `42P10`（`infer_arbiter_indexes` 找不到匹配索引），正确写法是
   `ON CONFLICT ("sourceEventId") WHERE "sourceEventId" IS NOT NULL DO NOTHING`。
   报错信息只说「Failed query」，不看 `error.code` 很难定位。
2. **`new URL()` 会把 IPv4-mapped IPv6 规范化成十六进制**：`https://[::ffff:10.0.0.1]/`
   的 `hostname` 是 `[::ffff:a00:1]`。任何按点分十进制字符串匹配的私网检查都会**漏掉它**
   —— 这是一条真实存在过的绕过，内网地址可直接通过校验。必须自己把 IPv6 解析成 8 组
   整数再判定，而不是做前缀/正则匹配。
2. **本仓库测试里的 drizzle SQL 渲染器必须递归展开嵌套 `sql` 片段**。drizzle 允许把
   `sql` 片段嵌进模板，它们在 chunk 里是嵌套 SQL 对象（未被参数化）。不展开会把两种
   语义不同的语句渲染成同一段文本 —— 既会误报缺陷，也会**掩盖真实差异**
   （实测：`waiting_user` 与 `failed` 的 `finishedAt` 分支渲染结果完全相同）。
3. **嵌套 `sql` 片段作 SQL 文本时要用 `sql.raw`**；用 `sql\`now()\`` 会被参数化成占位符。
   不过在上述渲染器修好之后，普通嵌套片段本身是正确的 —— 先确认渲染器可靠，再改实现。
4. **不要把 `Date` 对象直接当 SQL 参数**：postgres.js 会抛
   `ERR_INVALID_ARG_TYPE`。统一转 ISO 字符串并显式 `::timestamptz`。
5. **不要假定驱动一定返回 `Date`**：原样查询时间列时可能拿到 ISO 字符串，
   直接调 `.getTime()` 会崩。读取层需统一归一化。
6. **编排层要可注入 executor**。`run-store` 直接 `import { db }` 会让集成测试只能
   mock `db.execute` 的返回值 —— 那就完全证明不了租约竞争、sequence 分配、
   终态唯一这些依赖真实并发的行为。`setRunStoreExecutorForTesting` 让同一套生产逻辑
   跑在隔离数据库上。
7. **`as never` 会污染 SDK 泛型推断**。装配层里写 `tools: input.tools as never`
   会让 `streamText` 的 `TOOLS` 被推成 `never`，于是 `stopWhen` 报 `TS2322`
   （`StopCondition<any>` 不能赋给 `StopCondition<never>`）。报错点在 `stopWhen`，
   根因却在 `tools` —— 容易在错误的位置反复调整。`ModelMessage` 与 `ToolSet`
   都能从 `ai` 直接导入，用真实类型即可，不需要绕过类型检查。

### 6. 工作副本：修 F02「一部分工具读空 Draft、一部分读旧摘要」

`lib/ai/workspace.ts` 定义工作副本的语义：

- **基准来自服务端权威内容**（owner 校验后的库内容），不是前端传上来的副本；
- **本轮已暂存的修改叠加在基准之上**，因此「先新增一条经历、再改它的标题」
  在同一 Run 内能读到刚新增的条目（旧实现读不到，会报「目标不存在」）；
- 按**稳定 ID** 读写；`conditionHashFor` 由服务端从工作副本重算条件哈希 ——
  **模型不能自己提供条件哈希**（它会编造）；
- 目标缺失时明确 `not_found`，绝不回退到「最近似的条目」；
- `estimateCompleteness` 返回**估算**并附免责说明（旧实现把启发式当权威指标展示）。

未被改动的是：`promoteToBase` 只在收到**服务端回执**后调用。未收到回执就提升基准，
会把「以为写成功了」变成新基准，后续修改全部基于幻觉状态。

### 7. 工具能力矩阵：注册缺失能力必须报错

`lib/ai/tools/registry.ts` 把「工具能做什么」抽成声明式矩阵，并在注册时严格校验：

- 写工具**必须**声明它能产生的语义操作种类；没有就拒绝注册 —— 这类工具不可能产出
  有效命令，注册它只会让模型认真调用后拿到无用结果（用户看到「AI 说要改但没改」）；
- 只读工具声明操作种类 = 矛盾，直接报错；
- 标记不可用**必须**给原因；不可用的工具**不注册**，而不是注册后返回 unavailable；
- `assertRequiredCapabilities` 把 33 个必需工具列成清单，缺任何一项就报错并指出缺什么；
- `TOOL_OPERATION_MAP` 显式记录「工具名 → 语义操作」的桥接。刻意不用命名约定推断 ——
  推断会在改名时静默失效。

### 8. 流适配器：参数片段只用于展示，finish 不等于完成

`lib/ai/stream-adapter.ts` 是 AI SDK `fullStream` 与业务事件之间的**唯一**转换点。
三个不变量：

- `tool-input-delta` 累积的参数**只用于展示**：它可能永远不完整，绝不据此执行；
  只有 `tool-call`（完整参数）到达后才由编排层校验并执行。
- 同一 `toolCallId` 只产生一次 `tool.started`，否则 UI 出现重复卡片。
- **`finish` 不产生结束事件**。它只表示模型这一步说完了，而工具执行与提交可能仍在进行。
  结束事件由 `finalizeAttempt` 统一给出，判据顺序是**取消 > 错误 > 等待用户 > 完成**：
  用户点了取消就不能显示「完成」。连接异常走 `finalizeOnInterrupt`，一律 `interrupted`。

推理内容（`reasoning-delta`）**不进入**业务事件流：它不面向用户，也不应被持久化。

### 9. 事件 reducer：客户端唯一投影

`lib/ai-client/reducer.ts` 把事件流投影成 UI 状态，三条铁则：

- **不虚构进度**。没有事件就没有状态变化；不按时间猜百分比。
- **模型完成 ≠ 修改已保存**。「已保存」只能由 `mutation.committed` 驱动。
- 按 `(runId, sequence)` 去重，业务成功再按 `eventId` / `mutationId` 去重；
  重复事件返回 `changed: false`，调用方**不得**产生副作用（弹 toast、写文档）。

`finalizeOnEof` 与服务端 `resolveEofOutcome` 判据一致：没有结束事件就是 `interrupted`，
避免两端对同一场景给出不同结论。

### 10. 编排层：把「模型 → 工具 → 提交 → 回执」接起来

`lib/ai/run.ts` 是接线处。它**不**直接 import `@/db` 或 AI SDK —— 模型调用、文档提交、
事件持久化全部是注入的接口。这样做的收益不只是可测：它把「什么必须在服务端做」
（提交、fencing、事件持久化）变成类型上无法绕过的东西。

关键行为与它们对应的契约要求：

- **工具结果决定事件类型**，不把所有工具硬编码成 completed。
- **提交前再核验 fencing**：工具执行前重新检查 Run 是否仍可写。取消与提交可能并发，
  只有在真正执行前核验，才能让「取消先成功则禁止提交」成立。核验失败时工具**不执行**，
  并如实记为一个被中断的结果。
- **没有回执就不算已保存**：工具声称改了文档时必须有 `mutationId` + `revision`；
  只有拿到回执才计入 `committed`、才发出 `mutation.committed`、才把修改提升为工作副本基准。
  这是规格 F04 的机械防线。
- **一个 attempt 只有一个结束事件**；收尾时**沿用实际发出过的结束类型**而不重新推断
  （见下）。
- **三种「没有显式结束事件」的情形必须区分**：
  超预算 → interrupted（不是失败，用户仍可继续）；
  取消/错误 → 按「取消优先于错误」判定；
  没有 `finish` 的正常退出 → interrupted（流被 provider 截断）。

## Verification

- 迁移与约束（真实 PostgreSQL）：`apps/web/tests/integration/harness.test.ts` 的
  「P04 运行存储的迁移」段 —— 表存在、status CHECK、requestId 幂等、
  sequence 唯一、工具账本唯一、sourceEventId 投影去重。
- 编排层行为（真实 PostgreSQL，通过 `setRunStoreExecutorForTesting` 注入隔离库，
  测的是**同一套生产逻辑**而不是 mock 返回值）：
  `apps/web/tests/integration/ai-run-store.test.ts`（22 例）——
  并发获取租约只有一方成功、过期接管且 fenceToken 递增、终态不可复活、
  **24 路并发追加事件无重号无缺口**、终态只出现一次、waiting_user/interrupted
  可继续、取消后提交被拦下、取消幂等、工具账本重试不重复记账、
  提交事件投影去重。
- 契约与策略（纯函数）：`apps/web/tests/unit/ai-run-store.test.ts`（20 例，
  含 EOF 判定、attempt 单结束、lease 全部分支、SQL 结构断言、请求哈希稳定性）、
  `apps/web/tests/unit/ai-provider-policy.test.ts`（17 例，含 8 个绕过用例与
  公网地址不误拒的反向用例）。
- provider 装配层（纯函数，10 例）：`apps/web/tests/unit/ai-provider.test.ts` ——
  合法配置可创建 provider 且**构造时不发起模型调用**；12 种非法输入
  （http、127.0.0.1、192.168.x、10.x、169.254.169.254、localhost、单标签主机名、
  含 userinfo、以及 4 种缺字段）全部在**创建 provider 之前**被拒；
  拒绝结果不含 apiKey；`abortSignal` 与 `maxSteps` 真的透传（`stopWhen` 已绑定）；
  SDK 片段原样透出不解释；SDK 抛错时 apiKey 不出现在消息里。

- 工作副本（纯函数，19 例）：`tests/unit/ai-workspace.test.ts` —— 含
  「同一轮新增后能读到」「暂存不改变基准」「目标缺失不回退」「条件哈希随暂存变化」。
- 工具能力矩阵（16 例）：`tests/unit/ai-tools.test.ts` —— 含「写工具无操作种类被拒」
  「不可用工具不注册」「必需能力缺失报错」「映射的操作种类都在封闭联合内」。
- 流适配器（24 例）：`tests/unit/ai-stream.test.ts` —— 含「参数片段不标记完整」
  「finish 不产生结束事件」「取消优先于完成」「中断不声称等待用户」。
- 事件 reducer（25 例）：`tests/unit/ai-run-reducer.test.ts` —— 含「重放零副作用」
  「模型完成不产生已保存凭据」「EOF 判定与服务端一致」。
- 编排层完整业务流（16 例）：`tests/unit/ai-run-route.test.ts` —— 含
  「工具无回执不得声称已保存」「取消后不执行工具与提交」「提案后崩溃 → failed」
  「commit 后断线保留结果」「没有 finish 的 EOF → interrupted」「超预算 → interrupted」。

```bash
pnpm --filter @intro-builder/web exec vitest run \
  tests/unit/ai-run-store.test.ts tests/unit/ai-provider-policy.test.ts \
  tests/unit/ai-workspace.test.ts tests/unit/ai-tools.test.ts \
  tests/unit/ai-stream.test.ts tests/unit/ai-run-reducer.test.ts
TEST_DATABASE_URL=<隔离测试库> pnpm --filter @intro-builder/web test:integration
```

全套 DoD 通过：`pnpm test`（128 文件 / 923 测试）、`pnpm typecheck`、`pnpm lint`
（0 error，12 warning = 改动前基线）、`pnpm build`、`pnpm notes:verify`；
集成测试 35/35。
