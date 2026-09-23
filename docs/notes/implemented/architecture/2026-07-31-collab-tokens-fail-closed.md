# Agent Note: 协作 token 缺失时 fail closed，绝不降级放行

Status: implemented

## Problem

协作批注（导师 / 协作者通过邀请链接进入）依赖 Web 与 PartyKit 两端共享 `COLLAB_JWT_SECRET` 签发与验签的 JWT。如果生产环境漏配这个 secret，最危险的行为不是「协作不可用」，而是**静默降级成「不校验也放行」**——任何拿到房间号的人都能连上 WebSocket，读到别人的简历内容。

这是隐私泄漏类风险，且不会报错、不会有人发现，属于必须由代码结构本身兜住的边界。

## Decision

PartyKit 服务端在 `onConnect` 里把「没 token」与「没配 secret」**归为同一类拒绝**，直接 `close(4401, "Unauthorized")`（`apps/partykit/src/server.ts`）：`if (!token || typeof secret !== "string" || secret.length === 0)`。验签抛错同样走 4401。也就是说 **secret 缺失时系统关闭，而不是打开**。

Web 侧签发端点（`app/api/collab/join/route.ts`、`app/api/collab/owner-token/route.ts`）同样从 `process.env.COLLAB_JWT_SECRET` 取密钥，不存在任何硬编码或默认密钥。

**部署侧必须保证该 secret 存在**：`deploy-partykit.yml` 在部署前显式检查凭证，并把 `COLLAB_JWT_SECRET` 通过 `--var` 传给 PartyKit。任何人改动这条链路时，都要保持「缺配置 = 拒绝服务」的语义。

## Alternatives considered

- **secret 缺失时回退到固定开发密钥 / 跳过验签** — 能让本地与预览环境少配一个变量、启动更顺。但它把「生产漏配」变成静默的完全开放，而这正是这条链路最不能接受的失败模式；本地体验不值得用生产隐私风险换。
- **只在 Web 侧校验，PartyKit 信任已建立的连接** — 少一处验签逻辑。但 WebSocket 连接可以在 Web 侧会话过期后继续存活，且 PartyKit 是独立部署、可被直接连入的边缘服务，把信任建立在「调用方已经验过」上等于没有服务端边界。
- **用 token 里的过期时间代替服务端 secret 校验** — 减少一次验签。但无签名的过期时间可被任意伪造，等于把授权完全交给客户端。

## Consequences

- **收益**：生产漏配 secret 的后果是「协作功能不可用」（立刻可发现），而不是「任何人都能读简历」（不可发现）。安全边界由代码结构保证，不依赖部署时的自觉。
- **代价与已知上限**：本地开发与预览环境必须显式提供 `COLLAB_JWT_SECRET`，否则协作功能直接不可用，会有「功能坏了」的困惑——这是刻意的取舍。**重访触发条件**：如果将来需要无 secret 的公开协作房间，应当新增显式的「公开房间」概念并单独设计授权，而不是放宽这条 fail-closed 判定。

## Verification

- 实现：`apps/partykit/src/server.ts`（`onConnect`）、`apps/web/app/api/collab/join/route.ts`、`apps/web/app/api/collab/owner-token/route.ts`。
- 单元测试：`apps/partykit/src/server.test.ts`（含无效 token 与缺失 secret 两类拒绝用例）、`apps/web/tests/unit/collab-owner-token-route.test.ts`。
- 回归方式：同时跑 `pnpm dev:web` 与 `pnpm dev:partykit`，确认邀请链接可进入、在线状态与批注同步正常；再故意缺省 secret 确认连接被 4401 拒绝。
