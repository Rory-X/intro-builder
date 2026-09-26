/**
 * 新 Run 链路的灰度开关（P04 任务 8）。
 *
 * ## 为什么需要一个默认关闭的开关
 *
 * `/api/ai/runs/*` 是**服务端可达**的：任何人知道 URL 就能 `POST` 触发一次
 * 模型执行。而它目前尚未接上客户端浮窗、也还没做过真实浏览器冒烟。
 * 没有开关时，「代码合并」就等于「生产立即可达」—— 一旦新链路有问题
 * （例如某个工具的提案形状不对），影响面是全部用户，而不是被灰度到的那一小部分。
 *
 * plan 因此明确要求「服务端开关默认 legacy」。本模块把这个要求落成
 * **默认关闭、按环境显式打开**的纯函数，与 `scripts/migrate-on-deploy.ts`
 * 的 `shouldRunDeployMigrations` 保持同一范式（接收 env 对象、返回决策 + 理由），
 * 这样决策可以被单测穷举，而不是散落在路由里的 `process.env` 判断。
 *
 * ## 默认值的取舍
 *
 * 默认 **关闭**（`legacy`）。理由是「新链路未验证」这个事实本身：
 * 一个尚未冒烟的执行入口在生产可达，风险高于「功能晚一点上线」。
 * 打开必须显式设置环境变量，这是有意的摩擦力。
 *
 * 注意：**测试环境不受开关限制**。路由的单测直接调用 `POST`，
 * 若开关在测试下也默认关闭，所有路由测试会被开关挡住而不是测到真实行为 ——
 * 那等于用一个开关让测试失去意义。因此代理环境（`NODE_ENV=test`）视为已开启。
 */

/** 开关的取值。 */
export type RunRouteMode =
  /** 新链路关闭：路由返回 503，旧 floating/chat 仍是唯一入口。 */
  | "legacy"
  /** 新链路开启：路由正常执行。 */
  | "enabled";

/** 决策所依赖的环境（显式传入以便穷举测试）。 */
export type RunRouteEnv = {
  AI_RUN_ROUTE_ENABLED?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
};

/** 环境变量名。集中在一处，避免路由与文档各自拼字符串。 */
export const RUN_ROUTE_ENABLED_ENV = "AI_RUN_ROUTE_ENABLED";

export type RunRouteDecision = {
  mode: RunRouteMode;
  /** 人类可读的理由。写入日志与 503 响应，便于排查「为什么路由不工作」。 */
  reason: string;
};

/**
 * 判断新链路是否开启。
 *
 * 判定顺序刻意如此：
 *
 * 1. **测试环境恒开**。否则路由测试会被自己的开关挡住，测不到真实行为。
 * 2. 显式 `AI_RUN_ROUTE_ENABLED` 优先：接受 `1` / `true` / `yes`（大小写不敏感）
 *    开启，`0` / `false` / `no` 关闭。**不认识的值按关闭处理** ——
 *    拼错的开关名不该意外打开一条未验证的执行路径。
 * 3. 其余一律关闭（默认 legacy）。
 */
export function resolveRunRouteDecision(env: RunRouteEnv = process.env): RunRouteDecision {
  if (env.NODE_ENV === "test") {
    return { mode: "enabled", reason: "测试环境：开关不生效，以便路由测试覆盖真实行为" };
  }

  const raw = env.AI_RUN_ROUTE_ENABLED?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") {
    return { mode: "enabled", reason: `${RUN_ROUTE_ENABLED_ENV}=${raw}` };
  }
  if (raw === "0" || raw === "false" || raw === "no") {
    return { mode: "legacy", reason: `${RUN_ROUTE_ENABLED_ENV}=${raw}（显式关闭）` };
  }
  if (raw) {
    // 无法识别的取值：按关闭处理，并如实说明（不猜用户想表达什么）。
    return {
      mode: "legacy",
      reason: `${RUN_ROUTE_ENABLED_ENV}=${raw} 无法识别，按关闭处理`,
    };
  }

  return {
    mode: "legacy",
    reason: `${RUN_ROUTE_ENABLED_ENV} 未设置，新链路默认关闭（旧链路继续服务）`,
  };
}

/** 便捷判定：新链路是否开启。 */
export function isRunRouteEnabled(env: RunRouteEnv = process.env): boolean {
  return resolveRunRouteDecision(env).mode === "enabled";
}

/**
 * 关闭时返回给调用方的响应体。
 *
 * 用 **503** 而不是 404：404 会让调用方以为「这个路由不存在」而去猜路径，
 * 而真实原因是「功能被有意关闭」。503 明确表达「服务暂时不可用」，
 * 并带上理由便于排查。
 */
export function runRouteDisabledPayload(): { error: string; code: string; mode: string } {
  return {
    error: "新执行链路当前未启用",
    code: "run_route_disabled",
    mode: "legacy",
  };
}
