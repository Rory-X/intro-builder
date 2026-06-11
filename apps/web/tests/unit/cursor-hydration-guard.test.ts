import { describe, expect, it } from "vitest";
import { removeCursorHydrationRefs } from "@/lib/cursor-hydration-guard";

describe("removeCursorHydrationRefs", () => {
  it("removes Cursor browser refs before React hydration", () => {
    document.body.innerHTML = `
      <main>
        <a data-cursor-ref="e0" href="/">intro-builder</a>
        <button data-cursor-ref="e1">登录</button>
      </main>
    `;

    removeCursorHydrationRefs(document);

    expect(document.querySelectorAll("[data-cursor-ref]")).toHaveLength(0);
  });
});
