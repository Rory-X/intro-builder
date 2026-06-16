#!/bin/bash
set -euo pipefail

# 一键修复 Neon 数据库配置 - 应用 migration + 创建角色 + 授权
# 用法: DATABASE_URL="postgres://..." ./scripts/fix-agent-db.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ERROR: DATABASE_URL 环境变量未设置"
  echo ""
  echo "用法示例："
  echo "  DATABASE_URL='postgres://owner:pass@host.neon.tech/db' ./scripts/fix-agent-db.sh"
  echo ""
  echo "注意: 需要用有 CREATEDB 或 owner 权限的连接字符串"
  exit 1
fi

echo "🔧 开始修复 Neon 数据库配置..."
echo ""

# 1. 应用 migration 0011（如果表不存在）
echo "1️⃣ 检查并应用 migration 0011..."
tables=$(psql "$DATABASE_URL" -tA -c "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('agent_session', 'agent_session_event');
")

if [ "$tables" = "2" ]; then
  echo "   ✅ agent_session 表已存在，跳过 migration"
else
  echo "   📝 应用 migration 0011_add_agent_sessions.sql..."
  psql "$DATABASE_URL" -f apps/web/db/migrations/0011_add_agent_sessions.sql
  echo "   ✅ Migration 应用成功"
fi
echo ""

# 2. 创建 agent_service 角色（如果不存在）
echo "2️⃣ 创建 agent_service 角色..."
role_exists=$(psql "$DATABASE_URL" -tA -c "
  SELECT 1 FROM pg_roles WHERE rolname = 'agent_service';
" || echo "")

if [ -n "$role_exists" ]; then
  echo "   ℹ️  agent_service 角色已存在"
  read -p "   是否重新设置密码？(y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    read -sp "   输入新密码: " new_password
    echo
    psql "$DATABASE_URL" -c "ALTER ROLE agent_service WITH PASSWORD '$new_password';"
    echo "   ✅ 密码已更新"
  fi
else
  read -sp "   为 agent_service 角色设置密码: " agent_password
  echo
  if [ -z "$agent_password" ]; then
    echo "   ❌ 密码不能为空"
    exit 1
  fi

  psql "$DATABASE_URL" <<SQL
CREATE ROLE agent_service WITH LOGIN PASSWORD '$agent_password';
GRANT CONNECT ON DATABASE neondb TO agent_service;
GRANT USAGE ON SCHEMA public TO agent_service;
SQL
  echo "   ✅ agent_service 角色创建成功"
fi
echo ""

# 3. 授予权限
echo "3️⃣ 授予表权限..."
psql "$DATABASE_URL" <<'SQL'
-- 只读：resume 表（agent 工具读简历）
GRANT SELECT ON TABLE "resume" TO agent_service;

-- 只读：user 表（验证归属）
GRANT SELECT ON TABLE "user" TO agent_service;

-- 读写：agent_session 表（会话持久化）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent_session" TO agent_service;

-- 读写：agent_session_event 表（事件日志）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "agent_session_event" TO agent_service;
SQL
echo "   ✅ 权限授予成功"
echo ""

# 4. 验证配置
echo "4️⃣ 验证配置..."

# 提取主机名和数据库名
db_host=$(echo "$DATABASE_URL" | sed -n 's|^postgres[ql]*://[^@]*@\([^:/]*\).*|\1|p')
db_name=$(echo "$DATABASE_URL" | sed -n 's|^.*/\([^?]*\).*|\1|p')

# 测试 agent_service 角色的查询
echo "   测试 agent_service 角色的权限..."
test_url=$(echo "$DATABASE_URL" | sed "s|://[^@]*@|://agent_service:${agent_password:-agent_service}@|")

# SELECT resume (只读)
if psql "$test_url" -tA -c "SELECT COUNT(*) FROM \"resume\" LIMIT 1;" >/dev/null 2>&1; then
  echo "   ✅ resume 表 SELECT 成功（只读）"
else
  echo "   ⚠️  resume 表 SELECT 失败（可能表为空或权限问题）"
fi

# SELECT + INSERT agent_session (读写)
session_count=$(psql "$test_url" -tA -c "SELECT COUNT(*) FROM \"agent_session\";" 2>/dev/null || echo "FAILED")
if [[ "$session_count" =~ ^[0-9]+$ ]]; then
  echo "   ✅ agent_session 表 SELECT 成功（当前 $session_count 条会话）"
else
  echo "   ❌ agent_session 表查询失败"
  exit 1
fi

# 尝试 INSERT 测试（然后立即删除）
test_id="test-$(date +%s)"
if psql "$test_url" -c "
  INSERT INTO \"agent_session\" (id, \"userId\", title, \"stateJson\", mode)
  VALUES ('$test_id', 'test-user', 'test', '{}'::jsonb, 'optimize_existing');
  DELETE FROM \"agent_session\" WHERE id = '$test_id';
" >/dev/null 2>&1; then
  echo "   ✅ agent_session 表 INSERT/DELETE 成功（读写）"
else
  echo "   ❌ agent_session 表写入失败"
  exit 1
fi

echo ""
echo "✅ 数据库配置修复完成！"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 下一步: 配置 GitHub Secret"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. 进入 GitHub 仓库设置:"
echo "   https://github.com/Rory-X/intro-builder/settings/secrets/actions"
echo ""
echo "2. 添加或更新 secret: AGENT_DATABASE_URL"
echo ""
echo "3. 值为（复制下面这行，替换密码）:"
echo "   postgres://agent_service:你的密码@${db_host}/${db_name}?sslmode=require"
echo ""
echo "4. 重新部署:"
echo "   git commit --allow-empty -m 'chore: trigger agent redeploy'"
echo "   git push origin main"
echo ""
