# P07：唯一入口切流、代码归档与现役文档更新

状态：未开始。依赖 P06 和完整能力验收；归档根[说明](../../../archive/agent-microservice/2026-09-26/README.md)。

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
