import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfessionalLayout } from "@/lib/templates/professional/Layout";
import { emptyResumeContent } from "@/lib/resume-schema";
import { bulletsToDoc } from "@/lib/tiptap-types";

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

describe("ProfessionalLayout", () => {
  it("renders name, title, contact, experience, and custom section", () => {
    const c = emptyResumeContent();
    c.basics.name = "李四";
    c.basics.title = "后端工程师";
    c.basics.phone = "13800000000";
    c.experience = [{
      company: "腾讯",
      title: "高级工程师",
      start: "2021",
      end: "至今",
      location: "深圳",
      content: bulletsToDoc(["负责核心服务"]),
    }];
    c.custom = [{
      id: "awards-1",
      title: "荣誉奖项",
      content: bulletsToDoc(["优秀员工"]),
    }];
    c.sectionOrder = ["basics", "experience", "awards-1", "education", "projects", "skills"];

    render(<ProfessionalLayout content={c} />);

    expect(screen.getByRole("heading", { name: "李四" })).toBeInTheDocument();
    expect(screen.getByText("后端工程师")).toBeInTheDocument();
    expect(screen.getByText("13800000000")).toBeInTheDocument();
    expect(screen.getByText("腾讯")).toBeInTheDocument();
    expect(screen.getByText("高级工程师")).toBeInTheDocument();
    expect(screen.getByText("负责核心服务")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "荣誉奖项" })).toBeInTheDocument();
    expect(screen.getByText("优秀员工")).toBeInTheDocument();
  });

  it("uses light resume paper root", () => {
    const { container } = render(<ProfessionalLayout content={emptyResumeContent()} />);
    const article = container.querySelector("article");
    expect(article).toHaveClass("bg-white", "text-black");
  });
});
