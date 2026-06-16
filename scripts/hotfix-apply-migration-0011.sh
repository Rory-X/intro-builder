#!/bin/bash
set -euo pipefail

# 紧急修复：直接应用 migration 0011 到生产 Neon 数据库
# 这是关键阻塞问题 - agent_session 表不存在导致所有 session 创建失败

echo "🚨 紧急修复：应用 migration 0011 到生产数据库"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ERROR: DATABASE_URL 未设置"
  echo ""
  echo "请设置生产数据库的连接字符串:"
  echo "  export DATABASE_URL='postgres://user:pass@host.neon.tech/db'"
  echo ""
  echo "或直接运行:"
  echo "  DATABASE_URL='...' $0"
  exit 1
fi

# 检查 psql 是否可用
if ! command -v psql &> /dev/null; then
  echo "❌ ERROR: psql 未安装"
  echo ""
  echo "安装方法:"
  echo "  macOS: brew install postgresql"
  echo "  Ubuntu: apt install postgresql-client"
  exit 1
fi

echo "1️⃣ 检查表是否已存在..."
exists=$(psql "$DATABASE_URL" -tA -c "
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'agent_session';
" 2>&1 || echo "CONNECTION_ERROR")

if [ "$exists" = "CONNECTION_ERROR" ]; then
  echo "❌ 无法连接到数据库"
  echo "请检查 DATABASE_URL 是否正确"
  exit 1
fi

if [ "$exists" = "1" ]; then
  echo "   ℹ️  agent_session 表已存在，跳过创建"
  echo ""

  # 验证表结构
  echo "2️⃣ 验证表结构..."
  cols=$(psql "$DATABASE_URL" -tA -c "
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_name = 'agent_session';
  ")

  echo "   ✅ agent_session 有 $cols 列"

  # 测试查询
  echo ""
  echo "3️⃣ 测试查询..."
  count=$(psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM agent_session;")
  echo "   ✅ 查询成功，当前有 $count 条会话记录"

  echo ""
  echo "✅ 表已存在且可用，无需修复"
  exit 0
fi

echo "   ⚠️  agent_session 表不存在，开始创建..."
echo ""

echo "2️⃣ 应用 migration 0011..."
if psql "$DATABASE_URL" -f apps/web/db/migrations/0011_add_agent_sessions.sql; then
  echo "   ✅ Migration 应用成功"
else
  echo "   ❌ Migration 应用失败"
  exit 1
fi

echo ""
echo "3️⃣ 验证表已创建..."
tables=$(psql "$DATABASE_URL" -tA -c "
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('agent_session', 'agent_session_event')
  ORDER BY table_name;
")

if [ -z "$tables" ]; then
  echo "   ❌ 表创建失败"
  exit 1
fi

echo "$tables" | while read -r table; do
  echo "   ✅ $table"
done

echo ""
echo "4️⃣ 测试查询..."
if psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM agent_session;" >/dev/null 2>&1; then
  echo "   ✅ agent_session 查询成功"
else
  echo "   ❌ agent_session 查询失败"
  exit 1
fi

if psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM agent_session_event;" >/dev/null 2>&1; then
  echo "   ✅ agent_session_event 查询成功"
else
  echo "   ❌ agent_session_event 查询失败"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 修复完成！"
echo ""
echo "agent_session 和 agent_session_event 表已成功创建。"
echo ""
echo "下一步:"
echo "  1. 重启 agent 服务以清除缓存"
echo "  2. 测试 session 创建: 访问 Web 应用 Agent 面板"
echo "  3. 确认不再有 'relation does not exist' 错误"
echo ""
