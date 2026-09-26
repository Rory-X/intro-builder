# Agent Note: 从数组下标定位改为持久条目身份与封闭语义命令

Status: implemented

## Problem

Agent 提案用**数组下标**定位简历条目：`experience.0.content`。提案生成（模型调用）
与用户点击应用之间存在任意的用户操作窗口。若用户在这期间拖动排序，同一个
`experience.0` 就指向了另一条经历 —— 甲的建议被写进乙。这不是理论风险：已在
内存中用纯函数复现（规格 F03，A/B 交换后旧提案命中错误条目）。

同一根因还衍生出三个问题：

1. **无法表达前置条件**。下标地址没有「我基于哪一版内容」的概念，所以旧提案即使
   内容明显过期也照写不误。
2. **Diff 与撤销都在按下标对齐**。两条经历只交换位置时，按下标 diff 会把它们显示成
   互相全文改写；基于下标的「撤销本次修改」会误伤无关条目（规格 F09）。
3. **提交接口不存在**。旧链路是「生成操作即返回 `applied: true`」，模型以为改成功了，
   实际保存可能失败（F04）。

不做会怎样：只要 Agent 还能写文档，这个错配就会持续发生，而且**用户看不出错**——
表现是「AI 把我的第二段经历改了」，而不是报错。

## Decision

三条契约现在同时生效。

### 1. 条目携带持久 `id`，schema 层**不给默认值**

`experience` / `projects` / `education` / `research` 增加可选 `id`
（`packages/shared/src/schemas/resume-schema.ts`）。刻意**不写**
`.default(randomUUID)`：那会让每次 `parse` 都产生新身份，同一份内容在不同请求里
身份不同，比下标更糟。

- 新条目由创建方生成一次：`apps/web/lib/resume-mutations/item-id.ts`。
- 旧文档由 `initializeItemIdentities` 在 owner 开始可写会话前**确定性**补齐：
  `resumeId + section + index + contentHash` 派生，因此 CAS 失败重试算出的是同一套 ID。
  随机 ID 在重试路径上会变成「第二次修改」。
- 只读路径不写库；重复 ID 直接拒绝整个请求（数据已损坏，不该悄悄改名）。

### 2. 定位一律是白名单 `section + itemId + field`

`packages/shared/src/schemas/resume-mutation.ts` 定义封闭判别联合
（`set_field` / `insert_item` / `delete_item` / `reorder_items` /
`set_section_order` / `set_style` / `set_title` / `set_template`）。
字段名经过形状校验（拒绝 `a.b`、`__proto__`）与 per-section 白名单交叉校验；
值类型由 section+field 决定，不用 `z.any` 放行。

### 3. 每条操作携带前置条件哈希

`prepare.ts` 是纯应用器：不写库、**不信任模型给的 before 值**（提示词里的
`beforePlainText` 只作展示），before 一律由服务端从当前内容读取后哈希比对。
条件不符返回 `condition_mismatch`，绝不是「尽力而为地写进去」。

`title` / `templateId` 属于 resume **行**而不是 `content`，所以通过 `rowPatch`
单独返回 —— 塞进 content 会让「模板已换、正文未换」的半应用状态无法被发现。

旧 operation 的兼容映射在 `legacy-adapter.ts`：只在旧提案能对应到当前稳定 ID 时
才映射（同 revision 且条目未动），否则返回「内容已更新，请重新生成」，
**不从当前数组猜 ID**。

## Alternatives considered

- **继续用下标，但应用前重读并校验「下标处内容是否等于提案时的内容」** —
  这是最小改动，且能挡住 A/B 交换（因为交换后下标处内容确实变了）。否决原因：
  它把「身份」隐含在内容相等里，两条完全相同的经历（用户复制了一条并改了标题）
  会让校验通过，提案仍可能落到错的那条；而且排序操作本身无法被表达成
  「下标 i 的内容不变」——重排就是要改变下标处的值。契约需要能表达「移动」，
  下标地址做不到。
- **把 `id` 做成必填并在 schema 里 `.default(randomUUID)`** — 改动面最小，
  旧文档读进来立刻就有 ID。否决原因：`parse` 会在每次读、每次 autosave、
  每次只读渲染时产生**新的**随机 ID，写入后与浏览器内存里的又不同。
  这会制造「同一条经历身份不停变化」的静默故障，比缺 ID 更难排查。
  正确做法是「读时兼容、写前一次性补齐并持久化」。
- **用 `nanoid` / 递增计数器生成补齐 ID** — 计数器实现更简单，随机 ID 更短。
  否决原因：补齐发生在 CAS 提交里，失败重试必须算出**同一套** ID，否则重试等价于
  第二次修改；计数器在并发下还会撞号。因此选内容哈希派生。
- **不引入新命令契约，扩展现有 `ResumeOperation`** — 可以少写一层映射。
  否决原因：`ResumeOperation` 的 `fieldPath` 是自由字符串，`itemOrder` 混用下标与
  ID，没有条件字段的位置。在它上面打补丁会让「是否带条件」变成可选，
  而可选的条件校验等于没有校验。

## Consequences

- **收益**：A/B 重排后旧提案不再误改 B（已有端到端测试：映射 → 重排 → 提交）；
  过期提案一律显式冲突而不是静默写错；撤销有了可判定的前置条件
  （`inverse` 只在当前值仍等于本次 after 时才生效）；Diff 可以按 ID 对齐，
  从而把「移动」与「改写」区分开。
- **代价与已知上限**：新增一层契约与映射代码（约 3 个模块 + 3 个测试文件）。
  旧 operation 的兼容映射只覆盖「能安全对应到 ID」的情形，无法覆盖的一律降级为
  「请重新生成」——对历史聊天里的过期提案，用户会看到失效提示而非静默成功。
  P01 本身**不**提供持久 CAS，补齐 ID 的落库在 P02。
- **什么信号发生时该重访**：如果出现大量「旧提案无法映射」的用户投诉，说明兼容窗口
  太窄，需要评估是否对历史提案做一次性离线重写（而不是放宽猜测规则）。
  如果 `id` 字段被证明需要跨简历引用（例如把一段经历复制到另一份简历并保持关联），
  当前「复制即重新分配身份」的决定需要重新评估。

## Verification

- `apps/web/tests/unit/resume-item-identity.test.ts` — 读兼容、幂等补齐、
  重复 ID 拒绝、复制产生新 ID。
- `apps/web/tests/unit/resume-mutation-contract.test.ts` — 字段白名单、
  原型键拒绝、排序集合一致、样式取值域、`mutationId` 与 `expectedRevision` 必填。
- `apps/web/tests/unit/resume-mutation-prepare.test.ts` — A/B 重排、条件哈希冲突、
  条目已删、插入锚点、条件撤销、无关字段保留、旧操作映射端到端。

```bash
pnpm --filter @intro-builder/web exec vitest run \
  tests/unit/resume-item-identity.test.ts \
  tests/unit/resume-mutation-contract.test.ts \
  tests/unit/resume-mutation-prepare.test.ts
```

全部 DoD 通过：`pnpm test`（117 文件 / 737 测试）、`pnpm typecheck`、`pnpm lint`
（0 error、12 warning，与改动前基线一致）、`pnpm build`、`pnpm notes:verify`。
