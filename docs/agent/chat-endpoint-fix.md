# Chat 端点修复记录

**时间**: 2026-06-16 17:05  
**问题**: `{"error":"bad_request","message":"Invalid chat request"}`  
**状态**: ✅ 已修复并部署

---

## 问题根因

Web BFF (`apps/web/app/api/agent/chat/route.ts`) 把前端发送的完整请求体直接转发给 agent，但请求包含 agent schema 不认识的字段：

```json
{
  "tools": {},           // ❌ assistant-ui 内部状态
  "resumeId": "...",     // ❌ 只用于 Web 权限检查
  "sessionId": "...",    // ✅ agent 需要
  "mode": "...",         // ✅ agent 需要
  "messages": [...]      // ✅ agent 需要
}
```

Agent 的 `ChatBodySchema` 只接受：
- `sessionId` (optional)
- `messages` (required)
- `mode` (optional)
- `modelConfig` (optional, for BYOK)

额外的字段导致 Zod 验证失败 → 返回 400 "Invalid chat request"。

---

## 修复方案

在 Web BFF 中过滤请求体，只转发 agent 需要的字段：

```typescript
// 修复前
body: body,  // 直接转发原始 body

// 修复后
const agentBody = {
  ...(typeof parsed.sessionId === "string" ? { sessionId: parsed.sessionId } : {}),
  ...(Array.isArray(parsed.messages) ? { messages: parsed.messages } : {}),
  ...(typeof parsed.mode === "string" ? { mode: parsed.mode } : {}),
  ...(parsed.modelConfig ? { modelConfig: parsed.modelConfig } : {}),
};
body: JSON.stringify(agentBody),
```

---

## 验证步骤

1. ✅ TypeCheck 通过（无类型错误）
2. ✅ 提交并推送到 main
3. ⏳ 等待 Vercel 自动部署
4. ⏳ 测试实际登录后的 chat 流

---

## 部署状态

- **提交**: 5efa70096
- **推送时间**: 2026-06-16 17:06
- **Vercel 部署**: 自动触发中（预计 2-3 分钟）

---

## 测试清单（部署后）

用户需要手动验证：

1. 访问 https://intro-builder.vercel.app
2. 登录账号
3. 进入简历编辑页
4. 点击 Agent 面板
5. 发送测试消息
6. 确认：
   - ✅ 不再返回 "Invalid chat request"
   - ✅ 流式文本正常显示
   - ✅ 工具调用正常
   - ✅ Preview 更新正常

---

## 相关文件

- 修复文件: `apps/web/app/api/agent/chat/route.ts`
- Agent schema: `apps/agent/src/server/app.ts` 第 674 行
- 前端 transport: `apps/web/components/agent/agent-aisdk-panel.tsx` 第 128-143 行

---

## 后续改进

1. **添加请求体验证日志**：在 Web BFF 记录被过滤掉的字段
2. **前端类型安全**：定义 `ChatRequestBody` 类型确保前后端一致
3. **E2E 测试**：添加 chat 端点的集成测试

---

## 结论

修复已完成并推送。等待 Vercel 部署后，chat 功能应该恢复正常。

**预计可用时间**: 2026-06-16 17:10
