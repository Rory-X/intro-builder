# Agent Note: panel 保留界面，执行改到 Next.js 统一 Run

Status: implemented

## Problem

侧栏 panel 仍然把请求发到 `POST /api/agent/direct-runs`，而那条路由签发 JWT，再把流指向独立 Agent 服务。
默认界面已经是浮窗，但显式打开 panel 的人仍然会打到待退役的服务。
把 panel 界面删掉能让调用点归零，但侧栏对话也会一起消失。

## Decision

panel 的界面、AG-UI 协议和五个现役文件都留下。
`POST /api/agent/direct-runs` 在 Next.js 进程里执行统一 Run（`streamRunAttempt`），
再由 `lib/ai/ag-ui-from-run.ts` 把 Run 事件翻译成 AG-UI SSE。
响应不再签 JWT，也不再返回 `streamUrl`。
客户端 `openPanelRunStream` 只请求这一跳；响应里即使带着旧服务地址也不再跟随。

写入模式是 `direct`，会话 id 为空（不写浮窗会话表），提示词版本是 `p07-panel`。
翻译出的 `TOOL_CALL_RESULT` 不带 `proposedOperations`。
落盘后发 `CUSTOM` 事件 `mutation.committed`（`mutationId`、`revision`、`changeSetId`）。
编辑器拿到回执后读服务端内容，再走已有的 `applyRemoteCommit`：有本地未保存编辑时只推进基准，不覆盖表单。

从 0 创建时，如果编辑器里已经打开一份简历，请求带上这份简历的 id 和上下文，统一 Run 直接写这份文档。
没有简历 id 时路由返回 400，代码 `resume_required`。
没有模型配置时返回 400，代码 `missing_model_config`。
同一 `runId` 再次进来，或者租约拿不到，返回 200 的 AG-UI `RUN_ERROR`，不再发起第二次模型调用。

独立服务的源码仍在 `archive/agent-microservice/2026-09-26/`。
线上容器本步不停：生产 Web 还没有跑到这次提交，退役手册要求的切流证据还没有。

## Alternatives considered

- **删掉 panel 界面，只留浮窗** — 调用点会马上归零，也不用维护 AG-UI 翻译。否决：侧栏对话要留下，去掉的是独立服务，不是界面。
- **继续两跳：Next.js 只签 JWT，流仍然打到独立服务** — 界面不用改。否决：独立服务仍然是执行位置，停容器会把 panel 打断。
- **把提案操作放进 AG-UI 结果，让客户端再 `applyOperation`** — 能留下旧的确认卡片。否决：统一 Run 已经在服务端落盘，客户端再写一次就是双重写入。
- **用批准模式，但事件里不带操作** — 看起来像还有确认。否决：没有操作就没有可确认的内容，这一轮不做半截确认。

## Consequences

- **收益**：panel 与浮窗共用同一套 Run、租约和提交。旧服务调用点余额是 0。独立服务只留归档。
- **代价与已知上限**：panel 不再展示「先确认再写入」的卡片，服务端直接落盘。用户要求分步确认时要重访这个决定。
  没有打开简历时，从 0 创建不能再生成一份新草稿。
  `token.ts` 仍导出 `signAgentToken`，但 panel 路径不再调用它。
  线上容器还在跑。生产已经是合并提交 `0ad45bb6517b`，但登录态冒烟和旧请求排空还没有证据；在那之前停容器仍然不符合退役手册。

## Verification

- `apps/web/app/api/agent/direct-runs/route.ts` 不导入 `signAgentToken`，调用 `streamRunAttempt` 与 `translateRunSseResponse`。
- `apps/web/lib/agent/direct-run-client.ts` 导出 `openPanelRunStream`，不再读 `streamUrl`。
- `apps/web/tests/unit/agent-retirement-audit.test.ts` 的调用点余额是 0；定义处清单只剩 `lib/agent/token.ts`。
- 编辑器两处 `AgentPanel` 都传入 `onServerCommit`，回调读 `runBridge.loadServerContent` 再 `applyRemoteCommit`。
- `apps/web` 单元测试 1769 通过、1 跳过；`tsc --noEmit`、`eslint`（0 error）、`next build`、`notes:verify` 通过。
- 2026-09-28 合并前，生产部署是 `199928ec39cb`，该提交的 `direct-runs` 仍签发 JWT。PR #155 合并后，GitHub Production deployment `6704188483` 的 sha 是 `0ad45bb6517b`，状态 success。`https://intro-builder.vercel.app/api/agent/direct-runs` 未登录返回 401，响应里没有 `streamUrl`；旧路由在签发前也是这个 401，所以这不是新代码的充分证据。`agent-agent-1`、`agent-redis-1`、`agent-caddy-1` 仍在跑；Caddy 只代理 `api.rory-x.me` 的 `/intro-builder/agent`；`agent_default` 仍挂着其他业务。Caddy 近 24 小时标准输出没有 HTTP 访问日志。容器、网络和卷都没有停、没有删。
