/**
 * AI 助手的界面形态（P07 任务 3）。
 *
 * ## 为什么默认值是 floating
 *
 * 两种形态走**不同的服务端路径**，而它们的可退役性完全不同：
 *
 * | 形态 | 服务端路径 | 是否依赖旧微服务 |
 * |---|---|---|
 * | `panel` | `AgentPanel` → AG-UI runtime → `/api/agent/direct-runs` | **是**（签发 JWT + 返回 `streamUrl` 指向微服务） |
 * | `floating` | `/api/agent/floating/chat` | 否（Web 侧直接用 AI SDK） |
 *
 * 也就是说：**默认形态决定了默认用户是否还在依赖待退役的微服务**。
 *
 * 此前默认是 `panel`，于是「默认配置下 AI 助手的流量仍走待退役的服务」——
 * 退役审计（`agent-retirement-audit.test.ts`）把这个事实钉成了一条断言，
 * 而它失败的时候正是这次翻转完成的时候。
 *
 * ## 为什么可以翻转
 *
 * 浮窗一侧的前置能力已全部就绪（分流点、`runBridge`、事件翻译、
 * 内容同步、消息持久化），且 `floating/chat` 本身**不依赖微服务**。
 * 翻转后默认用户不再经过 `direct-runs`。
 *
 * 注意翻转**不等于**启用统一 Run 路由：那仍由
 * `NEXT_PUBLIC_AI_RUN_PATH` 控制（见 `run-path-flag`）。
 * 两件事刻意分开 —— 本步只把默认形态从「旧面板」换成「浮窗」，
 * 后者本身已是 Web 自足路径。
 */
export type AgentSurface = "panel" | "floating";

type AgentSurfaceEnv = {
  [key: string]: string | undefined;
  AGENT_ASSISTANT_SURFACE?: string;
  NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE?: string;
};

export function readAgentSurface(env: AgentSurfaceEnv = process.env): AgentSurface {
  const raw =
    env.AGENT_ASSISTANT_SURFACE ??
    env.NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE ??
    "";
  /*
   * 只有**显式** `panel` 才回到旧面板。
   *
   * 无法识别的取值按新形态（`floating`）处理 —— 与 `panel` 时代相反，
   * 而这是有意的：`panel` 会走 `direct-runs`（依赖待退役的微服务），
   * 拼错的开关名不该把用户留在一条正在退役的路径上。
   */
  return raw === "panel" ? "panel" : "floating";
}
