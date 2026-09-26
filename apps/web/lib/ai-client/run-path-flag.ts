/**
 * 客户端可见的切流开关（P07 任务 3）。
 *
 * ## 为什么需要它
 *
 * 服务端侧的 `AI_RUN_ROUTE_ENABLED`（`lib/ai/run-route-flag.ts`）决定
 * `/api/ai/runs` 是否可执行，但它是**服务端私有**变量 —— 浏览器读不到。
 * 因此浮窗无法据此决定「走新路径还是旧路径」。
 *
 * 切流需要一个**客户端能看见**的信号，否则只能：
 * - 一次性硬切（所有用户立即切换），风险最高；或
 * - 客户端盲试新路径、靠 503 回退（多一次失败请求，且用户会看到闪烁）。
 *
 * ## 与服务端开关的关系（关键）
 *
 * 两者必须**同时开启**新路径才真正可用：
 *
 * | 客户端 | 服务端 | 结果 |
 * |---|---|---|
 * | on | on | 正常走新路径 |
 * | off | on | 走旧路径（新路径闲置） |
 * | on | off | **请求 503** —— 这是危险的组合 |
 * | off | off | 走旧路径 |
 *
 * 因此本模块的 `isNewRunPathUsable` 刻意要求**显式配置**（默认 off），
 * 与服务器端开关同一策略：默认关闭，打开需要显式摩擦力。
 *
 * 部署时必须**先开服务端、再开客户端**（顺序反了会产生 503 窗口）。
 * 关闭时顺序相反。这条约束写在文档与测试里，因为它不显然。
 */

/** 客户端开关的环境（显式传入以便穷举测试）。 */
export type ClientRunPathEnv = {
  NEXT_PUBLIC_AI_RUN_PATH?: string;
  NODE_ENV?: string;
};

/** 客户端可见的环境变量名。集中一处，避免组件与文档各自拼字符串。 */
export const CLIENT_RUN_PATH_ENV = "NEXT_PUBLIC_AI_RUN_PATH";

export type ClientRunPathDecision = {
  /** 是否走新的统一 Run 路径。 */
  useNewPath: boolean;
  /** 人类可读的理由（写日志、排查「为什么还是旧行为」）。 */
  reason: string;
};

/**
 * 决定浮窗是否走新路径。
 *
 * 与 `resolveRunRouteDecision` 同一判定风格：
 * 显式 `NEXT_PUBLIC_AI_RUN_PATH=new` 才开启，其余一律旧路径（保守）。
 *
 * ## 与服务端开关的**一处刻意不同**
 *
 * 服务端开关在测试环境**恒开** —— 因为路由测试直接调 `POST`，
 * 若被开关挡住就测不到真实行为，那等于「用一个开关让测试失去意义」。
 *
 * 客户端开关**不这样做**（测试环境也默认旧路径）。理由是两者的测试对象不同：
 *
 * - 路由测试的对象是**一条路由**，它只有一个「开启」的正确状态；
 * - 组件测试的对象是**一个组件**，它需要在**两条路径上都能被测**。
 *   若测试环境恒开新路径，那么既有那批 mock 旧路径的组件测试
 *   （`agent-panel-assistant-ui.test.tsx`，26 处旧路由 mock）会全部走新路径
 *   而失败 —— 而那批测试正是用来守护旧路径行为的。
 *
 * 因此新路径的组件测试必须**显式**设置 `NEXT_PUBLIC_AI_RUN_PATH=new`
 * （或直接注入 env 对象）。这样两条路径的覆盖都是**主动选择**的，
 * 而不是被一个「恒开」的默认值悄悄决定。
 */
export function resolveClientRunPath(
  env: ClientRunPathEnv = readClientEnv(),
): ClientRunPathDecision {
  const raw = env.NEXT_PUBLIC_AI_RUN_PATH?.trim().toLowerCase();
  if (raw === "new") {
    return { useNewPath: true, reason: `${CLIENT_RUN_PATH_ENV}=new` };
  }
  if (raw === "legacy") {
    return { useNewPath: false, reason: `${CLIENT_RUN_PATH_ENV}=legacy（显式关闭）` };
  }
  if (raw) {
    /*
     * 无法识别的取值按**旧路径**处理。
     *
     * 与 `resolveRunRouteDecision` 同一理由：拼错的开关名不该意外打开
     * 一条未验证的执行路径。而在客户端还有额外后果 —— 若客户端以为新路径
     * 可用、服务端却没开，请求会拿到 503。
     */
    return {
      useNewPath: false,
      reason: `${CLIENT_RUN_PATH_ENV}=${raw} 无法识别，按旧路径处理`,
    };
  }

  return {
    useNewPath: false,
    reason: `${CLIENT_RUN_PATH_ENV} 未设置，仍走旧链路`,
  };
}

/**
 * 读取客户端环境。
 *
 * `process.env.NEXT_PUBLIC_*` 在 Next.js 里会在**构建期**被替换为字面量，
 * 因此必须写成静态属性访问（`process.env.NEXT_PUBLIC_X`）而不是
 * `process.env[name]` —— 后者在客户端构建里不会被替换，运行时得到 undefined。
 *
 * 这是 Next.js 的一个真实陷阱：动态取值在服务端能读到，在浏览器里
 * 永远拿到 undefined，而**不会报错**。
 */
function readClientEnv(): ClientRunPathEnv {
  return {
    NEXT_PUBLIC_AI_RUN_PATH: process.env.NEXT_PUBLIC_AI_RUN_PATH,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/**
 * 两个开关的组合是否安全（即不会产生 503 窗口）。
 *
 * 用于部署前的自检与文档说明：**先开服务端、再开客户端**。
 */
export function isSwitchCombinationSafe(input: {
  clientUsesNewPath: boolean;
  serverEnabled: boolean;
}): { safe: boolean; reason: string } {
  if (input.clientUsesNewPath && !input.serverEnabled) {
    return {
      safe: false,
      reason:
        "客户端已切到新路径但服务端开关未开：请求会拿到 503。请先开服务端（AI_RUN_ROUTE_ENABLED）再开客户端（NEXT_PUBLIC_AI_RUN_PATH）。",
    };
  }
  return { safe: true, reason: "组合安全" };
}
