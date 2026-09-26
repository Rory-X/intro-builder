# Agent Note: 客户端 revision 被校验却从未使用 —— 服务端静默用了用户没见过的内容

Status: implemented

## Problem

核实 P07 任务 3 的接线时，发现 `POST /api/ai/runs` 里 `body.revision` 的
处理有一个**真实的契约缺口**：

```ts
const revision = record.revision;
if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
  return { ok: false, status: 400, code: "invalid_revision", ... };
}
// …之后 body.revision 再无任何使用点
```

它**只被校验、从未被使用**。服务端随后直接
`loadResumeSourceForRun({ resumeId, userId })` 读 DB 当前内容喂给模型。

而 spec §6 明确要求：

> **Run 只读取与 flush 回执同一 revision 的内容；如果期间出现其他编辑，
> 取得最新基准或冲突反馈，不能悄悄用旧 snapshot。**

### 静默偏差的具体后果

客户端在 revision 3 的视图上组织上下文（对话历史、用户说「那段经历」的指代、
它提交的 `history`），而服务端可能已把 revision 9 的内容交给模型。

**模型看到的文档与用户以为的不是同一份，而没有任何一方会知道。**
用户会收到一个「针对别的版本」的修改建议，看起来却完全正常。

这类缺陷比崩溃难发现得多：没有异常、没有错误日志、测试全绿
（既有测试传的 revision 恰好与 mock 的权威值一致）。

## Decision

在创建 Run **之前**加入一致性校验：不一致则返回 **409** + `currentRevision`。

### 1. 为什么是 409 而不是「自动改用最新内容」

自动改用最新内容会让模型基于**用户没见过的文档**做修改，而用户无从察觉。
那正是 spec 禁止的「悄悄用旧 snapshot」的镜像版本（这次的「旧」在客户端一侧）。

让客户端刷新并重发是唯一诚实的选择。响应体带 `currentRevision`，
客户端可据此 rebase 后重试 —— 这与提交层冲突返回 `currentRevision` 的形状一致。

### 2. 校验必须在创建 Run 之前

顺序与 provider 构造同一理由：若先建 Run 再校验，一次陈旧请求会在库里留下一个
**永不执行的 Run** —— 而它已经拿到租约，会挡住后续对同一简历的**合法**请求，
直到租约自然过期。

用户看到的是「什么都没发生，但之后一段时间全都报已在执行中」，且无从排查。

### 3. 这与提交层的 CAS 是两层保护，缺一不可

| 层 | 拦住什么 |
|---|---|
| 路由的 revision 前置校验 | 「一开始就陈旧」（客户端 flush 后又被别的标签页/协作方改过） |
| 提交语句的 `expectedRevision` | 「执行期间被改」 |

只有提交层：模型会基于陈旧内容推理，直到提交时才失败 —— 用户白等一轮，
而且他看到的是「冲突」而非「你看到的是旧版本」。
只有路由层：执行期间（可能数十秒）的修改仍会被提交层拦，那是对的，
但路由层已经避免了「基于错误视图推理」这件事。

## Alternatives considered

- **移除 `body.revision`（既然没用到就删掉）** — 接口更干净。
  否决原因：那会把一个**契约缺口**降级成一个**功能缺失**。spec 明确要求
  这个一致性语义，删字段等于宣布不做。而且客户端本来就持有 revision
  （它要从 `mutationSession.getBaseline()` 取，flush 的前提就是它），
  传过来成本为零。
- **自动改用最新内容并继续**（更「宽容」）— 用户不会看到 409 失败。
  否决原因：模型会基于用户没见过的文档做修改。用户看到结果以为是对的，
  而它针对的是另一个版本 —— 这是最难察觉的一类错误。
- **在编排层（`orchestrateRun`）里校验** — 更靠近使用点。
  否决原因：那时 Run 已创建、租约已获取、provider 已构造 ——
  全部副作用都已发生。校验必须发生在**任何副作用之前**。
- **返回 400** — 语义上「请求有问题」。否决原因：客户端的请求本身没错，
  是**世界变了**。409（冲突）让客户端明白「重试可能成功」，
  而 400 会让它以为请求格式有问题。
- **只在提交层拦**（已有 `expectedRevision`）—— 不新增校验。
  否决原因：见上「两层保护」表。只有提交层会让模型基于陈旧内容推理一整轮，
  然后以「冲突」告终 —— 用户白等，且错误信息指向的层级不对。
- **把 `currentRevision` 放进 409 之外的错误字段** — 少一个字段。
  否决原因：客户端需要**机器可读**的当前版本号才能做 rebase。
  放在 `error` 文案里让客户端去解析中文，是脆弱的设计。

## Consequences

- **收益**：模型不再基于用户没见过的内容推理；陈旧请求在产生任何副作用
  之前被拒；客户端拿到可 rebase 的权威版本号。
- **代价**：多一次比较；客户端需要处理 409（rebase 后重试或提示刷新）。
  这属于「把静默错误变成显式错误」的正常成本。
- **已知上限**：
  - **客户端尚未处理这个 409**。`floating-run.ts` 的 `streamRun` 会把
    非 2xx 转成 `{ status: "error", code, message }`，但调用方（浮窗）
    还没接线，因此「自动 rebase 后重试」尚未实现 —— 目前会提示用户刷新。
  - **既有测试没覆盖这个缺口**（它们传的 revision 与 mock 权威值恰好一致）。
    本提交补了 4 例。
  - **Collaboration 场景的窗口仍存在**：校验与提交之间仍有数十秒。
    那由提交层的 `expectedRevision` 拦（已有），返回提交冲突。
- **什么信号发生时该重访**：若用户反馈「AI 说要改的内容我没见过」，
  先查这条校验是否被绕过（例如新增了另一条不校验 revision 的入口）。
  若要实现自动 rebase，需要在 `floating-run` 的 error 分支识别
  `revision_mismatch` 并重新拉 baseline。

## Verification

- `apps/web/tests/unit/ai-run-route-history.test.ts`（15 例，含新增 4 例）：
  - **陈旧 revision 返回 409 且带 `currentRevision`**、
    **不创建 Run、不执行、不获取租约**（陈旧请求不消耗额度）；
  - revision 一致时正常执行；
  - **客户端 revision 更新时不阻塞**（判据是「一致」而非「必须等于旧值」）；
  - **校验在创建 Run 之前**（不留下永不执行的 Run 挡住合法请求）。
- 实测验证：用探针构造「客户端 revision=5、权威 revision=9」，
  确认返回 `409 { code: "revision_mismatch", currentRevision: 9 }` ——
  在此之前该请求会**正常执行**（静默用 revision 9 的内容）。
- 全量：`pnpm test` 1742 例通过、`typecheck` 四包全绿、
  `lint` 0 error（12 warning = 基线）。
