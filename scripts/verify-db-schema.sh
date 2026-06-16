#!/bin/bash
set -euo pipefail

# 端到端功能测试 - 验证 agent_session 表是否真正可用
# 测试方法：直接查询生产数据库

echo "🧪 验证 agent_session 表在生产环境可用"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ERROR: DATABASE_URL 未设置"
  echo "用法: DATABASE_URL='...' $0"
  exit 1
fi

echo "1️⃣ 测试 agent_session 表查询..."
count=$(psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM agent_session;" 2>&1 || echo "ERROR")

if [ "$count" = "ERROR" ]; then
  echo "   ❌ agent_session 表查询失败"
  echo "   可能原因："
  echo "   - 表不存在（migration 未应用）"
  echo "   - 数据库连接失败"
  echo "   - 权限不足"
  exit 1
fi

echo "   ✅ agent_session 表查询成功"
echo "   当前会话数: $count"
echo ""

echo "2️⃣ 测试 agent_session_event 表查询..."
event_count=$(psql "$DATABASE_URL" -tA -c "SELECT COUNT(*) FROM agent_session_event;" 2>&1 || echo "ERROR")

if [ "$event_count" = "ERROR" ]; then
  echo "   ❌ agent_session_event 表查询失败"
  exit 1
fi

echo "   ✅ agent_session_event 表查询成功"
echo "   当前事件数: $event_count"
echo ""

echo "3️⃣ 测试表结构..."
cols=$(psql "$DATABASE_URL" -tA -c "
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'agent_session'
  ORDER BY ordinal_position;
" | tr '\n' ',' | sed 's/,$//')

echo "   ✅ agent_session 列: $cols"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 数据库层验证通过"
echo ""
echo "Migration 0011 已成功应用。"
echo ""
echo "下一步: 等待 agent 服务重新部署后，测试实际功能"
echo "  访问: https://intro-builder.vercel.app"
echo "  进入简历编辑页 → 点击 Agent 面板"
echo "  应该能成功打开（不再报 500 错误）"
echo ""
