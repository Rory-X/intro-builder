import { retiredAgentRouteResponse } from "@/lib/agent/retired-route";

/**
 * `GET /api/agent/session` —— **已退役**。
 *
 * ## 为什么退役
 *
 * 这条路由原本签发 Agent JWT 并把请求转发给旧微服务（`apps/agent`）的
 * `/v1/session`。它在仓库里**没有任何调用方**（组件、hooks、lib 都没有引用），
 * 只有它自己的测试在调 —— 也就是说它是一条「为了演练而存在」的路径。
 *
 * P07 任务 3 要求「旧公开 API 可短期返回明确 410/客户端升级提示，
 * **不能重定向到旧服务**」。这里按 410 处理：
 *
 * - 路由本身保留（直接删会让外部调用方拿到 404，无法区分「路径错了」与
 *   「功能已下线」）；
 * - 响应体给出**替代入口**，而不是让调用方自己猜。
 *
 * ## 为什么不直接删除
 *
 * 410 是**可观察的退役信号**：运维能据此确认「确实没有流量」，
 * 而这正是 P08「旧微服务暂保留但无请求」的判据之一。
 * 直接删掉会让这个信号消失。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return retiredAgentRouteResponse({
    route: "/api/agent/session",
    replacement: "Web 侧的模型配置与会话管理（/api/agent/floating/sessions）",
  });
}
