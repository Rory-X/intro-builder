#!/bin/bash
set -euo pipefail

# Neon 数据库诊断脚本 - 检查 agent 服务的表、权限和连接
# 用法: DATABASE_URL="postgres://..." ./scripts/diagnose-agent-db.sh

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ERROR: DATABASE_URL 环境变量未设置"
  echo ""
  echo "用法示例："
  echo "  DATABASE_URL='postgres://user:pass@host.neon.tech/db' ./scripts/diagnose-agent-db.sh"
  exit 1
fi

echo "🔍 开始诊断 Neon 数据库配置..."
echo ""

# 1. 检查表是否存在
echo "1️⃣ 检查 agent_session 表是否存在..."
tables=$(psql "$DATABASE_URL" -tA -c "
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('agent_session', 'agent_session_event')
  ORDER BY table_name;
")

if [ -z "$tables" ]; then
  echo "   ❌ agent_session 和 agent_session_event 表不存在"
  echo "   👉 需要应用 migration 0011:"
  echo "      pnpm --filter @intro-builder/web exec drizzle-kit push"
  echo ""
  exit 1
else
  echo "   ✅ 表存在:"
  echo "$tables" | sed 's/^/      /'
  echo ""
fi

# 2. 检查 agent_service 角色是否存在
echo "2️⃣ 检查 agent_service 角色是否存在..."
role_exists=$(psql "$DATABASE_URL" -tA -c "
  SELECT 1 FROM pg_roles WHERE rolname = 'agent_service';
")

if [ -z "$role_exists" ]; then
  echo "   ⚠️  agent_service 角色不存在（可能用 owner 角色）"
  echo "   👉 建议创建只读+agent表读写的专用角色（参考 AGENTS.md）"
  echo ""
else
  echo "   ✅ agent_service 角色存在"
  echo ""

  # 3. 检查权限
  echo "3️⃣ 检查 agent_service 的表权限..."

  # 检查 resume 表 SELECT 权限
  resume_select=$(psql "$DATABASE_URL" -tA -c "
    SELECT has_table_privilege('agent_service', 'resume', 'SELECT');
  " || echo "false")

  if [ "$resume_select" = "t" ]; then
    echo "   ✅ resume 表有 SELECT 权限（只读）"
  else
    echo "   ❌ resume 表缺少 SELECT 权限"
    echo "      GRANT SELECT ON TABLE \"resume\" TO agent_service;"
  fi

  # 检查 agent_session 表读写权限
  session_perms=$(psql "$DATABASE_URL" -tA -c "
    SELECT
      has_table_privilege('agent_service', 'agent_session', 'SELECT') as sel,
      has_table_privilege('agent_service', 'agent_session', 'INSERT') as ins,
      has_table_privilege('agent_service', 'agent_session', 'UPDATE') as upd;
  " | tr '\t' '|')

  IFS='|' read -r sel ins upd <<< "$session_perms"

  if [ "$sel" = "t" ] && [ "$ins" = "t" ] && [ "$upd" = "t" ]; then
    echo "   ✅ agent_session 表有 SELECT/INSERT/UPDATE 权限"
  else
    echo "   ❌ agent_session 表权限不足（sel=$sel, ins=$ins, upd=$upd）"
    echo "      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"agent_session\" TO agent_service;"
  fi

  # 检查 agent_session_event 表读写权限
  event_perms=$(psql "$DATABASE_URL" -tA -c "
    SELECT
      has_table_privilege('agent_service', 'agent_session_event', 'SELECT') as sel,
      has_table_privilege('agent_service', 'agent_session_event', 'INSERT') as ins;
  " | tr '\t' '|')

  IFS='|' read -r sel ins <<< "$event_perms"

  if [ "$sel" = "t" ] && [ "$ins" = "t" ]; then
    echo "   ✅ agent_session_event 表有 SELECT/INSERT 权限"
  else
    echo "   ❌ agent_session_event 表权限不足（sel=$sel, ins=$ins）"
    echo "      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE \"agent_session_event\" TO agent_service;"
  fi
  echo ""
fi

# 4. 测试 agent 服务的典型查询
echo "4️⃣ 测试 agent 启动查询..."
test_query=$(psql "$DATABASE_URL" -tA -c "
  SELECT COUNT(*) FROM \"agent_session\" LIMIT 1;
" 2>&1 || echo "FAILED")

if [[ "$test_query" =~ ^[0-9]+$ ]]; then
  echo "   ✅ SELECT agent_session 成功（当前有 $test_query 条会话）"
else
  echo "   ❌ SELECT agent_session 失败:"
  echo "$test_query" | sed 's/^/      /'
  echo ""
  exit 1
fi

echo ""
echo "✅ 数据库配置检查完成！"
echo ""
echo "下一步:"
echo "  1. 把 agent_service 角色的连接字符串设为 GitHub secret AGENT_DATABASE_URL"
echo "  2. 格式: postgres://agent_service:密码@你的项目.neon.tech/neondb?sslmode=require"
echo "  3. 重新部署触发 CD: git push origin main"
