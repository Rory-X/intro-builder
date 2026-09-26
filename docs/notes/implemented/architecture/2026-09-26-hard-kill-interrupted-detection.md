# Agent Note: 平台硬杀后的 Run 用「租约过期」识别中断

Status: implemented

## Problem

平台在超时或重启时会**直接杀掉进程**。这与「客户端断开」是完全不同的场景：

| | 客户端断开 | 平台硬杀 |
|---|---|---|
| `finally` 块 | 执行 | **不执行** |
| `finishRun` | 被调用 | **不被调用** |
| AbortSignal | 触发 | **不触发** |
| 内存里的取消标志 | 有效 | **随进程消失** |

后果是 Run 会**永久停留在 `running`**：库里没有任何结束事件，租约到期后也没有
任何代码去纠正状态。UI 一直显示「执行中」，用户永远在等一个不会到来的事件。

实测确认这个缺口是真实的：`resolveEofOutcome`（专门为「EOF 该不该判中断」
写的函数）在落地时**只有单测调用点，零生产调用点**。判据写好了但没人用它。

## Decision

`markInterruptedIfLeaseExpired(runId)` 把中断识别接到读路径上。

### 判据必须两条同时成立

1. **租约已过期**（在 SQL 条件里核验）。这是「进程确实死了」的**唯一可靠信号**：
   内存标志随进程消失，AbortSignal 在硬杀时不触发，只有数据库里的租约
   能跨越进程存活。
2. **没有任何 attempt 给出过结束事件**。复用 `resolveEofOutcome` ——
   它与客户端 `finalizeOnEof` 共享同一判据，避免两端对同一场景给出不同结论
   （服务端说 interrupted、客户端说 completed）。

### SQL 条件三条缺一不可

```sql
WHERE id = ? AND status NOT IN ('completed','failed','cancelled')
  AND "cancelRequestedAt" IS NULL
  AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL
  AND "leaseExpiresAt" < now()
```

- **排除终态**：终态只能出现一次，绝不覆盖；
- **排除已取消**：用户主动取消走 `requestCancel` → `cancelled`，
  不该被这里改写成 interrupted；
- **要求已有租约**：从未开始执行（`leaseOwner IS NULL`）的 Run 不该被标记。

UPDATE 同时清空 `leaseOwner` / `leaseExpiresAt` 并写 `finishedAt` ——
否则会留下一个悬挂租约，挡住后续对该简历的合法请求。

### 挂在读路径，不引入调度器

中断只有在**有人来看**的时候才有意义，而 GET 读路径天然就是那一刻。
再建一个定时任务会引入「调度器与读路径同时改同一行」的竞争。
读路径协调**不启动模型**（只可能写一个终态），因此不违反「GET 只读」的约束。

协调后**重新读一次**：否则响应返回的是纠正前的 `running`，
客户端会继续等待一个已经不可能到来的事件。

### 两次核验「租约过期」是有意的

`getRun` 与 UPDATE 之间存在窗口，期间可能有新持有者拿到租约并开始执行。
此时把 Run 改成 interrupted 就会**杀掉一个正在执行的 Run**（它随后的提交会被
fence 拦下，用户看到「明明在跑却报失败」）。因此 SQL 里再核验一次。

## Alternatives considered

- **用定时任务扫描过期租约** — 能覆盖「没人在看」的情形，理论上更完整。
  否决原因：中断只有在有人观察时才有意义。定时任务会引入调度器这一新组件，
  以及「调度器与读路径并发改同一行」的竞争。若未来需要「用户没打开页面时
  也清理」，再加定时任务调用同一个函数即可（函数已抽成独立入口，就是为了这个）。
- **只靠 `resolveEofOutcome` 判断状态，不核验租约是否过期** — 少一次 SQL。
  否决原因：那会把**正在执行**的 Run 误判为中断。执行中的 Run 同样处于
  `running` 且尚无结束事件 —— 与硬杀后的状态在事件层面完全无法区分，
  只有租约（执行中会被 `renewLease` 续期）能区分二者。
- **读取时直接把 Run 标成 interrupted，不做二次核验** — 少一次 SQL 交互。
  否决原因：`getRun` 到 UPDATE 之间的窗口足以让新持有者拿到租约，
  此时标记就会杀掉一个正在执行的 Run。
- **给硬杀也发一个结束事件**（例如平台回调）— 语义最干净。否决原因：
  平台硬杀的定义就是「进程来不及做任何事」。任何依赖被杀进程主动上报的方案
  在硬杀场景下都不成立 —— 判据必须建立在**进程外可观测的事实**（租约）上。
- **在启动/继续路由里做这个协调** — 与「即将执行」的检查放在一起。
  否决原因：中断的发现时机与「是否要执行」无关。挂在读路径能覆盖
  「用户打开面板查看进度」这一最主要场景。

## Consequences

- **收益**：硬杀后的 Run 不再永久卡在 `running`；恢复路径（continue）能
  通过 GET 看到真实的 `interrupted` 状态并据此继续；识别判据与服务端/客户端
  共享同一个纯函数，两端结论一致。
- **代价**：每次 GET 多一次 UPDATE 尝试（条件是「不满足则 0 行」，开销很小）。
  读路径现在**可能写库** —— 这是有意的例外，已在代码注释与本节说明。
- **已知上限**：
  - 只有**有人 GET 这个 Run** 时才会识别。若用户不再打开页面，
    Run 会一直停留在 `running`（租约已过期，不阻塞其它请求，
    因此危害有限）。
  - 判据依赖租约确实被过期。若某个执行路径忘记续期（当前由
    `LEASE_TTL_MS = routeDeadlineMs * 3` 覆盖单次执行），会误判为中断。
  - 未做「同时清理 `ai_tool_execution` 里处于 started 的账目」——
    硬杀时那条记录会留在 `running`。它不影响提交正确性（提交由 fence 保护），
    但会让工具账本查询显示一个永不完成的行。
- **什么信号发生时该重访**：若出现「用户没打开页面时 Run 一直卡 running」
  的反馈，加一个定时任务调用同一个 `markInterruptedIfLeaseExpired`。
  若出现「执行中被误判中断」，先查 `LEASE_TTL_MS` 是否小于实际执行时间。

## Verification

- `apps/web/tests/unit/ai-run-interrupted-recovery.test.ts`（10 例）：
  - **SQL 条件**（用极简 SQL 渲染器断言，含嵌套片段递归展开）：
    核验 `"leaseExpiresAt" < now()`、要求 `"leaseOwner" IS NOT NULL`、
    排除三种终态、排除 `cancelRequestedAt IS NOT NULL`、
    标记时清空租约并写 `finishedAt`；取最近结束事件时**不限 attemptId**；
  - **判定分支**：`running` + 租约过期 + 无结束事件 → 标记（且第 3 条语句是 UPDATE）；
    已有结束事件 → **不发 UPDATE**（只读两次）；
    终态 → 不标记；已取消 → 不标记；Run 不存在 → 只读一次不查事件。
- 上线后发现并修复的回归：既有 `ai-run-route-api.test.ts` 的 `@/lib/ai/run-store`
  mock 未包含新导出，导致 9 例失败（vitest 报 `No "markInterruptedIfLeaseExpired"
  export is defined on the mock`）。已补齐 mock 并**显式设置默认返回值**，
  不依赖 `undefined` 的隐式假值。
- 全量：`pnpm test` 1151 例通过、`typecheck` 四包全绿、`lint` 0 error。
