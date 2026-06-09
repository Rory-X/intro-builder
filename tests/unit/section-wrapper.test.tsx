import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SectionWrapper, useSectionDragHandle } from "@/components/editor/section-wrapper";

const draggableMock = vi.fn((config: unknown) => {
  void config;
  return () => {};
});

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (config: unknown) => draggableMock(config),
  dropTargetForElements: () => () => {},
}));

function HeaderProbe() {
  const handleRef = useSectionDragHandle();
  return (
    <div ref={handleRef} data-testid="section-header" className="section-header">
      头部
    </div>
  );
}

describe("SectionWrapper", () => {
  it("uses the section header itself as the draggable element", () => {
    render(
      <SectionWrapper id="experience">
        <HeaderProbe />
        <div>内容</div>
      </SectionWrapper>,
    );

    const config = draggableMock.mock.calls.at(-1)?.[0] as unknown as { element: HTMLElement };
    expect(config.element).toHaveAttribute("data-testid", "section-header");
  });
});
