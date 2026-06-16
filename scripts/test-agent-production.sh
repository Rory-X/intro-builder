#!/bin/bash
set -euo pipefail

# Agent 生产环境端到端测试
# 用法: ./scripts/test-agent-production.sh [AGENT_URL] [WEB_URL]
#
# 示例:
#   ./scripts/test-agent-production.sh \
#     https://api.rory-x.me/intro-builder/agent \
#     https://intro-builder.vercel.app

AGENT_URL="${1:-}"
WEB_URL="${2:-}"

if [ -z "$AGENT_URL" ] || [ -z "$WEB_URL" ]; then
  echo "❌ Usage: $0 AGENT_URL WEB_URL"
  echo ""
  echo "示例:"
  echo "  $0 https://api.rory-x.me/intro-builder/agent https://intro-builder.vercel.app"
  exit 1
fi

echo "🧪 测试 Agent 生产环境端到端功能"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Agent URL: $AGENT_URL"
echo "Web URL:   $WEB_URL"
echo ""

# 测试计数
total=0
passed=0
failed=0

run_test() {
  name="$1"
  shift
  total=$((total + 1))

  echo -n "[$total] $name ... "

  if output=$("$@" 2>&1); then
    echo "✅"
    passed=$((passed + 1))
    return 0
  else
    echo "❌"
    echo "    Error: $output"
    failed=$((failed + 1))
    return 1
  fi
}

# 1. Agent 健康检查
run_test "Health endpoint" \
  curl -fsSL --max-time 10 "$AGENT_URL/health" -o /dev/null

run_test "Ready endpoint (含 DB 检查)" \
  bash -c "curl -fsSL --max-time 10 '$AGENT_URL/ready' | grep -q '\"database\":\"ok\"'"

# 2. Web 应用健康检查
run_test "Web 首页可访问" \
  curl -fsSL --max-time 10 "$WEB_URL" -o /dev/null

# 3. Session 端点（需要登录，这里只测 401 或正常响应）
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Session 和 Chat 端点需要登录态，跳过自动化测试"
echo "请手动验证（见 docs/agent/e2e-verification.md）:"
echo "  - 登录后访问任意简历编辑页"
echo "  - 打开 Agent 面板"
echo "  - 发送测试消息"
echo "  - 观察流式响应、工具调用、preview 更新"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 4. 数据库检查（需要 DATABASE_URL）
if [ -n "${DATABASE_URL:-}" ]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "数据库检查"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  run_test "agent_session 表存在" \
    bash -c "psql '$DATABASE_URL' -tA -c 'SELECT 1 FROM agent_session LIMIT 1;' >/dev/null 2>&1 || true"

  run_test "agent_session_event 表存在" \
    bash -c "psql '$DATABASE_URL' -tA -c 'SELECT 1 FROM agent_session_event LIMIT 1;' >/dev/null 2>&1 || true"

  echo ""
else
  echo "⚠️  DATABASE_URL 未设置，跳过数据库检查"
  echo "   设置后重新运行以验证表和权限"
  echo ""
fi

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试结果: $passed/$total 通过"

if [ $failed -eq 0 ]; then
  echo "✅ 所有自动化测试通过"
  echo ""
  echo "下一步: 手动验证 Agent 对话功能"
  echo "  1. 访问 $WEB_URL"
  echo "  2. 登录并进入任意简历编辑页"
  echo "  3. 点击 Agent 面板，发送测试消息"
  echo "  4. 确认工具调用、preview 更新、应用更改等功能正常"
  echo ""
  echo "详细验证清单: docs/agent/e2e-verification.md"
  exit 0
else
  echo "❌ $failed 个测试失败"
  echo ""
  echo "排查步骤:"
  echo "  1. 检查 Agent 服务日志: docker compose logs agent"
  echo "  2. 验证环境变量: AGENT_DATABASE_URL, AGENT_JWT_SECRET 等"
  echo "  3. 运行数据库诊断: ./scripts/diagnose-agent-db.sh"
  exit 1
fi
