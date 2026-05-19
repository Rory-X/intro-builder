import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfessionalLayout } from "@/lib/templates/professional/Layout";
import { emptyResumeContent } from "@/lib/resume-schema";

vi.mock("@tiptap/html", () => ({
  generateHTML: () => "",
}));

describe("empty resume template shell", () => {
  it("shows section headings and placeholders in editor preview mode", () => {
    render(<ProfessionalLayout content={emptyResumeContent()} showEmptyPlaceholders />);

    expect(screen.getByRole("heading", { name: "工作经历" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "教育背景" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目经历" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "技能" })).toBeInTheDocument();
    expect(screen.getByText("公司名称")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "自我介绍" })).not.toBeInTheDocument();
    expect(screen.queryByText(/概括你的背景/)).not.toBeInTheDocument();
  });

  it("hides section shells when placeholders disabled (PDF/export)", () => {
    render(<ProfessionalLayout content={emptyResumeContent()} showEmptyPlaceholders={false} />);

    expect(screen.queryByRole("heading", { name: "工作经历" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "你的姓名" })).toBeInTheDocument();
  });
});
