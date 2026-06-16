# Agent Hono + AI SDK 重构完成总结

## ✅ 已完成的功能

### 1. 服务端重构（apps/agent）

- ✅ **Hono 框架替换 Node http**：[apps/agent/src/server/app.ts](../../apps/agent/src/server/app.ts)
- ✅ **两个 agent 端点**：
  - `POST /v1/agent/session`：创建会话，存 Postgres
  - `POST /v1/agent/chat`：SSE 流式对话，AI SDK UI message stream
- ✅ **Postgres 集成**：[apps/agent/src/db/](../../apps/agent/src/db/)
  - 读 `resume` 表（只读，工具用）
  - 读写 `agent_session` 和 `agent_session_event` 表（会话持久化）
- ✅ **工具集**：[apps/agent/src/agent/tools.ts](../../apps/agent/src/agent/tools.ts)
  - `read_resume`：只读生产库
  - `upsert_section`：写 preview（不碰 `resume` 表）
  - `ask_user`：人机回环（needsApproval）
- ✅ **Preview 机制**：写入 `agent_session.stateJson`，通过 `data-preview` part 流式推送

### 2. Web 侧集成（apps/web）

- ✅ **AI SDK Runtime**：[components/agent/agent-aisdk-panel.tsx](../../apps/web/components/agent/agent-aisdk-panel.tsx)
  - `useChatRuntime` + `AssistantChatTransport`
  - `AssistantRuntimeProvider` + `ThreadPrimitive`
  - 替换原有 AG-UI 适配层
- ✅ **工具 UI**：`makeAssistantToolUI`
  - `read_resume`：只读卡片
  - `upsert_section`：写入卡片，显示 fieldPath 和 changeSummary
  - `ask_user`：ask 面板，表单 / 选项提交
- ✅ **Preview / Apply 流程**：
  - Preview 区域订阅 `data-preview` 实时渲染
  - 「应用更改」按钮调用 `/api/agent/preview` 拉取操作
  - 批量应用到表单（复用 autosave 写路径）
- ✅ **BYOK（自定义模型）**：
  - [lib/agent/byok-store.ts](../../apps/web/lib/agent/byok-store.ts)：localStorage 存储
  - [components/agent/byok-settings-dialog.tsx](../../apps/web/components/agent/byok-settings-dialog.tsx)：设置对话框
  - `prepareSendMessagesRequest` hook 注入 `modelConfig`
  - Agent 服务按需使用用户模型（从不持久化 key）

### 3. 测试与文档

- ✅ 单元测试：[tests/unit/agent-byok-store.test.ts](../../apps/web/tests/unit/agent-byok-store.test.ts)
- ✅ 端到端验证清单：[docs/agent/e2e-verification.md](./e2e-verification.md)
- ✅ Neon 配置指南：[docs/agent/neon-setup.md](./neon-setup.md)

## 🔧 部署前必须完成的步骤

你的部署错误 `Failed query: select "stateJson" from "agent_session"` 表明数据库配置未完成。

### 立即执行（5 分钟）

#### 选项 A：一键修复（推荐）

```bash
# 1. 在本地运行修复脚本（需要你的 Neon owner 连接字符串）
cd /Users/jiahaoqian/proj/intro-builder
DATABASE_URL="postgres://neondb_owner:密码@项目.neon.tech/neondb?sslmode=require" \
  ./scripts/fix-agent-db.sh

# 脚本会：
# - 应用 migration 0011（创建 agent_session 表）
# - 创建 agent_service 角色（提示你设置密码）
# - 授予权限（resume 只读，agent_session* 读写）
# - 验证配置

# 2. 脚本最后会告诉你 AGENT_DATABASE_URL 的值，复制它

# 3. 在 GitHub 设置 secret
# https://github.com/Rory-X/intro-builder/settings/secrets/actions
# 名称: AGENT_DATABASE_URL
# 值: postgres://agent_service:你的密码@项目.neon.tech/neondb?sslmode=require

# 4. 触发重新部署
git commit --allow-empty -m "chore: trigger agent redeploy after DB config"
git push origin main
```

#### 选项 B：手动修复（如果脚本不可用）

见 [neon-setup.md](./neon-setup.md) 的"手动修复步骤"。

### 验证部署成功

```bash
# 等待 CD 完成（约 5-10 分钟），然后测试
./scripts/test-agent-production.sh \
  https://api.rory-x.me/intro-builder/agent \
  https://intro-builder.vercel.app

# 应该看到：
# ✅ Health endpoint
# ✅ Ready endpoint (含 DB 检查)
# ✅ Web 首页可访问
```

### 手动端到端验证

1. 访问 https://intro-builder.vercel.app
2. 登录并进入任意简历编辑页
3. 点击「Agent」面板
4. 发送测试消息："帮我优化工作经历"
5. 确认：
   - ✅ 流式文本逐字出现
   - ✅ 工具卡显示（read_resume、upsert_section）
   - ✅ Preview 区域实时更新
   - ✅ 点击「应用更改」后简历内容更新

