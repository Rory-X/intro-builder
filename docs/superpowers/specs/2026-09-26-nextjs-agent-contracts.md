# 实施契约附录：文档命令、运行状态、事件和迁移

状态：设计契约，未实现。与[总体规格](2026-09-26-nextjs-agent-consolidation.md)共同使用；此处给出执行时不可自行改写的具体约定。示例代码用于定义接口，不是已经存在的模块。

## 1. 标识与权威性

| 标识 | 生成/持有方 | 规则 |
| --- | --- | --- |
| resumeId | 现有 Web 创建动作 | 所有新 AI Run 必须绑定真实、已授权简历；从零创建先用既有创建动作建立空草稿 |
| itemId | 新条目创建方生成，服务端校验/持久化 | 一次生成，排序和修改不变；旧条目由 P01/P02 初始化 |
| mutationId | 发起一次逻辑提交的客户端或服务端工具 | 同一请求重试不变，新的编辑必须换 ID |
| changeSetId / proposalVersion | 服务端提案存储 | 任何提案内容变更 version 增加，旧审批无效 |
| runId | 服务端，客户端 requestId 去重后分配 | 一个用户任务；不等于一次 HTTP 连接 |
| attemptId | 服务端 | 每次启动/续做的有界执行；同 Run 多个 attempt 顺序执行 |
| toolExecutionId | 服务端，映射 attemptId + provider toolCallId | 参数哈希固定，执行记录与回执可查；不能在重试时重新生成 |
| eventId / sequence | 数据库 | eventId 去重，sequence 在单个 Run 内跨 attempts 单调递增 |
| revision | 数据库 | 每次有效文档提交加 1；CAS，不由浏览器决定新值 |

source、actorUserId、actorDisplayName、是否有权操作、run fence 均由可信服务端调用上下文确定。模型返回的 userId/source/riskLevel 都不是授权。

## 2. 文档语义命令

不暴露任意 JSONPath 写入。统一以白名单 section+itemId+field 定位，实际 operation union 建议如下：

```ts
type Section = 'basics'|'summary'|'skills'|'awards'|'portfolio'
  |'experience'|'projects'|'education'|'research'|'custom';
type Target = { section: Section; itemId?: string; field?: string };
type Condition = { expectedValueHash: string };
type SemanticOperation =
  | { id: string; kind: 'set_field'; target: Target; condition: Condition; value: unknown }
  | { id: string; kind: 'insert_item'; section: 'experience'|'projects'|'education'|'research'|'custom'; itemId: string; afterItemId: string|null; expectedOrderHash: string; value: unknown }
  | { id: string; kind: 'delete_item'; target: Target; condition: Condition }
  | { id: string; kind: 'reorder_items'; section: string; beforeIds: string[]; afterIds: string[] }
  | { id: string; kind: 'set_section_order'; before: string[]; after: string[] }
  | { id: string; kind: 'set_style'; before: unknown; patch: unknown }
  | { id: string; kind: 'set_title'; before: string; after: string }
  | { id: string; kind: 'set_template'; before: string; after: string; resetStyle: boolean };
```

示例中的 `unknown` 必须在实现用业务 Zod schema 细化；不能采用 z.any 直接放行。`section: string` 在 reorder 实现中同样收敛为数组 section 枚举。

字段表以现有 ResumeContent 为准：basics 各文本字段；experience 的 company/title/start/end/location/content；projects 的 name/role/location/start/end/stack/link/content；education 的 school/degree/major/location/start/end/gpa/highlights；research 的现有字段；custom 的 title/content；单例 TipTap 字段直接指目标。不得允许修改 ownerId/id 或任意原型属性。

新增条目必须明确新 ID 与相邻条目，不再用 `countContextSections` 决定地址。section 隐藏通过 sectionOrder 表达，不等同于删除正文；清空正文与删除条目必须显式区分。

哈希：规范化 JSON 的对象键排序，数组次序保持，文本不偷偷 trim；SHA-256，客户端值仅作预期，服务器重新计算。before/after 由服务器实际读取与纯应用得到，完整保存为可逆依据；提示词里的 beforePlainText 仅展示材料。

一组操作按有向依赖排序：插入→更新新条目，删除与更新同目标不能同时接受；重排集合必须与该组最终条目集合一致。提案部分接受按独立依赖组进行；拒绝基础操作时不能仍提交依赖它的操作。

## 3. 提交和审批接口

