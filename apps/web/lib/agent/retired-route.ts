/**
 * 已退役 Agent 路由的统一响应（P07 任务 3）。
 *
 * ## 为什么要有这个模块
 *
 * P07 要求「旧公开 API 可短期返回明确 410 / 客户端升级提示，
 * **不能重定向到旧服务**」。三个退役路由（`/api/agent/session`、
 * `/api/agent/messages`、`/api/agent/direct-runs`）若各写一份响应，
 * 会出现文案与形状漂移 —— 而调用方需要的是一致的信号。
 *
 * 注：块注释里不能出现星号加斜杠的组合（形如 `*` 紧跟 `/`）——
 * 它会提前终止注释，让后面的中文变成裸代码并报 Invalid Character。
 * 我第一版的这行说明本身就踩了同一个坑（自指的陷阱）。
 *
 * ## 为什么用 410 而不是 404 或 503
 *
 * - **404** 无法区分「路径写错了」与「功能已下线」。调用方会去查拼写，
 *   而真实原因是版本过期。
 * - **503** 暗示「暂时不可用，稍后重试」—— 但这条路径**不会再回来**。
 *   让客户端重试一个已退役的入口是纯粹的浪费。
 * - **410 Gone** 的语义正是「这里曾经有东西，现在永久没有了」。
 *   它让客户端可以据此提示用户升级。
 *
 * ## 为什么不重定向到旧服务
 *
 * plan 明确禁止。重定向会让「旧服务无请求」这个退役信号一直达不到 ——
 * 而那是 P08 决定能否下线服务器的依据。若客户端版本过旧需要旧服务，
 * 正确做法是**它自己升级**，而不是由服务端悄悄替它续命。
 */

/** 退役路由的响应体形状。稳定契约，客户端可据此判断。 */
export type RetiredAgentRouteBody = {
  error: string;
  /** 稳定的机器可读码 —— 客户端据此分支，而不是匹配中文文案。 */
  code: "route_retired";
  /** 退役的路由路径（便于日志归类）。 */
  retiredRoute: string;
  /** 替代入口的可读说明。 */
  replacement: string;
  /** 面向用户的下一步动作。 */
  action: string;
};

/**
 * 构造退役路由的 410 响应。
 *
 * `replacement` 由调用方给出 —— 因为不同路由的替代入口不同
 * （会话 → 浮窗会话路由；消息 → `/api/ai/runs`；直连流 → `/api/ai/runs`）。
 */
export function retiredAgentRouteResponse(input: {
  route: string;
  replacement: string;
}): Response {
  const body: RetiredAgentRouteBody = {
    error: "这个接口已经下线，请升级到新的 AI 助手入口",
    code: "route_retired",
    retiredRoute: input.route,
    replacement: input.replacement,
    action: "刷新页面以使用新的 AI 助手；若仍看到此提示，请重新登录。",
  };

  return Response.json(body, {
    status: 410,
    headers: {
      /*
       * 明确标注不该缓存：退役信号必须每次都真实到达客户端，
       * 否则用户在缓存过期前会一直看到旧行为。
       */
      "Cache-Control": "no-store",
    },
  });
}
