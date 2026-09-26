# Agent Note: 启动路由 —— 校验顺序、双重执行与「只有 build 能发现」的路由导出

Status: implemented

## Problem

`POST /api/ai/runs` 是新链路的唯一执行入口，也是 P04 里最容易「看起来成功了」的一环。
落地过程中出现三类真实缺陷，每一类的失败模式都不同：

1. **校验顺序错误会留下孤儿 Run**。第一版把 provider 构造放在创建 Run **之后**。
   后果：一次配置非法的请求已经在库里建好了 Run，而它已经拿到租约 ——
   于是会挡住后续对同一份简历的**合法**请求，直到租约自然过期。
   用户看到「什么都没发生，但之后一段时间全都报已在执行中」，且无从排查。
2. **SDK 与编排层双重执行工具**。第一版给 SDK 工具定义带了 `execute`，
   而编排层（`lib/ai/run.ts` 的 `deps.executeTool`）也执行工具。
   实测确认 SDK 行为：`streamText` 遇到带 `execute` 的工具会自己执行它
   （内部 `executeToolCall` 开头 `if (tool.execute == null) return undefined;`，
   之后 `Promise.all(... tool.execute(...))`）。于是同一次工具调用执行两遍，
   产生两份提案、两套事件，其中一套完全绕过 fencing 与事件落库。
3. **只有 `pnpm build` 能发现的 Route 导出约束**。第一版在
   `app/api/ai/runs/route.ts` 里导出了辅助函数与 `__testing`。
   `pnpm typecheck` **完全通过**，而 `next build` 报
   `"runStatusForEndType" is not a valid Route export field`。
   Next.js 的 Route 文件只允许导出 HTTP 方法与少数约定字段。

## Decision

### 1. 所有校验都在创建 Run 之前

顺序固定为：**鉴权 → 请求体形状 → 输入规模 → provider 地址策略 →
构造 provider → 简历归属 → 创建 Run → 申请租约 → 开始执行**。

生产代码里为此走查了两遍：`parseBody` 里的 `validateProviderUrl` 决定 HTTP 状态码，
`createProviderStreamer` 内部再校验一次决定「能不能构造 SDK 客户端」。
这次重复是**有意**的 —— 两处职责不同（一个管响应码，一个管是否持有可用客户端），
但都必须在创建 Run 之前完成。

### 2. SDK 工具定义不带 `execute`

`buildSdkTools()` 只给 `description` + `inputSchema`。执行由编排层唯一负责。
这条约束有**回归测试**锁住（遍历全部注册工具断言 `execute` 为 `undefined`），
因为一旦复发是静默的：不报错，只是产生两份东西。

### 3. 辅助函数移出 Route 文件

`buildSdkTools` 与 `runStatusForEndType` 移到 `lib/ai/run-route-support.ts`。
这也让它们可被单测直接导入，而不必从 Route 模块「借道导出」。

### 4. 结束类型 → Run 状态显式映射

`runStatusForEndType` 用 `switch` 而不是字符串前缀技巧。两者是不同概念
（attempt 结束 = 这次连接结束；Run 状态 = 整个任务状态），
而且 `run.waiting_user` 恰恰是「没结束、等用户回答」。关键区分：

- `run.interrupted` → `interrupted`，**不是** completed。没有结束事件的 EOF
  绝不能推断为完成，否则 UI 会对被截断的执行显示「已完成」（P04 任务 5 的硬要求）。
- `run.waiting_user` → `waiting_user`：非终态，用户可以 continue。
- 非结束类事件走到这里说明编排层违反了「一个 attempt 一个结束事件」，
  按最保守方式记为 `interrupted`，不放行。

### 5. 租约释放放在 `finally`

任何返回路径（成功、失败、客户端断开）都必须释放，否则同一简历会被一个
已结束的 Run 挡住直到租约自然过期。释放失败被吞掉：租约最终会过期，
不能因此让响应失败。

## Alternatives considered

- **保持「先建 Run 再校验 provider」的顺序** — 代码上更顺（先拿到 runId 再准备执行）。
  否决原因：孤儿 Run 会持租约并阻塞合法请求，而用户完全看不到原因。
  这类「一次失败请求导致后续一段时间全部失败」的故障排查成本极高，
  值得为它把校验全部前置。
