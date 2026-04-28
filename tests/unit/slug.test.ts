import { describe, it, expect } from "vitest";
import { newSlug } from "@/lib/slug";

describe("newSlug", () => {
  it("returns a 10-char url-safe string", () => {
    const s = newSlug();
    expect(s).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
  it("is unique enough across 100 calls", () => {
    const set = new Set(Array.from({ length: 100 }, () => newSlug()));
    expect(set.size).toBe(100);
  });
});