`commitResumeMutation(principal, command)` 是内部公开接口。principal 必须来自已验证会话或服务端持有的 Run 身份，不能来自 request JSON。

```ts
type MutationCommand = {
  mutationId: string;
  resumeId: string;
  expectedRevision: number;
  operations: SemanticOperation[];
  changeSetId?: string;
  changeSetVersion?: number;
  decisionId?: string;
};
type Receipt = {
  mutationId: string;
  revision: number;
  versionId: string;
  eventId: string;
  operationIds: string[];
  changeSetId: string|null;
  committedAt: string;
};
```

返回：committed+receipt / conflict+currentRevision+targets / rejected+code / no_change+currentRevision。HTTP 语义：401 未登录；404 无权访问的资源；409 revision/提案/幂等 payload 冲突；422 非法操作；429 限流；503 存储暂不可用。不要用 200+success:true 包装保存失败。

审批接口接受 `{requestId, proposalVersion, acceptedOperationIds, rejectedOperationIds}`。读取真实待审提案并验证授权，不能接受浏览器另传 replacementValue 来替换已展示内容。decision 记录表达「用户选择」，receipt 表达「实际应用」；用户批准但 revision 冲突时可记录决定，UI 显示「已确认，尚未保存：内容冲突」，不可写「已批准并应用」。

批准后对提案内容的任何重新生成都创建新 proposalVersion；之前的批准不会自动延伸。

## 4. 原子存储与事件源

P02 新建 `resume_mutation_event` 作为文档提交的可靠事件源（outbox），不要求新建队列服务。字段：eventId、mutationId、resumeId、runId(nullable)、type=`mutation.committed`、payload、createdAt；UNIQUE(mutationId)。正文、after 修订、mutation receipt、这条事件同一条 SQL 完成。

ai_run_event 是按 Run 排序的展示日志。P04 把 outbox 事件投影进去，`sourceEventId` 唯一。投影失败不能反过来报告文档提交失败；下一次查询/续做先协调未投影的该 Run 提交事件，再读取状态。这样不用依赖未 await 的后台任务，也不会发生文档已保存却永久丢失进度。

SQL 逻辑约束（不是可直接执行的完整 SQL）：

1. 如果属于 Run，先在同一语句内锁定 Run 行并验证 owner/resume/status/fence/lease；取消与提交由该锁确定先后顺序。取消先成功则禁止提交，提交先成功则取消保留该结果。
2. `UPDATE resume ... WHERE id/userId/revision` 做 CAS，RETURNING 新正文和新 revision。
3. 只从 RETURNING 结果插入 version、mutation receipt、outbox；相互返回 ID 形成因果链。
4. 普通新增的唯一约束冲突应让语句回滚，不能 `ON CONFLICT DO NOTHING` 后继续正文更新造成无痕提交。
5. 若 UPDATE 0 行或碰到同 mutationId 的竞争，重新用新查询读取幂等记录；同 requestHash 返回原回执，不同 hash 拒绝，否则返回当前 revision 冲突。
6. 成功后返回数据库生成的回执；任一插入失败则本语句全部回滚。

只有这里保存真实修改前后值。prompt/tool/前端都不能补写一个自称已应用的版本来替代回执。

初次开启修订的文档建立 baseline 快照，保留首次提交前的可恢复内容；新版 version 保存 after，老表行增加 legacy 标识并继续按原语义展示，禁止推断假的 revision 链。

## 5. Run / attempt 状态与事件

Run 合法转换：

```text
创建 → running(attempt 1)
running → waiting_user | interrupted | completed | failed | cancelled
waiting_user / interrupted → running(attempt n+1) 或 cancelled
completed / failed / cancelled → 不可原地复活
```

失败后重试创建新 Run，关联 parentRunId；重新生成也创建新 Run。只有 waiting_user/interrupted 可以继续旧任务。同一 Run 的 attempt 不并发；continue 请求重复返回相同 attempt，不重复调用模型。

每个 attempt 结束只产生一种结束结果；waiting_user/interrupted 是连接/attempt 结束而不是永久任务完成。Run 的 completed/failed/cancelled 为唯一最终终态。新 attempt 发 `attempt.started`，不能重置整个历史。

```ts
type RunEventEnvelope = {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  attemptId: string;
  sequence: number;
  type: string; // 实现为总体规格的封闭事件联合，加 attempt.started
  occurredAt: string;
  payload: unknown; // 每种事件分别校验
};
```

