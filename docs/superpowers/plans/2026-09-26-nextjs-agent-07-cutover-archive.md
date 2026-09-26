# P07：唯一入口切流、代码归档与现役文档更新

状态：进行中（任务 3 的**前置能力**已完成：客户端消费器、多轮历史、
新旧协议适配；**浮窗尚未切换**，归档未开始）。依赖 P06 和完整能力验收；
归档根[说明](../../../archive/agent-microservice/2026-09-26/README.md)。

## 完成记录（分批）

### 已完成：切流的前置能力

切流前核实新路由，发现它虽然服务端契约完整（P04 交付），但
**没有任何客户端消费方** —— 浮窗仍走旧的 `/api/agent/floating/chat`，
全仓库搜索 `/api/ai/runs` 只命中路由文件自身。因此补了三块前置：

- **客户端消费器**（`lib/ai-client/run-stream.ts`，25 例）：
  `streamRun` / `consumeRunStream` / `resumeRun`。
  两个关键分支：`POST /api/ai/runs` 在幂等命中时返回 **JSON 而非 SSE**
  （统一按 SSE 解析会让那条路径拿不到任何事件、界面像「模型没响应」）；
  SSE 分帧必须同时认 `\n\n` 与 `\r\n\r\n`
  （第一版只认前者，CRLF 流一个事件都解析不出来且不报错）。
  笔记：`docs/notes/implemented/architecture/2026-09-26-run-stream-client.md`。
- **多轮历史**（`lib/ai/run-history.ts` + 两处修复，30 例）：
  路由曾**校验 `history` 长度却把它丢掉**、然后硬编码 `history: []` ——
  切流后每轮都会失忆。同时客户端消费器也没传 history（服务端的修复不生效）。
  笔记：`docs/notes/implemented/bug-fix/2026-09-26-run-history-was-discarded.md`、
  `docs/notes/implemented/feature/2026-09-26-run-stream-sends-history.md`。
- **新旧协议适配**（`lib/ai-client/floating-adapter.ts`，35 例）：
  两套协议的**语义单位不同**（旧 `tool-call-*` 三阶段 vs 新 `tool.*` 生命周期；
  旧 `approval-request` vs 新 `proposal.ready` + 独立决策路由；
  旧 `done` vs 新四种终态）。适配层是纯函数，事件 → 浮窗动作。
  实测修复两处真实泄漏（透传工具原始 result、回显未知工具名）。
  笔记：`docs/notes/implemented/architecture/2026-09-26-floating-protocol-adapter.md`。

### 未完成（本切片剩余）

- **任务 3 的组件切换本身**：`floating-agent-chat.tsx`（2511 行）仍走旧入口。
  需要用 `streamRun` 替换 `fetch` 目标、用 `adaptRunEventToAction` 替换
  旧协议解析、用 `restoreWorkspace` 做刷新恢复。**需要人工冒烟**
  （浮窗/停靠、移动端、暗色、键盘）。
- **任务 1、2、4、5、6、7**：归档基线与清单、能力矩阵、移出源代码与部署配置、
  收敛构建与依赖、更新事实文档、发布与观察。

## 文件范围

归档现有 `apps/agent/`、`.github/workflows/deploy-agent.yml`、旧 Web AG-UI panel/runtime/direct-run/JWT/client 桥接及专用测试；修改根 scripts、workspace、lockfile、`scripts/ci/affected-apps.ts` 与对应测试、现役 docs/agent、README、AGENTS、Web 入口选择。PartyKit 继续现役。

## 任务

1. **建立归档基线与清单。** 原始基线固定 `050d5bb5e`，同时记录实际退役前 HEAD；如果其后旧实现有改动，分别保留基线与退役版本的差异或第二快照，不能覆盖历史。每个文件记录 originalPath、archivePath、git blob、SHA-256；只收 tracked 源码/示例配置，不收真实 .env、node_modules、dist、私钥和用户数据。
2. **完成能力矩阵。** 聊天/模型连接/润色/诊断/模块建议/创建空简历/导出前检查/版本历史都已 Web 化。预览环境完全不配置 Agent URL/JWT/Redis 仍可使用；删除请求 fallback，不以旧服务兜底掩盖缺能力。
3. **切换唯一 UI 与协议。** 以 FloatingAgentChat 的浮窗/停靠为入口；归档旧 AgentPanel、AG-UI runtime、selector、direct-runs、messages/session 桥接。旧公开 API 可短期返回明确 410/客户端升级提示，不能重定向到旧服务；仅复用仍有用途的确认卡、润色转换等，不按文件名前缀全部搬走。
4. **移出实际源代码和部署配置。** `git mv` 进入归档保留对应结构；新代码如果替换旧 route，则先将旧版内容按基线快照归档。部署 YAML 在 `.github/workflows` 外存放，README 写明不可自动执行。归档目录 manifest 校验成功后再移除现役 import。
5. **收敛构建与依赖。** workspace 不含 archive；根 dev/build 不启动 Agent；去掉 build:agent/dev:agent；affected-apps 保留 Web/PartyKit 的准确触发规则并更新测试。Web 删除只为 AG-UI/旧面板服务的依赖，保留仍用于 Markdown 展示的包直到引用清零。记录 lockfile 变化；不要运行 pnpm install 后把无关升级混进来。
6. **更新事实文档与决策。** 现役 docs/agent、AGENTS、README 说明 Next.js 路线、正确命令和 CI 已有 build。新增 Note 从 proposed 转 implemented，旧决定保持原文并用 notes 归档工具封存与互链；历史 superpowers 文档保留并加导航说明。归档 README 写明替代入口、旧缺陷、依赖版本、恢复条件。
7. **发布与观察。** 全套 DoD、隔离事务测试、prompt 评测、必要人工冒烟通过后开 PR；验证新生产部署，旧微服务暂保留但无请求。记录实际 deploymentId/commit、能力验证结果与旧入口请求情况；P08 才清理服务器。

## 查漏范围

```bash
rg -n 'AGENT_BASE_URL|AGENT_PUBLIC_BASE_URL|NEXT_PUBLIC_AGENT_BASE_URL|signAgentToken|fetchDirectAgentRunStream|createAgentClient|AgentPanel' apps/web packages scripts .github
rg -n 'apps/agent|build:agent|dev:agent|deploy-agent' package.json pnpm-workspace.yaml .github scripts
rg -n '@ag-ui|react-ag-ui' apps/web/package.json apps/web/app apps/web/components apps/web/lib
```

预期：没有可达的旧业务调用、构建或部署引用。允许的文档、退役测试字符串要逐条解释，不能简单追求全文 0 命中而删历史。另做静态依赖检查，确保新在线代码没有 import archive。

## 验收与回滚

- manifest 文件数和逐文件 hash 完整；旧实现不是只存在于 Git 历史。
- Next build route manifest 不再暴露可运行旧桥接；旧 API 410 是新明确 stub，旧实现已归档。
- `pnpm -r list --depth -1` 不含 archive 项目或现役 Agent 包。
- `pnpm test/typecheck/lint/build/notes:verify` 全通过；CI Web/PartyKit 不因归档失效。
- 生产回滚不得指向无法保留 stable ID/revision 的旧版本；必要时关闭 AI、保持手动编辑，比恢复旧无幂等 writer 安全。

提交拆分建议：先 `refactor(ai): use Next.js as the sole runtime`，后 `chore(ai): archive retired service and deployment code`。每个提交都能运行、都有对应 Note 和验证。
