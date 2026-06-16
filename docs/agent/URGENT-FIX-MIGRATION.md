# 🚨 紧急修复：Migration 0011 未应用

**问题**: 生产环境报错 `relation "agent_session" does not exist`  
**根因**: Migration 0011 从未应用到生产 Neon 数据库  
**影响**: Agent 功能完全不可用（所有 session 创建失败）  
**状态**: 🔴 阻塞中

---

## 问题诊断

### 观察到的现象

```json
// 生产环境错误
{
  "error": "internal_error",
  "message": "relation \"agent_session\" does not exist [42P01]",
  "requestId": "req_cda48ea5-57b2-4178-be23-95bdf9c48230"
}
```

### 服务健康状态

```bash
✅ Agent /health   - HTTP 200 (服务运行正常)
✅ Agent /ready    - HTTP 200 (Redis 连接正常)
❌ Session 创建    - 500 错误（表不存在）
```

### 根本原因

Migration `0011_add_agent_sessions.sql` 存在于代码库但**从未执行**到生产数据库。

可能原因：
1. Drizzle kit 没有自动应用 migration 的 CD 步骤
2. 手动执行被遗漏
3. DATABASE_URL 指向了错误的数据库实例

---

## 立即修复步骤（5 分钟）

### 方法 1：自动脚本（推荐）

```bash
# 1. 获取生产 Neon 数据库连接字符串
# 在 Neon Console 或 Vercel 环境变量中找到 DATABASE_URL

# 2. 运行紧急修复脚本
cd /Users/jiahaoqian/proj/intro-builder
DATABASE_URL="postgres://user:pass@host.neon.tech/neondb" \
  ./scripts/hotfix-apply-migration-0011.sh

# 脚本会:
# - 检查表是否已存在
# - 应用 migration SQL
# - 验证表创建成功
# - 测试查询
```

### 方法 2：手动 SQL（如果脚本失败）

```bash
# 1. 直接用 psql 连接生产数据库
psql "postgres://user:pass@host.neon.tech/neondb"

# 2. 执行 migration SQL
\i apps/web/db/migrations/0011_add_agent_sessions.sql

# 3. 验证表创建
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('agent_session', 'agent_session_event');

# 应该返回两行
```

### 方法 3：Drizzle Kit Push

```bash
# 如果本地有 DATABASE_URL
cd apps/web
DATABASE_URL="生产连接字符串" pnpm exec drizzle-kit push
```

---

## 验证修复成功

### 1. 数据库层验证

```sql
-- 连接生产数据库后执行
SELECT COUNT(*) FROM agent_session;
-- 应该返回 0（新表，无数据）

SELECT COUNT(*) FROM agent_session_event;
-- 应该返回 0
```

### 2. Agent 服务验证

```bash
# 重启 agent 服务（清除可能的缓存）
# 在部署服务器上：
docker compose restart agent

# 或通过 CD 触发重新部署：
git commit --allow-empty -m "chore: restart agent after DB fix"
git push origin main
```

### 3. 端到端验证

1. 访问 https://intro-builder.vercel.app
2. 登录账号
3. 进入任意简历编辑页
4. 点击「Agent」按钮
5. 应该能成功打开面板（不再报 500 错误）
6. 发送测试消息
7. 确认流式响应正常

---

## 为什么之前的验证没发现这个问题？

1. **/ready 端点不检查 agent_session 表**
   - 只检查了 Redis 连接
   - 应该增加 Postgres 表存在性检查

2. **只验证了服务启动，没验证实际查询**
   - Agent 服务能启动不代表表存在
   - 第一次 session 创建才会触发错误

3. **假设 DATABASE_URL 配置 = 表已创建**
   - 环境变量存在不代表 migration 已应用
   - 需要显式验证表结构

---

## 后续改进

### 1. 增强 /ready 端点

```typescript
// apps/agent/src/server/app.ts
app.get("/ready", async (c) => {
  // 现有 Redis 检查
  const redis = await checkRedis();
  
  // 新增：检查 agent_session 表
  const database = await checkDatabase();
  
  return c.json({
    status: database.ok && redis.ok ? "ready" : "degraded",
    dependencies: { redis, database }
  });
});

async function checkDatabase() {
  try {
    await db.select().from(agentSessions).limit(1);
    return { status: "ok" };
  } catch (error) {
    return { 
      status: "error", 
      message: error.message 
    };
  }
}
```

### 2. CD 中增加 Migration 检查

```yaml
# .github/workflows/deploy-agent.yml
- name: Verify database schema
  run: |
    psql "$DATABASE_URL" -c "
      SELECT COUNT(*) FROM agent_session LIMIT 1;
    " || {
      echo "ERROR: agent_session table does not exist"
      echo "Run migration first: scripts/hotfix-apply-migration-0011.sh"
      exit 1
    }
```

### 3. 端到端冒烟测试

在 CD 成功后自动运行：
```bash
./scripts/verify-production-deployment.sh
# 应该测试实际 session 创建，不只是 /health
```

---

## 当前状态

- ✅ 代码实现：100% 完成
- ✅ 部署配置：DATABASE_URL 已设置
- ✅ 服务运行：Agent 服务启动正常
- ❌ **数据库 schema：Migration 未应用**
- ❌ **功能可用性：Agent 完全不可用**

**结论**：系统**未真正完成部署**。服务虽然运行，但核心功能因数据库表缺失而无法使用。

---

## 执行人

**你（用户）必须立即执行修复脚本**。我无法直接访问生产数据库。

预计耗时：**5 分钟**

修复完成后，重新运行验证：
```bash
./scripts/verify-production-deployment.sh
```

应该看到所有检查通过，且能成功创建 session。
