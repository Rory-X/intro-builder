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
  return raw === "floating" ? "floating" : "panel";
}
