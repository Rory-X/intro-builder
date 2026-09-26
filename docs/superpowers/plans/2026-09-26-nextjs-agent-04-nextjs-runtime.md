# P04：Next.js 统一 Run、工具与恢复

状态：**进行中（任务 1、3 的能力矩阵部分、5 的事件层、7 已完成；任务 2 部分完成；任务 4、6、8 未开始）**。依赖 P03。目标是服务端真正完成工具→提交→回执，保留现有浮窗布局。

## 完成记录（分批）

### 已完成：任务 1 持久化运行存储

- **落地**：迁移 `0015_add_ai_runs.sql`（`ai_run` / `ai_tool_execution` / `ai_run_event`
  三张表 + floating 表格式版本，全部 additive）；`lib/ai/events.ts`（事件契约、
  EOF 判定、attempt 单结束、lease 判定、请求哈希）；`lib/ai/run-store-sql.ts`（SQL）；
  `lib/ai/run-store.ts`（编排层，executor 可注入）。
- **验证**：`tests/integration/ai-run-store.test.ts` 22 例 + `harness.test.ts` 的
  迁移约束段 6 例，全部在**真实 PostgreSQL** 上通过；含 **24 路并发追加事件**
  无重号无缺口、租约并发竞争、终态只出现一次、取消拦截晚到提交。
  整个 P04 累计：单元 100 例（workspace/tools/stream/reducer/run/store/policy）+ 集成 22 例。

### 已完成：任务 7 的 provider 出站策略部分

- **落地**：`lib/ai/provider-policy.ts` —— 默认拒绝的 URL 校验
  （https、公网、非 metadata、非 userinfo、非私网 IPv4/IPv6 含 mapped 形式）、
  请求规模预算、`describeProviderPolicyLimitation()` 如实报告 DNS rebinding 缺口。
- **验证**：`tests/unit/ai-provider-policy.test.ts` 17 例（含 8 个绕过用例）。

### 已完成：任务 3 的能力矩阵部分 / 任务 5 的事件层 / 任务 2 的核心部件

- **`lib/ai/workspace.ts`**（工作副本，修 F02）：基准来自服务端权威内容、暂存修改叠加
  其上（同一轮新增后能读到）、按稳定 ID 读写、条件哈希由服务端重算、
  目标缺失不回退、完整性标注为估算。19 例测试。
- **`lib/ai/tools/registry.ts`**（工具能力矩阵）：写工具必须声明操作种类、
  不可用工具不注册（而不是注册后返回 unavailable）、33 个必需工具清单、
  「工具名 → 语义操作」显式映射。16 例测试。
- **`lib/ai/stream-adapter.ts`**（SDK fullStream → 业务事件）：参数片段仅用于展示、
  同一 toolCallId 只开始一次、`finish` **不**产生结束事件、
  结束判据顺序为「取消 > 错误 > 等待用户 > 完成」、中断一律 interrupted。24 例测试。
- **`lib/ai-client/reducer.ts`**（客户端唯一投影）：按 `(runId, sequence)` 与
  `eventId`/`mutationId` 去重、重复事件零副作用、模型完成不产生「已保存」凭据、
  `finalizeOnEof` 与服务端判据一致。25 例测试。
- **`lib/ai/run.ts`**（编排层，任务 2 + 4 的接线）：依赖全部注入（模型/提交/事件），
  「工具无回执不得声称已保存」「提交前核验 fencing」「一个 attempt 一个结束事件」
  「收尾沿用已发生事实」「超预算与失败分开」。16 例测试。

### 已完成（复核阶段追加）：流适配器的字段名缺陷

- **问题**：适配器读 `part.toolCallId` / `part.inputTextDelta`，但 AI SDK v6 的
  `TextStreamPart`（`fullStream` 元素类型）在**增量阶段**用的是 `id` / `delta`；
  只有定型的 `tool-call` / `tool-result` 才叫 `toolCallId`。
- **后果**：真实流下 `part.toolCallId` 恒为 `undefined`，适配器 `return []` ——
  `tool.started` 与参数片段**一个都不发出**，用户看不到工具在跑，且无异常无日志。
- **为何既有测试没拦住**：`ai-stream.test.ts` 的片段是手写的，用的正是那套错误字段名。
  测试与实现共享同一个错误假设，24 个用例因此全绿（假绿）。
- **修复**：新增 `tests/unit/ai-stream-sdk-shape.test.ts`，按 SDK 真实字段名构造片段
  （文件内 `RealSdkPart` 联合逐字抄自 SDK 声明，刻意不加索引签名兜底）；
  适配器兼容两种拼写。已核对 SDK 内部确认 `id` 即 toolCallId
  （`activeToolCallToolNames[chunk.id]`、`onInputStart({ toolCallId: chunk.id })`）。
