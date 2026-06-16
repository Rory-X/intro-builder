# Neon 数据库配置指南

## 问题诊断

部署错误 `Failed query: select "stateJson" from "agent_session"` 有三个可能原因：

1. ❌ Migration 0011 没应用到 Neon（表不存在）
2. ❌ GitHub secret `AGENT_DATABASE_URL` 未配置或配错
3. ❌ 数据库角色权限不足

## 快速修复（推荐）

运行一键修复脚本：

```bash
# 在项目根目录执行（需要你的 Neon owner 连接字符串）
DATABASE_URL="postgres://你的owner用户:密码@项目.neon.tech/neondb?sslmode=require" \
  ./scripts/fix-agent-db.sh
```

脚本会自动：
- ✅ 应用 migration 0011（创建 `agent_session` 和 `agent_session_event` 表）
- ✅ 创建 `agent_service` 专用角色（提示你设置密码）
- ✅ 授予正确权限（`resume` 只读，`agent_session*` 读写）
- ✅ 验证配置是否成功

脚本最后会告诉你需要在 GitHub 设置的 `AGENT_DATABASE_URL` 值。

## 手动修复步骤

### 1. 应用 migration

```bash
# 方法 1: 用 drizzle-kit
cd /Users/jiahaoqian/proj/intro-builder
pnpm --filter @intro-builder/web exec drizzle-kit push

# 方法 2: 手动 SQL
psql "$DATABASE_URL" -f apps/web/db/migrations/0011_add_agent_sessions.sql
```

### 2. 创建 agent_service 角色

在 Neon Console SQL Editor 或 `psql` 中执行：

```sql
-- 创建角色
CREATE ROLE agent_service WITH LOGIN PASSWORD '你的强密码';

-- 基础权限
GRANT CONNECT ON DATABASE neondb TO agent_service;
GRANT USAGE ON SCHEMA public TO agent_service;

-- 只读：resume 表（agent 工具读简历）
GRANT SELECT ON TABLE "resume" TO agent_service;
GRANT SELECT ON TABLE "user" TO agent_service;

-- 读写：agent_session 表（会话持久化）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent_session" TO agent_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent_session_event" TO agent_service;
```

### 3. 配置 GitHub Secret

1. 进入 https://github.com/Rory-X/intro-builder/settings/secrets/actions
2. 添加或更新 secret: `AGENT_DATABASE_URL`
3. 值：`postgres://agent_service:你的密码@你的项目.neon.tech/neondb?sslmode=require`

**注意**：不要用 web 应用的 `DATABASE_URL`（那个是 owner 角色，权限过大）。

### 4. 验证配置

```bash
# 测试 agent_service 角色连接
DATABASE_URL="postgres://agent_service:密码@项目.neon.tech/neondb?sslmode=require" \
  ./scripts/diagnose-agent-db.sh
```

应该全部显示 ✅。

### 5. 重新部署

```bash
git commit --allow-empty -m "chore: trigger agent redeploy after DB fix"
git push origin main
```

CD 会自动触发，agent 服务会用新的 `AGENT_DATABASE_URL` 启动。

## 本地测试

在 `apps/agent/.env.local` 添加：

```bash
DATABASE_URL=postgres://agent_service:密码@项目.neon.tech/neondb?sslmode=require
AGENT_JWT_SECRET=dev-secret-change-in-production
AGENT_MODEL_BASE_URL=https://api.deepseek.com/v1
AGENT_MODEL_API_KEY=sk-your-key
AGENT_MODEL_NAME=deepseek-chat
NODE_ENV=development
```

启动测试：

```bash
pnpm dev:web    # 终端 1
pnpm agent:dev  # 终端 2
```

访问 `http://localhost:3000/resume/你的简历ID/edit`，点击 Agent 面板，发送消息，应该能看到：
- ✅ 会话创建成功（session endpoint）
- ✅ 流式对话（chat endpoint with SSE）
- ✅ 工具调用卡片（read_resume, upsert_section）
- ✅ Preview 实时更新
- ✅ 应用更改按钮生效

## 常见错误排查

### `permission denied for table agent_session`
→ `agent_service` 角色权限不足，重新执行第 2 步的 GRANT 语句

### `relation "agent_session" does not exist`
→ Migration 没应用，执行第 1 步

### `password authentication failed for user "agent_service"`
→ GitHub secret 里的密码错误，检查 `AGENT_DATABASE_URL` 的密码部分

### `could not translate host name ... to address`
→ 连接字符串的主机名错误，检查是否是 Neon 的正确域名（格式 `xxx.neon.tech`）

## 验证清单

部署成功后，确认以下功能：

- [ ] Session 创建：POST /api/agent/session 返回 sessionId
- [ ] Chat 流式：POST /api/agent/chat 返回 SSE 流
- [ ] 工具调用：read_resume 能读到简历内容
- [ ] Preview 更新：upsert_section 写入 agent_session.stateJson
- [ ] 应用更改：点击「应用更改」后简历内容更新
- [ ] Ask 面板：ask_user 工具触发时显示输入框

全部 ✅ = 系统正常运行。
