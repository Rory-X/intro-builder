import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionEditorHeader } from "@/components/editor/section-editor-header";

// 回归：用户自建模块 id 形如 custom_<时间戳>，不在 SECTION_META 表里。
// 修复前 section-editor-header 用 SECTION_META[key] 直查 + `if(!meta) return null`，
// 导致整条 header（icon/标题/折叠/按钮）消失。改用 getSectionMeta（带 fallback）后，
// 未知 key 应回退到「自定义」meta（LayoutList 图标）并正常渲染。
describe("SectionEditorHeader — 未知 sectionKey 回退", () => {
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
    // 修复前这里是 null（容器空）；修复后 header 在
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("自定义")).toBeInTheDocument();
    // fallback meta 的 LayoutList 图标渲染为 svg
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
});