- **验证**：红 → 4 失败 / 1 通过；绿 → 该文件 5/5，`ai-stream.test.ts` 24/24 无回归。
  全量：单元 11 文件 / 215 例，仓库 `pnpm test` 1209 例通过。
- **决策笔记**：`docs/notes/implemented/bug-fix/2026-09-26-stream-adapter-read-sdk-fields.md`。

### 已完成：任务 4 的 change-set 决策路由

- **落地**：`app/api/ai/change-sets/[changeSetId]/decisions/route.ts`。
- **守住的区分**：批准 ≠ 已保存。批准只写 `resume_decision`（绑定精确
  `proposalVersion`）；真正改文档由 `commitResumeMutation` 完成。
- **四条机械规则**：版本精确匹配（不符 409，且**校验通过前不写任何决策**）；
  **先留痕后改文档**（决策没落库就不提交）；`applied` 只认真实回执；
  冲突**不**标终态（保留 `pending` 以便重试）。
- **归属**：他人 changeSet 返回 404 而非 403（403 泄露存在性），
  与 `api/ai/runs/[runId]` 一致。
- **验证**：`tests/unit/ai-change-set-route.test.ts` 10 例（红→绿）。
- **已知上限（写入笔记）**：本路由**未传 `fence`** —— 用户的显式批准发生在 Run
  结束之后，此时租约通常已释放，强制 fence 会让正常的「批准已结束 Run 的提案」
  全部失败。因此**取消一个 Run 不阻止随后批准它遗留的提案**，这是有意取舍。
- **决策笔记**：`docs/notes/implemented/architecture/2026-09-26-approval-is-not-a-save.md`。

### 已完成：任务 2 的 provider 装配层

- **落地**：`lib/ai/provider.ts`（`createProviderStreamer`）。
- **三条边界**：校验在**构造 provider 之前**（不通过则不构造客户端，返回
  `{ ok: false, code }` 而非抛异常）；错误脱敏（apiKey 与完整 baseUrl 不入日志/响应）；
  `abortSignal` 与 `maxSteps` 真的透传（绑定为 `stopWhen: stepCountIs(...)`）。
- **两条设计约束**：构造 `streamModel` **不等于**开始一次模型调用（调用只发生在
  消费流时 —— 这是「打开面板就烧额度」的结构性防线）；本层**不做**协议解释，
  SDK 片段原样透出，翻译只由 `stream-adapter` 负责。
- **验证**：`tests/unit/ai-provider.test.ts` 10 例（红→绿），含 12 种非法输入
  在创建 provider 前被拒、拒绝结果不含 apiKey、透传与脱敏。
- **决策笔记**：既有 `2026-09-26-durable-ai-runs-and-provider-policy.md` 原地补第 6 节，
  并在「实测发现」补第 7 条（`as never` 污染 SDK 泛型，报错点在 `stopWhen`）。

### 已完成：任务 3 的工具执行层

- **落地**：`lib/ai/tools/execute.ts`（33 个工具的可执行接线）。
- **三段接线**：① 参数先按工具名取 zod schema 校验（失败即 `invalid_args`，
  不执行工具）；② 区块由**工具名推导**，不接受模型填的 `section`
  （删掉 `reorderItemsArgs.section` —— 否则工具名叫 reorderProjects、
  section 填 experience 就会静默重排错误区块）；③ 模块加载期自检
  声明 / 参数 schema / 必需清单三者一一对应，任一缺失直接抛错。
- **写工具只产出提案**：执行层不调用 `commitResumeMutation`，提交仍由编排层统一负责
  （只有那里有 run fence、幂等键与 CAS 回执）。只读工具不产生提案 ——
  特别是 `suggestSkills` 不再顺手写入 skills 区块。
- **补齐缺失实现**：此前三个 `custom` 工具（update / delete / reorder）已声明但
  无 builder，本次补上；新增 `moduleToggleArgs`（隐藏/显示只收模块名，
  不收 `visible` 布尔值 —— 工具名已表达意图，同时给布尔值是又一次矛盾机会）。
- **验证**：`tests/unit/ai-tools-execute.test.ts` 25 例（穷举 33 个工具名断言
  每个都有执行入口；越权字段被 schema 丢弃；超长文本被拒；
  `suggestSkills` 不产生提案）。第 25 例一开始失败并暴露了 `section` 错配缺陷。
