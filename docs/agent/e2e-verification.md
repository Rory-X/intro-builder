# Agent 端到端验证清单

运行此清单确认 Hono + AI SDK 重构的所有功能在生产环境正常工作。

## 前置条件

- [ ] Neon 数据库配置完成（见 [neon-setup.md](./neon-setup.md)）
- [ ] GitHub secret `AGENT_DATABASE_URL` 已设置
- [ ] Agent 服务已部署且健康检查通过

## 本地验证（开发环境）

### 环境准备

```bash
# apps/agent/.env.local
DATABASE_URL=postgres://agent_service:密码@项目.neon.tech/neondb?sslmode=require
AGENT_JWT_SECRET=dev-secret
AGENT_MODEL_BASE_URL=https://api.deepseek.com/v1
AGENT_MODEL_API_KEY=sk-your-key
AGENT_MODEL_NAME=deepseek-chat

# 启动服务
pnpm dev:web    # 终端 1
pnpm agent:dev  # 终端 2
```

### 1. Session 端点

```bash
# Web BFF 创建会话
curl -X POST http://localhost:3000/api/agent/session \
  -H "Content-Type: application/json" \
  -d '{"resumeId":"你的简历ID","mode":"optimize_existing"}'

# 预期响应
{"sessionId":"session-xxx-xxx"}
```

- [ ] 返回有效 sessionId
- [ ] 数据库 `agent_session` 表新增一行
- [ ] `stateJson` 包含 `{workspace:{draftResume:null,changeSets:[]}}`

### 2. Chat 端点（流式对话）

```bash
# 发送消息（需要先从上一步拿到 sessionId）
curl -X POST http://localhost:3000/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"session-xxx","messages":[{"role":"user","content":"帮我把工作经历第一条的公司名改成字节跳动"}]}'

# 预期响应（SSE 流）
data: {"type":"text-delta","content":"好"}
data: {"type":"text-delta","content":"的"}
data: {"type":"tool-call","toolName":"read_resume",...}
data: {"type":"tool-result",...}
data: {"type":"tool-call","toolName":"upsert_section",...}
data: {"type":"data","value":{"preview":{...}}}
...
```

- [ ] 返回 `Content-Type: text/event-stream`
- [ ] 流中有 `text-delta` 文本增量
- [ ] 流中有 `tool-call` 和 `tool-result`
- [ ] 流中有自定义 `data` part 包含 preview

### 3. 工具调用

在 Web UI 的 Agent 面板中：

**read_resume 工具（只读）**
- [ ] 发送消息"我的简历现在写了什么？"
- [ ] 工具卡显示"读取简历（只读）"
- [ ] Agent 能复述当前简历内容
- [ ] 数据库 `resume` 表没有被修改（只 SELECT）

**upsert_section 工具（写 preview）**
- [ ] 发送消息"把工作经历第一条改成在字节跳动工作"
- [ ] 工具卡显示"写入分区 → experience"
- [ ] 工具卡显示 changeSummary
- [ ] Preview 区域实时更新（不用点「应用更改」就能看到）
- [ ] 数据库 `resume` 表内容**没变**
- [ ] 数据库 `agent_session.stateJson` 更新了 preview

**ask_user 工具（人机回环）**
- [ ] 发送消息"帮我润色简历"（触发 ask）
- [ ] 前端显示 ask 面板："你的目标岗位是什么？"
- [ ] 填写"前端工程师"并提交
- [ ] Agent 收到答案并继续生成

### 4. Preview / Apply 流程

- [ ] 在 Agent 面板连续发送多条修改指令
- [ ] Preview 区域累积显示所有修改
- [ ] 点击「应用更改」按钮
- [ ] Toast 提示"已应用 N 处修改"
- [ ] 返回编辑器，表单内容已更新
- [ ] 数据库 `resume.content` 已写入（调用 autosave）

### 5. BYOK（自定义模型）

- [ ] 点击 Agent 面板右上角「模型设置」
- [ ] 填入 Base URL、API Key、模型名
- [ ] 保存后按钮显示"模型已配置"
- [ ] 发送消息，network 请求携带 `modelConfig`
- [ ] Agent 服务使用 BYOK 的模型响应
- [ ] localStorage 有 `intro-builder.agent.byok.v1` 记录

## 生产验证（部署环境）

### 健康检查

```bash
# 替换成你的 agent 域名
AGENT_URL="https://api.rory-x.me/intro-builder/agent"

# Health endpoint
curl -fsSL "$AGENT_URL/health"
# 预期: {"status":"ok"}

# Ready endpoint（包含 DB 连接检查）
curl -fsSL "$AGENT_URL/ready"
# 预期: {"status":"ready","checks":{"database":"ok"}}
```

- [ ] `/health` 返回 200
- [ ] `/ready` 返回 200 且 `database: "ok"`

### 端到端流程

在生产环境 URL（如 `https://intro-builder.vercel.app`）：

1. [ ] 登录账号
2. [ ] 进入任意简历编辑页
3. [ ] 点击「Agent」面板
4. [ ] 发送消息"帮我优化工作经历"
5. [ ] 观察流式响应、工具卡、preview 更新
6. [ ] 点击「应用更改」
7. [ ] 确认简历内容已更新

### 数据库验证

连接生产 Neon 数据库：

```sql
-- 查看会话数量
SELECT COUNT(*) FROM "agent_session";

-- 查看最近 5 条会话
SELECT id, "userId", title, mode, status, "createdAt"
FROM "agent_session"
ORDER BY "createdAt" DESC
LIMIT 5;

-- 查看事件日志
SELECT COUNT(*) FROM "agent_session_event";

-- 检查 preview 是否写入 stateJson
SELECT id, title, jsonb_pretty("stateJson"->'workspace'->'draftResume')
FROM "agent_session"
WHERE "stateJson"->'workspace'->'draftResume' IS NOT NULL
LIMIT 1;
```

- [ ] `agent_session` 表有新增会话
- [ ] `agent_session_event` 表有事件记录
- [ ] `stateJson` 包含有效的 preview 数据

## 回归测试（确保旧功能未破坏）

- [ ] 富文本润色：选中文本 → 点击「润色」→ diff 展示 → 接受
- [ ] 简历助手：点击「简历助手」→ 选择优化建议 → 一键应用
- [ ] Autosave：编辑任意字段 → 2 秒后自动保存 → 刷新页面内容保留
- [ ] PDF 导出：点击「下载 PDF」→ 预览与 PDF 一致
- [ ] 协作批注：邀请协作者 → 添加批注 → 实时同步

## 性能基准

- [ ] Session 创建 < 500ms
- [ ] Chat 首字节 < 2s
- [ ] 工具调用单次 < 3s
- [ ] Preview 更新延迟 < 100ms（流式推送）
- [ ] 应用更改写入 < 1s

## 错误场景

- [ ] 无效 sessionId → 返回 400 错误提示
- [ ] JWT 过期 → 返回 401 跳转登录
- [ ] 模型 API 超时 → Toast 提示"请求超时，请重试"
- [ ] 数据库连接失败 → `/ready` 返回 503
- [ ] 工具调用异常 → 显示错误卡片，不中断对话

## 完成标准

全部 ✅ = 系统功能完整且生产可用。

任何 ❌ 需记录 issue 并修复后重新验证。
