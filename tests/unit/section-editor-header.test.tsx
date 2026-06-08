import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionEditorHeader } from "@/components/editor/section-editor-header";

describe("SectionEditorHeader", () => {
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
