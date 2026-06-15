# PR: feat(agent): real multi-step tool loop for create-from-zero (behind `AGENT_LOOP_ENABLED`)

> 用法：`gh pr create --base main --head codex/agent-loop-execution --title "feat(agent): real multi-step tool loop for create-from-zero (behind AGENT_LOOP_ENABLED)" --body-file docs/superpowers/pr-2026-06-15-agent-loop-execution.md`

## Summary

把 create-from-zero 的执行器从「单次结构化生成」升级为**真 AI SDK 多步工具循环**：loop 全自主跑、工具调用全程可见、所有写操作只进 **draft**，loop 结束按 `diff(draft, 真简历)` 出 change-set 预览；用户可续上对话继续改 draft，或同意应用（draft→真简历，由 Web 落盘）。**整套行为在 `AGENT_LOOP_ENABLED` 开关后面，默认关闭**——合入 main 对线上零影响，可"暗合入"。

- 设计：`docs/superpowers/specs/2026-06-15-agent-loop-execution-design.md`
- 计划：`docs/superpowers/plans/2026-06-15-agent-loop-execution.md`
- 复用上游提示词结构：LingyiChen-AI/JadeAI（Apache-2.0，已注明）

## What's in this PR（Task 1–6，11 commits）

- **Loop 执行器**（`apps/agent/src/workflows/loop-runtime.ts`）：`streamText` + `tools` + `stopWhen(stepCountIs(16))`，边跑边流式可见文本。
- **工具集**（`apps/agent/src/workflows/tools.ts`）：read 自动执行、write 只改 draft。
- **Draft 模型 + change-set diff**（`apps/agent/src/workflows/draft.ts`）：tiptap 字段自动产出 `replacementTiptapJson`；护栏 `MAX_DRAFT_OPERATIONS=24`。
- **接线**（`apps/agent/src/http.ts`）：create-from-zero 在 `AGENT_LOOP_ENABLED` 开时走 loop；loop 经 `experimental_telemetry` 接 Langfuse。
- **工具卡 UI**（`apps/web/components/agent/agent-tool-card.tsx`）：动作 chip + 目标字段 + 「已写入草稿」。
- **应用/续聊**：`apps/web/lib/agent/apply-operation.ts`（纯函数：`insert_section` 创建缺失数组项并补 `sectionOrder`）+ `editor-client.tsx` 委托它；`rehydrateDraft` 支持续聊。

## Test evidence（CI 前本地）

- agent：`tsc` clean，**169 tests** 全绿
- web：改动文件 `tsc` 无报错、`eslint` 0 error；新增 `apply-operation` 8 tests；web agent-* 测试组 57 passed / 1 skipped
- ⚠️ 本机仍需补：`pnpm build` 全量 + 手工冒烟（见 checklist）

---

## 部署 Checklist

### A. 合入前（PR 阶段）
- [ ] CI 绿：`pnpm test` / `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build`（AGENTS.md §6）
- [ ] 确认本 PR **不含** 无关的 marketing/landing 改动（工作区里那几个 `apps/web/(marketing)` 脏文件不要带进来）
- [ ] Review 设计/计划链接已附；`AGENT_LOOP_ENABLED` 默认 `false` 已确认

### B. 数据库（持久化/续聊的前置）
- [ ] 在生产库确认 `agent_session` 与 `agent_session_event` 两张表**已存在**（迁移 `0011_add_agent_sessions`，已登记进 `_journal.json`）；跑 `drizzle-kit migrate`（或你们的迁移脚本）并核对
- [ ] 验证：跑一次 loop 后 `agent_session_event` 有新行（否则续聊/应用会静默失败——路由对持久化异常是 catch 后只记日志）

### C. Agent 服务（自托管，apps/agent）
- [ ] 设 `AGENT_MODEL_BASE_URL` / `AGENT_MODEL_API_KEY` / `AGENT_MODEL_NAME`
- [ ] 确认所选 provider/model **原生 function calling 稳定**（DeepSeek 等）——loop 依赖它；不稳时模型不调工具会直接收尾
- [ ] 置 `AGENT_LOOP_ENABLED=true`（仅此开关打开真 loop）
- [ ]（可选 trace）设 `LANGFUSE_TRACING_ENABLED=true` + `LANGFUSE_PUBLIC_KEY/SECRET_KEY`，确认 loop 的 `experimental_telemetry` span 进 Langfuse
- [ ] 部署镜像：push main 触发 `deploy-agent.yml`（GHCR）或服务器 `docker compose pull && up -d`
- [ ] `/health`、`/ready` 返回 200

### D. Web BFF（Vercel）
- [ ] 注意：agent 面板经 `/api/agent/runs` **代理**长 SSE，该路由 `maxDuration=120` ⇒ **需 Vercel Pro**（Hobby 上限 60s 会截断）
- [ ] 评估：单轮 create-from-zero loop 可能 >120s → 要么调大/接受、要么把长流切到已存在的浏览器直连路径 `/api/agent/direct-runs`（当前 runtime provider 仍走 `/api/agent/runs`，切换属后续 plan）
- [ ] `AGENT_BASE_URL` 指向自托管 agent，CORS/Cloudflare 放行 SSE

### E. 冒烟（手工）
- [ ] `pnpm dev` + `pnpm agent:dev`，新建空白简历 → 面板「从 0 创建简历」
- [ ] 看到：loop 多步工具调用实时可见 → 右侧预览出现 draft → change-set 预览
- [ ] 「同意应用」：experience/education 等**新数组分区**正确落进简历并出现在 `sectionOrder`（重点验全新项创建）
- [ ] 「继续对话」：在同一 draft 上迭代，preview 刷新
- [ ] 暗黑模式 + 自动保存（autosave）不被打断

### F. 上线后监控 / 回滚
- [ ] Langfuse 看 loop 轨迹：步数、token/成本、工具报错率
- [ ] Agent 日志看 `RUN_ERROR` / loop 异常
- [ ] **回滚**：`AGENT_LOOP_ENABLED=false` + 重启 agent → 立即回到单次执行器，**无需回滚 web**

## Follow-ups（不在本 PR）

1. optimize_existing：draft = 真简历副本 + 增量改写
2. 写工具全集（delete/reorder/set_profile）+ 质量校验（防编造/格式）
3. 上下文压缩引擎（`context-status` 从指示器升级；修硬编码 200k）
4. 离线评测 harness（金标准集 + 轨迹指标 + 回放）——调优 loop 的落点
5. 浏览器直连 agent（`/api/agent/direct-runs`）绕开 Vercel 时长限
6. apply 对全新数组项已支持；如需更复杂的项内字段（公司/时间）由 loop 写入，再扩 `apply-operation`
