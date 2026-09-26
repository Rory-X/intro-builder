# Agent Note: 退役零消费方的 `/api/agent/sessions`

Status: implemented

## Problem

P07 任务 4 要把 `apps/web/lib/agent/session-store.ts` 移进归档（它被清单收录，
理由是「旧会话模型；新实现改用 `ai_run` 的 `sessionId`」）。

执行前的核实发现：**那个 store 仍有一个现役消费者** ——
`apps/web/app/api/agent/sessions/route.ts` 实际调用它的
`listAgentSessions` / `deleteAgentSession` / `renameAgentSession`。

直接按清单移动会留下断裂的 import。所以必须先处理路由。

## Decision

把 `/api/agent/sessions` 退役为 **410 Gone**（复用既有的
`retiredAgentRouteResponse` 模式），替代入口写进响应体。

### 两条独立证据说明它可以下线

1. **路由零消费方**。全树搜索没有任何客户端或服务端代码调用它 ——
   连它唯一的「界面消费者」`components/agent/agent-session-selector.tsx`
   自己也没被任何地方渲染（它只 `import type` 了列表项类型）。
   也就是说：这是「只被测试调用」的路径。
2. **模型已被替代**。统一 Run 路由（P04）改用 `ai_run` 的 `sessionId`
   作为会话维度 —— 会话归属在创建 Run 时随行落库
   （`sessionId: body.sessionId`），不再需要一张独立的会话表。

### 替代入口

- 浮窗会话列表与历史消息：`/api/agent/floating/sessions` 与
  `/api/agent/floating/sessions/[sessionId]`（浮窗一直用它，**仍是现役**）；
- Run 级会话归属：`POST /api/ai/runs` 的 `sessionId` + 事件回放。

### 为什么不重定向到旧服务

plan 明确禁止。重定向会让「旧服务无请求」这个退役信号一直达不到 ——
而那是 P08 决定能否下线服务器的依据。

### 为什么顺带把它从审计清单里移除

退役审计的 `WEB_NATIVE_ROUTES` 原本列着这条路由（标为「会话列表（Web 自足）」）。
退役后它不再是「Web 自足能力」而是退役 stub ——
留在清单里会让「这些路由都不含旧服务调用」这条断言名不副实
（它确实仍为真，但断言的对象已经不是它想描述的东西了）。

## Alternatives considered

- **直接移动 `session-store.ts`，不改路由**（按清单字面执行）—
  改动最小、最贴合清单。否决原因：会留下断裂的 import，
  而 `pnpm typecheck` 会立刻失败。清单是**当初写下的假设**，
  执行时必须验证它，而不是照搬。
- **先把路由改成删除、再移动 store**（一次提交）— 少一次提交。
  否决原因：退役路由是**行为变更**（410 是有意的对外信号），
  移动文件是**结构调整**。混在一起会让「为什么这个 API 变了」
  在 diff 里被大量文件重命名淹没。
- **保留 `session-store.ts` 不归档**（因为它并非微服务代码，0 处微服务引用）—
  否决原因：它服务的会话模型**已被 `ai_run.sessionId` 替代**，
  留着会让人以为还有两条会话模型并存。归档它、并在归档 README 里
  写明替代入口，才是诚实的做法。
- **让路由返回 404**（更常见的「没这个接口」）— 否决原因：
  404 无法区分「路径写错了」与「功能已下线」，调用方会去查拼写，
  而真实原因是版本过期。410 的语义正是「这里曾经有东西，现在永久没有了」。
- **删掉测试 `agent-session-store.test.ts`** — 否决原因：那个测试验证的是
  store 自身的归约逻辑（`reduceAgentSessionSnapshot` 等），
  在 store 被归档前仍是有意义的覆盖；归档时应随 store 一起移入归档目录，
  而不是删除（plan 要求「旧实现不是只存在于 Git 历史」）。

## Consequences

- **收益**：清掉了 P07 任务 4 的一个前置阻塞（store 的现役消费者）；
  旧会话模型的两个入口（路由 + 未来的 store）进入一致的退役状态；
  审计清单不再包含一条名不副实的条目。
- **代价**：少一个 API 端点（它的消费者的数量是 0，因此实际可用性无变化）。
- **已知上限**：
  - **`agent-session-selector.tsx` 与 `session-store.ts` 本身仍是现役文件**。
    本提交只退役了它们的**唯一消费者**。两者要留到 `git mv` 归档步骤
    一起移动（那时 `agent-session-store.test.ts` 也应一起走）。
  - **未做真实请求验证**：410 的形状由既有 `retiredAgentRouteResponse`
    保证（已有测试覆盖那个模式），但没有对新路由发一次真实请求确认。
  - **清单（`MANIFEST.json`）尚未更新**：它仍列着 `session-store.ts`
    却漏了这条路由与 selector —— 那是下一步要做的事。
- **什么信号发生时该重访**：若线上出现 `410 route_retired` 且 `retiredRoute`
  是 `/api/agent/sessions`，说明还有未升级的旧客户端在用这条路径 ——
  那时应当先确认它的来源，而不是恢复路由。

## Verification

- `apps/web/tests/unit/agent-retirement-audit.test.ts`（25 例中的一部分）：
  清单移除后仍通过（该路由不再被要求「无旧服务调用」）。
- `apps/web/tests/unit/agent-session-store.test.ts` 仍通过 ——
  store 自身的归约逻辑未改动（它随归档步骤一起移动）。
- `pnpm typecheck` 四包全绿（确认没有残留的 import 断裂）。
