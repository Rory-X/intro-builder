import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyResumeContent, DEFAULT_STYLE_SETTINGS } from "@/lib/resume-schema";
import { ModernLayout } from "@/lib/templates/modern/Layout";

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

describe("Modern sidebar profile alignment", () => {
  it("keeps the HTML profile block centered across the visible sidebar", () => {
    const html = readFileSync(join(process.cwd(), "templates/html/modern.html"), "utf-8");
    const css = readFileSync(join(process.cwd(), "templates/html/modern.css"), "utf-8");

    expect(html).toContain('<div class="modern-profile">');
    expect(css).toContain(".modern-profile");
    expect(css).toContain("width: calc(100% + var(--page-padding));");
    expect(css).toContain("margin-left: calc(var(--page-padding) * -1);");
  });

  it("applies the same page-padding offset in the React fallback", () => {
    const content = emptyResumeContent();
    content.basics.name = "张三";
    content.basics.phone = "138 0000 0000";

    const { container } = render(
      <ModernLayout
        content={content}
        styleSettings={{ ...DEFAULT_STYLE_SETTINGS, pagePadding: 48 }}
      />,
    );

    const profile = container.querySelector("aside > div");
    const header = container.querySelector("[data-pagination-header]");

    expect(profile).toHaveStyle({
      width: "calc(100% + 48px)",
      marginLeft: "-48px",
    });
    expect(header?.className).toContain("text-center");
  });
});
