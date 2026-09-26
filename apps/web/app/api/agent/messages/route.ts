import { retiredAgentRouteResponse } from "@/lib/agent/retired-route";

/**
 * `POST /api/agent/messages` —— **已退役**。
 *
 * ## 为什么退役
 *
 * 这条路由原本签发 Agent JWT 并把 AG-UI 消息转发给旧微服务
 * （`apps/agent` 的 `/v1/agent/messages`）。它在仓库里**没有任何调用方** ——
 * 浮窗走 `/api/agent/floating/chat`，面板走 `/api/agent/direct-runs`，
 * 而它自己是第三条只被测试调用的路径。
 *
 * ## 替代入口
 *
 * 统一 Run 路由 `POST /api/ai/runs`（P04 交付）。它提供这条旧路径
 * 不具备的东西：
 *
 * - **事件落库 + 数据库分配 sequence**（旧路径不落库，刷新后无法恢复）；
 * - **幂等**（同一 `requestId` 不二次调用模型）；
 * - **写租约与 fence**（同一简历不会并发写）；
 * - **原子提交与回执**（"模型完成 ≠ 已保存"）。
 *
 * 也就是说：退役它不是「少一个入口」，而是**去掉一条不受保护的写入路径**。
 */

export const dynamic = "force-dynamic";

export async function POST() {
  return retiredAgentRouteResponse({
    route: "/api/agent/messages",
    replacement: "统一 Run 入口（POST /api/ai/runs）",
  });
}
