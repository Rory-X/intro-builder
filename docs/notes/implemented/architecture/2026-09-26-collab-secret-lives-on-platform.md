# Agent Note: 协作 secret 存在 PartyKit 平台，部署不再用 --var 注入

Status: implemented

## Problem

`12fcc68ad`（v0.4.2 基线）为了让协作 token 校验 fail closed，除了在 `apps/partykit/src/server.ts` 加验签，还给部署链路加了两件事：

1. `deploy-partykit.yml` 新增 `: "${COLLAB_JWT_SECRET:?Missing COLLAB_JWT_SECRET secret}"` 前置检查
2. 部署命令从 `partykit deploy` 改为 `partykit deploy --var "COLLAB_JWT_SECRET=$COLLAB_JWT_SECRET"`

这两处都从 `secrets.COLLAB_JWT_SECRET`（**GitHub Actions secret**）取值。而该 secret 从未在仓库里配置过——`gh secret list` 只有 `PARTYKIT_LOGIN`、`PARTYKIT_TOKEN`。

真正的值一直在 **PartyKit 平台侧**：`partykit env list` 输出 `Deployed variables: COLLAB_JWT_SECRET`，`partykit env pull` 可拉到 64 位 hex。也就是说部署链路被加上了一个**对平台侧已有值的重复依赖**，而这个重复依赖从未被满足。

后果的隐蔽性在于触发条件：该 workflow 的 `paths:` 要求改到 `apps/partykit/**`、`packages/shared/**` 或根级文件。`12fcc68ad` 于 2026-07-31 提交后这批改动一直积压未推，所以这条检查**从未真正执行过**。直到 2026-09-25 首次推送才暴露，表现为每次 push 都 `Missing COLLAB_JWT_SECRET secret` 失败——而失败原因与当次改动毫无关系。

### 生产实测：旧版（不验签）至今在线

上面的推理链有一个可直接验证的后果，且已实测确认：**验签代码从未部署成功过，所以生产 Worker 仍在运行 `12fcc68ad` 之前的版本**，即注释写着 "For now, extract display info from token payload without verifying signature" 的那版。

2026-09-26 对 `wss://intro-collab.rory-x.partykit.dev` 做过一次只读探测（伪造签名的 JWT，完整观测 10 秒）：

| 探测 | 观测结果 | 与旧版代码的对应 |
| --- | --- | --- |
| 伪造签名 token | 保持 OPEN，收到 `presence`，`userId` 取自**伪造 payload 的 `probe-user`** | 未验签，直接 `atob` 解码后信任 payload |
| 完全不带 token | 保持 OPEN，`userId` 为 `guest-<conn.id>` | 命中旧版 `"guest-" + conn.id` 兜底分支 |

两例都未出现 `close(4401)`，且连接持续存活。新代码在这两种输入下都必须 4401。也就是说：**在本次部署成功之前，任何知道房间号的人无需凭证即可连入协作 WebSocket**，这正是本文档要修的隐私泄漏在生产上仍处于开启状态。

这条实测也解释了为什么「回退 `--var`」不是风格选择而是必要动作：只要 CI 继续要求一个不存在的 GitHub secret，`Deploy PartyKit` 就永远失败，验签代码就永远上不了线。

## Decision

`deploy-partykit.yml` 的部署步骤恢复为裸命令，不再注入 `COLLAB_JWT_SECRET`：

```yaml
- name: Deploy PartyKit
  working-directory: apps/partykit
  env:
    PARTYKIT_LOGIN: ${{ secrets.PARTYKIT_LOGIN }}
    PARTYKIT_TOKEN: ${{ secrets.PARTYKIT_TOKEN }}
  run: pnpm exec partykit deploy
```

`Check PartyKit credentials` 只校验 `PARTYKIT_LOGIN` 与 `PARTYKIT_TOKEN` 这两个**部署凭证**。`COLLAB_JWT_SECRET` 由 PartyKit 平台持有，Worker 通过 `room.env.COLLAB_JWT_SECRET` 读取。

这是 PartyKit 官方文档记载的路径：`partykit env add <KEY>` 把 secret 存到平台，"variables will take effect only in the next deployment"，然后执行**裸** `partykit deploy` 使其生效。`--var` 的语义是"本次部署覆盖已有值"，属于可选的按次覆盖手段，不是让平台值生效的必要条件。

**安全语义不变**：fail-closed 判定位于 `apps/partykit/src/server.ts`（`!token || typeof secret !== "string" || secret.length === 0` → `close(4401)`），与本条部署链路无关。移除 `--var` 不会让缺失 secret 时放行——它只会让 Worker 回到读取平台已存的值。

