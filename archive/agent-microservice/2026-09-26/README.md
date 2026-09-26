# Agent 微服务归档预留区

状态：**规划中；当前只有本说明，旧源码尚未移入，线上服务尚未退役。**

用户于 2026-09-26 决定让 Next.js + Vercel AI SDK 成为唯一在线 AI 执行入口。独立 Agent 服务及部署路线退出线上，旧实现保留在本目录用于考古、验证与受控复用。

- [完整规格](../../../docs/superpowers/specs/2026-09-26-nextjs-agent-consolidation.md)
- [执行入口](../../../docs/superpowers/plans/2026-09-26-nextjs-agent-execution.md)
- [归档实施](../../../docs/superpowers/plans/2026-09-26-nextjs-agent-07-cutover-archive.md)
- [线上退役手册](../../../docs/superpowers/runbooks/2026-09-26-agent-service-retirement.md)

## 为什么归档

旧面板走浏览器直连 Agent/AG-UI，悬浮助手走 Next.js/AI SDK，两套工具和会话难以保持同样的写入、取消和恢复语义。用户已明确选择 Next.js 方案。归档保留历史取舍和回退经验，不把旧代码当默认实现，也不删除历史证据。

## 拟收录结构

```text
README.md                  # 状态、原因、替代方案和恢复边界
MANIFEST.json              # 执行归档时生成；路径、blob、SHA-256、基线
RETIREMENT.md               # 实际退役后填写，不能预写完成
source/apps/agent/         # 源码、测试、fixtures、部署配置
source/apps/web/           # 旧 AG-UI UI、直连桥接、JWT/client、专用测试
source/.github/workflows/  # 旧 workflow，仅作文本存档
source/docs/agent/         # 历史架构、开发、运维文档快照
baseline/                  # 当时 package/workspace/lock/config，可核查依赖
```

此树为规划，未创建的文件不代表已归档。归档时从固定基线 `050d5bb5e` 取得历史原文；退役前若有修补，另外记录实际退役 HEAD 与差异。不能拿当前已改写的新 route 当旧源码归档。

## 文件去向规则

| 内容 | 处理 |
| --- | --- |
| apps/agent 的 tracked 源码、测试、eval、Dockerfile/compose/Caddy | 移入 source 原路径，逐文件校验 |
| 旧 AgentPanel/AG-UI runtime/direct client/token/微服务 BFF | 保留原文后从现役依赖图退出 |
| 仍复用的确认卡、TipTap 转换、业务纯函数 | 留现役，经新契约适配；旧版必要时保存快照 |
| deploy-agent workflow | 移出 .github/workflows，存入 source/.github/workflows；不能自动执行 |
| package/workspace/lockfile | 保存基线副本以解释原依赖；现役 lockfile 正常更新 |
| 旧 DB 数据/表 | 不存 Git；旧表保留只读，数据保留策略另记 |
| 私钥、真实 env、provider key、用户简历、Redis dump | 严禁归档到仓库 |
| 历史设计/decision | 原文保留，记录与新决定的关系 |

## 不参与在线运行

本目录不得加入 pnpm workspace，不从现役源码 import，不被 Next 路由发现、CI 测试/构建或 Docker 镜像构建识别为活跃应用。不要在此运行历史 install/deploy 脚本来恢复生产。

manifest 至少包含 baselineCommit、retirementCommit、originalPath、archivePath、gitBlob、sha256、归档原因。缺一份 tracked 源文件即未完成。归档目录下不得出现新功能开发。

## 历史限制与替代实现

旧代码包含空 Draft 读取、未连接润色工具、按位置修改、客户端补版本、双会话来源等已知限制，不能照搬到新路线。新的权威实现将位于 `apps/web/lib/ai/` 和 `apps/web/lib/resume-mutations/`，以实际 P04/P07 合并后的路径为准。

完整恢复需要核验新的文档版本协议、平台凭据、保留卷、镜像 digest 和路由归属。没有兼容性验证，不恢复旧 writer 或自动部署。线上清理记录与保留资源应在 P08 执行后追加到 RETIREMENT.md。
