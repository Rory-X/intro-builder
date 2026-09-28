/**
 * AI 助手的界面形态（P07 任务 3）。
 *
 * ## 为什么默认值是 floating
 *
 * 两种形态走**不同的服务端路径**，而它们的可退役性完全不同：
 *
 * | 形态 | 服务端路径 | 是否依赖旧微服务 |
 * |---|---|---|
 * | `panel` | `AgentPanel` → AG-UI runtime → `/api/agent/direct-runs` | **否**（Next.js 统一 Run，翻译成 AG-UI） |
 * | `floating` | `/api/agent/floating/chat` | 否（Web 侧直接用 AI SDK） |
 *
 * panel 不再签发 JWT，也不再把流指向独立 Agent 服务。默认仍是 floating。
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
   * 无法识别的取值按新形态（`floating`）处理。
   * 显式 `panel` 仍打开侧栏，但那条路径已经在 Next.js 里执行统一 Run。
   */
  return raw === "panel" ? "panel" : "floating";
}
