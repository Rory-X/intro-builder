import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearByokConfig,
  readByokConfig,
  saveByokConfig,
} from "@/lib/agent/byok-store";

describe("byok-store", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(readByokConfig()).toBeNull();
  });

  it("round-trips a saved config (trimmed)", () => {
    saveByokConfig({
      baseUrl: " https://api.deepseek.com/v1 ",
      apiKey: " sk-123 ",
      modelName: " deepseek-chat ",
    });
    expect(readByokConfig()).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-123",
      modelName: "deepseek-chat",
    });
  });

  it("treats a partial/empty config as null (no half-configured key sent)", () => {
    window.localStorage.setItem(
      "intro-builder.agent.byok.v1",
      JSON.stringify({ baseUrl: "https://x", apiKey: "", modelName: "m" }),
    );
    expect(readByokConfig()).toBeNull();
  });

  it("clear removes the config", () => {
    saveByokConfig({ baseUrl: "https://x", apiKey: "k", modelName: "m" });
    expect(readByokConfig()).not.toBeNull();
    clearByokConfig();
    expect(readByokConfig()).toBeNull();
  });
});
