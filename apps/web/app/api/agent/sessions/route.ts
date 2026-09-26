import { retiredAgentRouteResponse } from "@/lib/agent/retired-route";

/**
 * `/api/agent/sessions` —— **已退役**。
 *
 * ## 为什么退役
 *
 * 这组接口（列表 / 删除 / 重命名）原本服务于**旧会话模型**
 * （`lib/agent/session-store.ts` 的会话表 + 事件表）。两条独立证据：
 *
 * 1. **路由零消费方**：全树搜索没有任何客户端或服务端代码调用它 ——
 *    连 UI 组件 `agent-session-selector.tsx` 自己也没被任何地方渲染
 *    （它只 `import type` 了这里的列表项类型）。这是「只被测试调用」的路径。
 * 2. **模型已被替代**：统一 Run 路由（P04）改用 `ai_run` 的 `sessionId`
 *    作为会话维度 —— 会话归属在创建 Run 时随行落库
 *    （`sessionId: body.sessionId`），不再需要独立的会话表。
 *
 * ## 替代入口
 *
 * - 浮窗会话列表与历史消息：`/api/agent/floating/sessions` 与
 *   `/api/agent/floating/sessions/[sessionId]`（浮窗一直用它，**仍是现役**）；
 * - Run 级会话归属：`POST /api/ai/runs` 的 `sessionId` 字段，
 *   配合 `GET /api/ai/runs/[runId]` 的事件回放。
 *
 * ## 为什么不重定向到旧服务
 *
 * plan 明确禁止。重定向会让「旧服务无请求」这个退役信号一直达不到 ——
 * 而那是 P08 决定能否下线服务器的依据。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPLACEMENT =
  "浮窗会话列表（GET /api/agent/floating/sessions）；Run 级会话归属见 POST /api/ai/runs 的 sessionId 字段";

export async function GET() {
  return retiredAgentRouteResponse({
    route: "/api/agent/sessions",
    replacement: REPLACEMENT,
  });
}

export async function DELETE() {
  return retiredAgentRouteResponse({
    route: "/api/agent/sessions",
    replacement: REPLACEMENT,
  });
}

export async function PATCH() {
  return retiredAgentRouteResponse({
    route: "/api/agent/sessions",
    replacement: REPLACEMENT,
  });
}
