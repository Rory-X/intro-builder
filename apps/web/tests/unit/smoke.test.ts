import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("environment is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
