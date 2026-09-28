import { describe, expect, it } from "vitest";

import { readAgentSurface } from "@/lib/agent/surface";

describe("agent surface env switch", () => {
  it("enables the floating assistant", () => {
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "floating" })).toBe(
      "floating",
    );
  });

  it("**默认是 floating**（P07 任务 3 翻转）", () => {
    /*
     * 默认是 floating。panel 仍可显式打开，它的 `/api/agent/direct-runs`
     * 现在也在 Next.js 里执行统一 Run。
     */
    expect(readAgentSurface({})).toBe("floating");
  });

  it("**只有显式 panel 才回到旧面板**", () => {
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "panel" })).toBe("panel");
  });

  it("accepts the public env name as a deploy-platform fallback", () => {
    expect(
      readAgentSurface({ NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE: "floating" }),
    ).toBe("floating");
  });
});