- **决策笔记**：`docs/notes/implemented/architecture/2026-09-26-tool-execution-layer.md`。

### 已完成：任务 2 + 6 的启动路由

- **落地**：`app/api/ai/runs/route.ts`（唯一的执行入口）、
  `lib/ai/run-route-support.ts`（SDK 工具集 + 结束类型映射）、
  `lib/ai/resume-source.ts`（带 userId 过滤与读侧懒迁移的内容读取）、
  `lib/ai/tools/arg-schemas.ts`（工具名 → schema，拆出以免单测 mock 遮蔽）。
- **三类真实缺陷（详见决策笔记）**：
  ① 校验顺序错误会留下持有租约的孤儿 Run，挡住后续合法请求；
  ② SDK 与编排层**双重执行**工具（SDK 会自动执行带 `execute` 的工具），
  产生两份提案两套事件、其中一套绕过 fencing；
  ③ Route 文件导出辅助函数会让 `next build` 失败，而 `pnpm typecheck` **通过**
  —— 只有 build 能发现。
- **验证**：`tests/unit/ai-run-start-route.test.ts` 19 例（含 3 条回归防线：
  遍历全部注册工具断言无 `execute`、工具集字段完整、结束类型映射正确）。
  其中「配置非法不留孤儿 Run」一例一开始失败并暴露了第 ① 类缺陷。
- **决策笔记**：`docs/notes/implemented/architecture/2026-09-26-run-start-route.md`。

### 未完成（本切片剩余）

任务 4 的**直接模式落盘**（当前工具产出提案后不写库；完整提案-审批闭环在
decisions 路由）、任务 6 的 **continue 路由**（`waiting_user` 的 Run 无法恢复）、
任务 8 验证与灰度。**新链路仍未切流**。

### 实测发现（详见决策笔记）

1. sequence 分配试了三种做法，**前两种实测都会丢事件**：先读 MAX 再插入（并发下
   重试耗尽）、CTE 内 MAX + `FOR UPDATE` / advisory lock（快照在加锁前已确定）。
   最终用 `ai_run.eventSequence` 计数器列的 `UPDATE ... SET x = x+1 RETURNING x`。
2. 部分唯一索引上的 `ON CONFLICT` 必须复述谓词，否则抛 `42P10`。
3. `new URL()` 会把 IPv4-mapped IPv6 规范化成十六进制，按点分十进制匹配的私网检查
   会**漏掉它**（真实绕过）。
4. 不要把 `Date` 直接当 SQL 参数（`ERR_INVALID_ARG_TYPE`）；也不要假定驱动一定返回
   `Date`。
5. 编排层必须可注入 executor，否则集成测试只能 mock，证明不了并发行为。
6. **手写协议片段会制造假绿**：`tool-input-*` 的真实字段是 `id` / `delta`，
   不是 `toolCallId` / `inputTextDelta`。自造片段的测试与实现共享同一个错误假设，
   于是「全绿」但真实流下事件全丢。协议边界必须有「按对方真实形状」的测试，
   且该形状应逐字抄自依赖方的类型声明，而非凭印象写。

## 文件范围

现有：`apps/web/app/api/agent/floating/chat/route.ts`、`lib/agent/floating-chat-session-store.ts`、`components/agent/floating-agent-chat.tsx`、`db/schema.ts`。
拟新增：`lib/ai/{provider,run,run-store,workspace,events,tool-policy}.ts`、`lib/ai/tools/`、`lib/ai-client/{stream,reducer}.ts`、`app/api/ai/runs/` 下的启动/查询/events/cancel/continue 路由、`app/api/ai/change-sets/[id]/decisions/route.ts`、对应 migrations 与测试。导出的 server-only 模块不能进 client bundle。

## 任务

