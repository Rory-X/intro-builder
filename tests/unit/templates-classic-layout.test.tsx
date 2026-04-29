import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { emptyResumeContent } from "@/lib/resume-schema";
import { bulletsToDoc } from "@/lib/tiptap-types";

// Mock generateHTML since we're in jsdom without full TipTap server setup
vi.mock("@tiptap/html", () => ({
  generateHTML: (json: Record<string, unknown>) => {
    const texts: string[] = [];
    function walk(node: Record<string, unknown>) {
      if (node.text) texts.push(node.text as string);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    if (json?.content && Array.isArray(json.content)) json.content.forEach(walk);
    return texts.map((t: string) => `<p>${t}</p>`).join("");
  },
}));

describe("ClassicLayout", () => {
  it("renders basics name as heading and experience content", () => {
    const c = emptyResumeContent();
    c.basics.name = "张三";
    c.experience = [{
      company: "字节跳动",
      title: "前端工程师",
      start: "2022",
      end: "至今",
      location: "北京",
      content: bulletsToDoc(["主导 X 项目"]),
    }];
    render(<ClassicLayout content={c} />);
    expect(screen.getByRole("heading", { name: "张三" })).toBeInTheDocument();
    expect(screen.getByText("字节跳动 — 前端工程师")).toBeInTheDocument();
    expect(screen.getByText("主导 X 项目")).toBeInTheDocument();
  });

  it("renders photo if present", () => {
    const c = emptyResumeContent();
    c.basics.name = "测试";
    c.basics.photo = "https://example.com/photo.jpg";
    render(<ClassicLayout content={c} />);
    const img = screen.getByAltText("测试");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/photo.jpg");
  });
});
