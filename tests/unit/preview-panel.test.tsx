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

    render(<PreviewPanel content={content} templateId="professional" />);

    const exportRoot = screen.getByTestId("resume-export-preview");
    const article = exportRoot.querySelector("article");

    expect(exportRoot).toBeInTheDocument();
    expect(article).toBeInTheDocument();
    expect(article).toHaveTextContent("钱嘉豪");
  });
});
