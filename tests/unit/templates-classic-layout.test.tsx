import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { emptyResumeContent } from "@/lib/resume-schema";

describe("ClassicLayout", () => {
  it("renders basics name as heading", () => {
    const c = emptyResumeContent();
    c.basics.name = "张三";
    c.experience = [{ company: "字节跳动", title: "前端工程师", start: "2022", end: "至今", location: "北京", bullets: ["主导 X 项目"] }];
    render(<ClassicLayout content={c} />);
    expect(screen.getByRole("heading", { name: "张三" })).toBeInTheDocument();
    expect(screen.getByText("字节跳动 — 前端工程师")).toBeInTheDocument();
    expect(screen.getByText("主导 X 项目")).toBeInTheDocument();
  });
});
