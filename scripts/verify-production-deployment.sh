#!/bin/bash
set -euo pipefail

# 端到端功能验证 - 不需要登录态，只验证服务健康和架构正确性
# 用法: ./scripts/verify-production-deployment.sh

AGENT_URL="https://api.rory-x.me/intro-builder/agent"
WEB_URL="https://intro-builder.vercel.app"

echo "🧪 验证生产环境端到端部署"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Agent: $AGENT_URL"
echo "Web:   $WEB_URL"
echo ""

total=0
passed=0
failed=0

test_endpoint() {
  name="$1"
  url="$2"
  expected_status="${3:-200}"

  total=$((total + 1))
  echo -n "[$total] $name ... "

  status=$(curl -fsSL --max-time 10 -o /dev/null -w "%{http_code}" "$url" 2>&1 || echo "FAILED")

  if [ "$status" = "$expected_status" ]; then
    echo "✅ (HTTP $status)"
    passed=$((passed + 1))
    return 0
  else
    echo "❌ (Expected $expected_status, got $status)"
    failed=$((failed + 1))
    return 1
  fi
}

test_json_response() {
  name="$1"
  url="$2"
  jq_filter="$3"
  expected="$4"

  total=$((total + 1))
  echo -n "[$total] $name ... "

  response=$(curl -fsSL --max-time 10 "$url" 2>&1 || echo "{}")
  actual=$(echo "$response" | jq -r "$jq_filter" 2>/dev/null || echo "PARSE_ERROR")

  if [ "$actual" = "$expected" ]; then
    echo "✅ ($jq_filter = $actual)"
    passed=$((passed + 1))
    return 0
  else
    echo "❌ (Expected $expected, got $actual)"
    echo "   Response: $response"
    failed=$((failed + 1))
    return 1
  fi
}

# 1. Agent 服务健康
test_endpoint "Agent /health" "$AGENT_URL/health"
test_json_response "Agent health status" "$AGENT_URL/health" ".status" "ok"

test_endpoint "Agent /ready (含依赖检查)" "$AGENT_URL/ready"
test_json_response "Agent ready status" "$AGENT_URL/ready" ".status" "ready"
test_json_response "Redis 依赖正常" "$AGENT_URL/ready" ".dependencies.redis" "ready"

# 2. Web 应用可访问
test_endpoint "Web 首页" "$WEB_URL"

# 3. Web BFF 端点存在（会返回 401 未登录，这是正常的）
test_endpoint "Web /api/agent/session (需要认证)" "$WEB_URL/api/agent/session" "401"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "测试结果: $passed/$total 通过"

if [ $failed -eq 0 ]; then
  echo "✅ 生产环境服务健康"
  echo ""
  echo "架构验证:"
  echo "  ✅ Agent 服务 (Hono) 运行正常"
  echo "  ✅ Redis 连接正常"
  echo "  ✅ Web 应用可访问"
  echo "  ✅ Web BFF 端点存在 (需登录态继续测试)"
  echo ""
  echo "⚠️  完整端到端测试需要登录态。建议手动验证:"
  echo "  1. 访问 $WEB_URL"
  echo "  2. 登录后进入任意简历编辑页"
  echo "  3. 打开 Agent 面板"
  echo "  4. 发送测试消息"
  echo "  5. 确认流式响应、工具调用、preview 更新、应用更改"
  echo ""
  echo "详细验证清单: docs/agent/e2e-verification.md"
  exit 0
else
  echo "❌ $failed 个测试失败"
  echo ""
  echo "排查步骤:"
  echo "  1. 检查 Agent 服务日志"
  echo "  2. 验证 AGENT_DATABASE_URL secret 配置正确"
  echo "  3. 运行数据库诊断: ./scripts/diagnose-agent-db.sh"
  exit 1
fi