**全部 ✅ = 系统功能完整**。

## 📊 功能对比

| 功能 | 旧架构（AG-UI） | 新架构（Hono + AI SDK） | 状态 |
|---|---|---|---|
| 服务框架 | Node `http` 1637 行 | Hono 路由 | ✅ 已替换 |
| 流式协议 | AG-UI JSON 契约 | AI SDK UI message stream | ✅ 已替换 |
| 前端 Runtime | AG-UI adapter | assistant-ui + useChatRuntime | ✅ 已替换 |
| 会话存储 | Redis（30 天 TTL） | Postgres（永久） | ✅ 已迁移 |
| Preview 机制 | 无 | 累积式 preview + apply | ✅ 新增 |
| Ask 功能 | 无 | ask_user 工具 + 面板 | ✅ 新增 |
| BYOK | 无 | localStorage + per-request | ✅ 新增 |
| 工具只读生产库 | 否（工具直接写 resume） | 是（只 SELECT） | ✅ 已实现 |

## 🗂️ 文件清单

### 新增

- `apps/agent/src/db/` — Postgres 连接与 schema
- `apps/web/lib/agent/byok-store.ts` — BYOK localStorage 存储
- `apps/web/components/agent/byok-settings-dialog.tsx` — BYOK 设置对话框
- `apps/web/components/agent/agent-aisdk-panel.tsx` — AI SDK runtime 面板
- `apps/web/tests/unit/agent-byok-store.test.ts` — BYOK 单元测试
- `docs/agent/neon-setup.md` — Neon 数据库配置指南
- `docs/agent/e2e-verification.md` — 端到端验证清单
- `scripts/diagnose-agent-db.sh` — 数据库诊断脚本
- `scripts/fix-agent-db.sh` — 数据库一键修复脚本
- `scripts/test-agent-production.sh` — 生产环境测试脚本

### 已删除（旧链路清理）

- ❌ `apps/agent/src/http.ts`（1637 行，被 Hono 替换）
- ❌ `apps/agent/src/agent-messages.ts`（1525 行，被 AI SDK 契约替换）
- ❌ `apps/agent/src/agent-tools.ts`（380 行，JSON 校验层删除）
- ❌ `apps/web/components/agent/agent-tool-card.tsx`（被 makeAssistantToolUI 替换）

### 修改

- `apps/agent/src/server/app.ts` — Hono 路由 + AI SDK streamText
- `apps/agent/src/agent/tools.ts` — 新工具定义（read_resume, upsert_section, ask_user）
- `apps/web/app/api/agent/session/route.ts` — 新 BFF 端点
- `apps/web/app/api/agent/chat/route.ts` — 新 BFF 端点（SSE 透传）
- `apps/web/app/api/agent/preview/route.ts` — 读取 preview 操作
- `.github/workflows/deploy-agent.yml` — CD 已配置 DATABASE_URL 注入

## ⚠️ 已知限制

1. **Session 无跨设备同步**：会话存在数据库但前端未实现历史会话列表（未来功能）
2. **Preview 不支持删除操作**：只支持 upsert（新增/更新），不支持删除分区/条目
3. **Ask 面板无富文本**：只支持纯文本输入，不支持选项预览或复杂表单
4. **BYOK 无服务端验证**：前端直接发送 API key，服务端不验证有效性（首次调用失败才报错）

## 🎯 下一步（可选增强）

- [ ] 历史会话列表与恢复
- [ ] Preview diff 可视化（类似 Git diff）
- [ ] 批量操作支持（一次性修改多个分区）
- [ ] 工具调用审批流（高风险操作需确认）
- [ ] 服务端 BYOK 模型池（缓存用户模型实例）

## 📝 Commit 建议

```bash
# 如果本地还有未提交的文档和脚本
git add docs/agent/ scripts/*.sh
git commit -m "docs(agent): add Neon setup guide and diagnostic scripts

- Add neon-setup.md with DB configuration instructions
- Add e2e-verification.md checklist for deployment validation
- Add diagnose-agent-db.sh for automated DB checks
- Add fix-agent-db.sh for one-click DB setup
- Add test-agent-production.sh for production smoke tests

Addresses deployment error: 'Failed query: select stateJson from agent_session'
Requires: AGENT_DATABASE_URL secret configured in GitHub Actions
"

git push origin feat/agent-byok
```

## 💡 关键决策记录

详见 [docs/superpowers/specs/2026-06-15-agent-hono-aisdk-rewrite-design.md](../superpowers/specs/2026-06-15-agent-hono-aisdk-rewrite-design.md) 决策章节（D12-D18）。

---

**当前状态**：代码完成 ✅ | 部署阻塞 ⚠️ (需配置数据库) | 文档完整 ✅