数据库分配 sequence，不用客户端数组长度或内存自增代替跨实例顺序。文本批次也是事件，未持久批次不分配可重放 sequence。UI 以 `(runId,sequence)` 去重，业务成功额外以 eventId/mutationId 去重。

工具账本（可存在 ai_run checkpoint 的受控结构或独立表，P04 固定后不可两份真源）：toolExecutionId、toolCallId、inputHash、status、proposalId、mutationId、result。**首选独立 ai_tool_execution 表**，唯一(runId,attemptId,toolCallId)；不把整份运行 JSON 覆盖当并发安全记录。完成工具的结果在模型继续下一步前持久化。

恢复时：读取 checkpoint + 已完成工具账本 + mutation receipts；成功写操作不重放，只补 tool result。半截参数不能执行；没有结果的旧调用补「本次尝试中断且未执行」结果或从干净步骤续起，确保 SDK 模型消息不存在悬空 tool call。

lease 续期失败立即停止新工具与写入；取消需写共享状态，模型 AbortSignal 是节省资源的机制，数据库 fence 才是阻止晚到提交的保障。凭据不进 checkpoint。

## 6. UI 与编辑器协调

- 启动 AI 前 flush 本地 dirty 请求；失败则不开始 AI 写任务，保留输入。
- Run 只读取与 flush 回执同一 revision 的内容；如果期间出现其他编辑，取得最新基准或冲突反馈，不能悄悄用旧 snapshot。
- AI 服务端提交的 receipt 更新编辑器基准；禁止把这次应用当手动输入再次 autosave。
- receipt 到达前用户已继续编辑：只确认旧 generation，基于 stable IDs 保留新 dirty patch。同字段冲突保留本地输入并提示，不强制 reset。
- 本地输入与 AI 若修改不相交字段，初版可以提示重试并安全 rebase；不能采取最后写入整份覆盖。
- 取消任务保留已提交结果，停止未提交部分；撤销是另一条明确操作。

## 7. 路由与能力去向矩阵

| 当前入口 | 最终处理 | 需要保留的能力 |
| --- | --- | --- |
| /api/agent/floating/chat | 原实现归档，UI 切 /api/ai/runs；过渡 adapter 同样调用新模块 | 聊天、语义工具、两模式 |
| /api/agent/floating/sessions/* | 可保留兼容路径，唯一 session store，补 Run 关联 | 旧历史、标题、删除/读权限 |
| /api/agent/floating/models | 可保留，移用统一 provider policy | 模型连接与列表 |
| /api/agent/rich-text/polish | 路径暂保留，内部改 Web SDK | TipTap 结构、候选、局部应用留痕 |
| /api/agent/resume/helpers/* | 路径暂保留，内部改 Web SDK | 全文诊断、模块下一步建议 |
| /api/agent/direct-runs | 原实现归档；短期新 stub 返回 410 | 不再签发微服务访问凭证 |
| /api/agent/messages、/session | 原微服务桥接归档；必要 stub 410 | 调用方清零后删除现役 stub |
| /api/agent/sessions | 旧 AG-UI 会话只读兼容或归档后不暴露；不可与 floating 混写 | 旧数据不删除、不执行旧提案 |
| apps/agent /v1/* | 完全退出在线 | 有价值的 pure capability 先移植验证 |

从零创建复用现有 dashboard/editor 新建空简历动作，随后执行普通 resumeId Run；不再维持另一个 resumeId=null 的旧微服务长循环。旧 null 会话保留可读材料，不在迁移时自动创建大量简历。

## 8. 发布迁移细则

1. 新 schema 向后兼容，首次 ID 初始化不改变文案。所有现役 writer 在启用新 Agent 前已改为 revision-aware。
2. server gate 阻止旧客户端无 revision 写入；可返回需刷新。不得为了兼容旧页面而覆盖新 ID。
3. 保留旧聊天 parts、版本和 session；新增 formatVersion，读侧 adapter 保持展示，不伪造历史 tool results。
4. P07 移动源码前保留最初基线+实际退役版本；现役依赖删除须先确认零引用。
5. 生产数据库变更不执行反向 drop；出问题关闭新 AI 写操作，手工写仍走安全提交模块。

## 9. 单元、集成、真实模型各自证明什么

单元测试证明纯应用、冲突判断、事件 reducer、prompt 装配等确定性行为。隔离数据库集成证明事务回滚、CAS 并发、lease/fence、幂等与唯一性。真实模型评测证明建议可用性和任务遵循。人工冒烟证明渲染、定位、输入和主题交互。四者不能相互冒充。