- **给 SDK 工具提供 `execute`，去掉编排层的 `executeTool`** — 看起来更贴合 SDK 用法，
  代码更少。否决原因：执行必须经过编排层，因为只有那里有 workspace 快照、
  fence 校验与事件持久化（`emitEvent`）。让 SDK 直接执行会绕过 fencing，
  产生「已取消的 Run 仍然在写库」。P03/P04 的核心成果就是把提交与 fencing
  收敛到唯一位置，不能在工具层拆开。
- **把辅助函数留在 Route 文件但用 `export type` 规避** — 类型导出不受限。
  否决原因：`buildSdkTools` 是运行时函数，不是类型；而测试需要真实调用它。
  移到独立模块是唯一同时满足「可测试」与「Route 导出合法」的做法。
- **用字符串前缀推断 Run 状态**（如 `endType.replace("run.", "")`） —
  少写 15 行。否决原因：`attempt 结束` 与 `Run 状态` 是不同概念，
  靠命名巧合维持对应关系会在任一方的取值变化时静默错配。
  显式 `switch` 的 `default` 分支还能兜住「编排层发了非结束事件」这种违约。
- **在路由里重新推断结束语义**（例如自己看 `result.committed` 决定是否 completed）—
  否决原因：编排层的 `orchestrateRun` 已保证 `endType` 是五个结束事件之一，
  并已处理「没有 finish 片段的 EOF」。重新推断会丢掉已发生的事实
  （例如 askUser 已发出 `waiting_user` 却被改成 completed）。

## Consequences

- **收益**：非法配置不再留下孤儿 Run；工具不会被双重执行；
  被截断的执行如实报 `interrupted`；租约在任何路径下都被释放。
- **代价**：provider 地址校验出现两次（`parseBody` 与 `createProviderStreamer`），
  需要维护两处的一致性；`run-route-support.ts` 这个模块的存在本身就是
  为了绕开 Next.js 的 Route 导出限制，名字不够自解释（模块注释里已写明原因）。
- **已知上限**：
  - 本路由的 `executeTool` 在工具产出提案时返回 `proposed` 并**不落盘** ——
    P04 任务 4 的完整提案-审批闭环在 decisions 路由，这里只如实回报
    「已产出提案、尚未落盘」。因此**直接模式目前不会真的写入文档**。
    这是当前切片的已知缺口，不是缺陷：新链路尚未切流（见 P04 plan 的未完成清单）。
  - 未做 Continue 路由：`waiting_user` 的 Run 目前无法从这里恢复。
  - SSE 只推送事件，不做断线重连补齐；客户端应通过 `GET /api/ai/runs/[id]?events=1`
    续读（该路由已实现）。
- **什么信号发生时该重访**：若直接模式下用户报告「AI 说改了但内容没变」，
  那就是本路由的 `proposed` 分支需要接上 decisions 逻辑（或改为直接提交）。
  若新增了 Route 文件并导出辅助函数，`pnpm build` 会立刻失败 ——
  此时按提示把函数移到 `lib/` 下。

## Verification

- 新增 `apps/web/tests/unit/ai-run-start-route.test.ts`（19 例）：
  - **鉴权与输入**：未登录 401 且不创建 Run；缺 requestId 400；非法 JSON 400；
    消息超长 400；`revision` 非整数（4 种非法值）400；简历不属于当前用户 404；
  - **配置**：provider 非法时 400 且**不创建 Run、不申请租约**（锁住校验顺序）；
  - **幂等**：重复 `requestId` 返回既有 Run 且 `reused: true`，
    **不申请租约、不二次调用模型**；
  - **租约**：`held_by_other` / `terminal` 都 409；
  - **响应**：成功时 `Content-Type: text/event-stream`、`Cache-Control: no-cache`；
  - **收尾**：无论流是否正常结束都释放租约；空流**不**判成 completed；
  - **收敛**：`writeMode` 非 `approval` 一律收敛为 `direct`；
    `mode` 非法值收敛为 `optimize_existing`；
  - **回归防线**（3 例）：每个交给 SDK 的工具都**没有** `execute`、
    都有 `description` + `inputSchema`；结束类型映射中断正确、等待用户非终态。
- 红 → 绿：路由不存在时该文件整体失败；实现后 16 例通过；
  「模型配置非法不留孤儿 Run」一例一开始失败并暴露了校验顺序缺陷，
  修正后 19/19 通过。
- 全量：`pnpm test` 1273 例通过、`test:integration` 72/72（真实 PostgreSQL）、
  `typecheck` 四包全绿、`lint` 0 error（12 warning = 基线）、
  `build` 通过（**正是它发现了 Route 导出问题**）、`notes:verify` 24 篇通过。
