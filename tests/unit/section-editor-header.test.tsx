import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionEditorHeader } from "@/components/editor/section-editor-header";

describe("SectionEditorHeader", () => {
  it("自建 custom_xxx 仍渲染 header：显示「自定义」标题 + icon，不再 return null", () => {
    const { container } = render(
      <SectionEditorHeader
        sectionKey="custom_1780740231561"
        itemCount={0}
        isOpen
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("自定义")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("已知 sectionKey（skills）正常渲染其标题", () => {
    render(
      <SectionEditorHeader
        sectionKey="skills"
        itemCount={0}
        isOpen
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText("技能")).toBeInTheDocument();
  });

  it("新增按钮默认隐藏，悬浮 header 时出现", () => {
    render(
      <SectionEditorHeader
        sectionKey="projects"
        itemCount={1}
        isOpen
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const addButton = screen.getByRole("button", { name: "新增" });
    expect(addButton.className).toContain("opacity-0");
    expect(addButton.className).toContain("group-hover/section-header:opacity-100");
  });

  it("renders an optional helper action before the add button", () => {
    render(
      <SectionEditorHeader
        sectionKey="experience"
        itemCount={1}
        isOpen
        onToggle={vi.fn()}
        onAdd={vi.fn()}
        helper={<button type="button">AI 建议</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "AI 建议" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增" })).toBeInTheDocument();
  });
});