## Alternatives considered

- **配置 GitHub Actions secret `COLLAB_JWT_SECRET`** — 最省事，只改配置不动代码，且能让 `--var` 路径继续工作。被否：它把同一个密钥在两个地方各存一份（平台 + CI），任一处轮换就会两端签/验不匹配，而这个失败模式是"协作静默不可用"。真正的值本就只在平台侧，CI 不需要知道它。
- **保留检查但降级为警告** — 保留 `--var` 注入意图的同时不让 CI 变红。被否：仍然要求 CI 持有密钥，只是把「失败」换成「日志里的噪音」；重复存储的问题一点没解决，还让 CI 输出更不可信。
- **`--with-vars` + 仓库内 `.env`** — 官方也支持的路径，能让部署自包含。被否：需要把生产密钥落进文件或另一个 secret，等于把「平台已持有的值」再复制一份，与上一条同因。
- **只改 workflow、不改 README 与笔记** — 改动最小。被否：`README.md` 与上一篇笔记都明确写着「通过 `--var` 传给 PartyKit」，留着会直接把下一个维护者引回这条已废路径。

## Consequences

- **收益**：PartyKit 部署不再依赖一个从未配置过的 GitHub secret；`Deploy PartyKit` 的失败信号重新只表达真实故障（凭证或代码问题），而不是「有人推了 web 改动」。
- **收益**：密钥只有一份权威副本（平台侧），Web 端 Vercel 环境变量与它对齐即可，不存在 CI 与平台两处值漂移的可能。
- **代价与已知上限**：部署链路不再显式约束 `COLLAB_JWT_SECRET` 的存在性——若平台侧被清空，CI 不会拦截，问题会以「协作连不上（4401）」的形式在运行时暴露。这是刻意的取舍：该约束由 `server.ts` 的 fail-closed 保证，且能通过 `partykit env list` 外部核对。
- **代价与已知上限**：`apps/web` 的 Vercel 环境变量必须与平台侧值**逐字节一致**，否则验签代码上线后协作会从「不安全但可用」变成「完全不可用（全部 4401）」。本笔记**未能在仓库内验证这一点**：`~/Library/Application Support/com.vercel.cli/auth.json` 里的 CLI token 已失效（`api.vercel.com` 返回 `invalidToken`），Vercel 环境变量也不在版本控制内。**部署后的第一个检查项**就是这条——见 Verification。**重访信号**：协作邀请链接无法进入、WebSocket 被 4401 关闭时，先比对 `partykit env pull` 与 Vercel 上的 `COLLAB_JWT_SECRET`。
- **重访触发条件**：平台侧 secret 需要轮换时，应同时更新平台与 Vercel 两端，再跑一次裸部署；若要恢复"CI 强制校验 secret 存在"，应改为校验**平台侧**（例如部署后跑 `partykit env list` 断言键存在），而不是再引入一个 CI 侧副本。

## Verification

- 平台侧存在性：`cd apps/partykit && pnpm exec partykit env list` → `Deployed variables: COLLAB_JWT_SECRET`；`pnpm exec partykit env pull <file>` 可拉到值（64 字符）。
- 工作流不再引用该 secret：对 `.github/workflows/deploy-partykit.yml` 解析后，`JSON.stringify(config)` 不含 `COLLAB_JWT_SECRET`；`Deploy PartyKit` 步骤的 env 仅含 `PARTYKIT_LOGIN` / `PARTYKIT_TOKEN`。
- 官方路径依据：<https://docs.partykit.io/guides/managing-environment-variables/>（`partykit env add` → 裸 `partykit deploy`；`--var` 仅作单次覆盖）。
- 相关笔记：[2026-07-31-collab-tokens-fail-closed.md](./2026-07-31-collab-tokens-fail-closed.md) 的部署侧描述已就地更新为本篇结论。
- 生产旧版行为（部署前基线，用于对照）：对 `wss://intro-collab.rory-x.partykit.dev/parties/main/<room>` 发一个签名无效的 JWT，旧版保持 OPEN 并回显伪造的 `userId`；新版必须 `close(4401)`。同一探测在部署后重跑即可判定升级是否生效。
- **部署后待办（本笔记未完成）**：确认 Vercel 上 `COLLAB_JWT_SECRET` 与 `partykit env pull` 的值一致；再按 `AGENTS.md` §6 走一遍双端手测（`pnpm dev:web` + `pnpm dev:partykit`，邀请链接进入、在线状态、批注同步）。