1. **建立运行与事件存储。** ai_run、ai_tool_execution、ai_run_event、结构化模型消息/步骤检查点；session 复用现有 floating 表并增加格式版本。Run 与 authenticated user/resume/session 绑定；idempotency key 唯一；lease+fencing、预算、取消状态入库。mutation outbox 以 sourceEventId 去重投影，恢复读取前协调遗漏提交事件。旧聊天可读但不自动执行旧操作。
2. **抽出 SDK 执行模块。** 保留已安装 AI SDK v6；provider/工具/存储通过清晰依赖接口注入；模型调用 `abortSignal`、明确 deadline/steps/output budget。将旧 route 的网络鉴权与执行分开，删除路由层两千行的工具实现堆积，但其原始版本先按 P07 规则快照保留。
3. **移植并修正业务工具。** 所有现有语义工具（基础信息、各经历、新增删除排序、skills/summary/awards/portfolio/custom/style、askUser、job match）有能力矩阵。工作副本从持久简历初始化，按稳定 ID 读写；同一轮新增后能读到、新增两条产生不同 ID、删除后不能再改已删目标。注册缺失能力必须报错，不能注册永远返回 unavailable 的工具。
4. **接入提交与批准。** 写工具只产生提案或返回真实 CommitResult；直接模式授权组立即提交，批准模式持久化待确认并结束本轮。批准绑定 operation IDs+proposalVersion，拒绝不会再次执行。提交 CTE 同时核验 run fencing/cancel；任何权限/持久失败都不得返回 applied=true。
5. **统一事件流。** SDK fullStream→业务事件→客户端唯一 reducer。工具开始实时发出，参数片段只用于展示、完整校验后才执行。文本批量渲染，消费流不等待 autosave。成功、冲突、失败、等待、取消和中断独立；attempt 结束事件缺失的 EOF 必须 interrupted。sequence 在 Run 内跨 attempts 单调递增，不依赖消息数组下标关联。
6. **实现恢复和取消路由。** GET snapshot/events 只读，不启动模型；continue 重建结构化工具历史与草稿，已提交操作只查询回执。关闭连接触发 abort；cancel 写共享状态并令晚到提交失效；平台硬杀按 lease 过期识别 interrupted。旧 lease 持有者不能因取消写库失败而继续提交。
7. **限流、配置与隐私。** 所有模型入口共用 ownership/限流/输入大小/并发策略；BYOK 只请求内使用。provider URL 必须拒绝非 HTTPS、userinfo、本地/私网/metadata 地址及重定向绕过；公网自定义域名解析结果要在实际出站传输验证/固定，不能只在字符串层检查。若运行平台无法实现安全出站验证，先采用服务端明确配置的 provider host 集合并报告限制，不悄悄放行。
8. **验证和小范围发布。** route/stream/reducer/实际工具注册集成测试 + 真实 DB 幂等/取消 + 总门禁；服务端开关默认 legacy，指定预览环境先跑新链路。记录首反馈、工具完成、提交、恢复延迟，未实测不得填数。提交建议按任务拆为 `feat(ai): add durable runs`、`refactor(ai): centralize Next.js tools`、`feat(ai): recover and cancel bounded runs`。

## API 的确定行为

| 路由（拟新增） | 输入 | 结果 |
| --- | --- | --- |
| POST /api/ai/runs | requestId、sessionId、resumeId、revision、message、mode、modelConfig | 单次执行 SSE；重复请求复用 Run，不二次调用模型 |
| GET /api/ai/runs/[id] | 已登录会话 | 当前状态、可展示检查点、最新 sequence；不返回 key |
| GET /api/ai/runs/[id]/events?after=n | runId、游标 | 有序事件分页；只有作者可读 |
| POST /api/ai/runs/[id]/cancel | requestId | 持久 cancel，幂等；已成功修改不回滚 |
| POST /api/ai/runs/[id]/continue | requestId、checkpointVersion、modelConfig、回答/决定引用 | 单次新 attempt；不能接管仍有效的 lease |
| POST /api/ai/change-sets/[id]/decisions | requestId、proposalVersion、accepted/rejected IDs | 决策与对应提交结果；冲突不标批准并应用 |

不要在模型 messages 内插一段「已批准」文字就跳过以上状态校验。SDK 原生 tool approval 可作协议适配，持久审批与文档幂等仍由业务模块维护。

## 测试与命令

拟新增：`ai-run-route.test.ts`、`ai-run-store.test.ts`、`ai-tools.test.ts`、`ai-stream.test.ts`、`ai-run-reducer.test.ts`、`ai-provider-policy.test.ts`。必须覆盖真实注册的工具集合，不能测试一套另写的假工具代替。

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/ai-run-route.test.ts tests/unit/ai-run-store.test.ts tests/unit/ai-tools.test.ts tests/unit/ai-stream.test.ts tests/unit/ai-run-reducer.test.ts tests/unit/ai-provider-policy.test.ts
pnpm --filter @intro-builder/web test:integration
```

加总门禁。故障用例：工具产生提案后崩溃、commit 后发送前断线、取消与 commit 竞争、同 session 两个 start、跨用户 sessionId、审批旧版、provider 超时、没有 done 的 EOF。SDK/DB 适配器可替换，业务预期固定。

## 回滚

只切回兼容 revision 的旧 UI；旧存储表保留。不得重新启用旧无幂等 apply 链路。新 Run 已存在时必须先停止/完成再变更运行开关，不能让两套运行消费同一任务。
