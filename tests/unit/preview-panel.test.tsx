import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { emptyResumeContent } from "@/lib/resume-schema";

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

describe("PreviewPanel", () => {
  it("exposes an export root containing the resume article", () => {
    const content = emptyResumeContent();
    content.basics.name = "钱嘉豪";

    render(
      <PreviewPanel
        content={content}
        resolvedTemplate={{ source: "unified", id: "professional", html: '<article><slot data-bind="basics.name"></slot></article>', css: null, templateId: "professional", sectionIcons: {} }}
      />,
    );

    const exportRoot = screen.getByTestId("resume-export-preview");

    expect(exportRoot).toBeInTheDocument();
    expect(exportRoot).toHaveTextContent("钱嘉豪");
  });
});
