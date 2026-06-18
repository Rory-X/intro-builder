import { describe, expect, it } from "vitest";

import { readAgentSurface } from "@/lib/agent/surface";

describe("agent surface env switch", () => {
  it("enables the floating assistant", () => {
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "floating" })).toBe(
      "floating",
    );
  });

  it("falls back to the current panel shape by default", () => {
    expect(readAgentSurface({})).toBe("panel");
    expect(readAgentSurface({ AGENT_ASSISTANT_SURFACE: "panel" })).toBe("panel");
  });

  it("accepts the public env name as a deploy-platform fallback", () => {
    expect(
      readAgentSurface({ NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE: "floating" }),
    ).toBe("floating");
  });
});
