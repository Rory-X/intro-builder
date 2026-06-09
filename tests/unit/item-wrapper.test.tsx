import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemWrapper } from "@/components/editor/item-wrapper";

const draggableMock = vi.fn((config: unknown) => {
  void config;
  return () => {};
});

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: (config: unknown) => draggableMock(config),
  dropTargetForElements: () => () => {},
}));

describe("ItemWrapper", () => {
  it("uses the collapsed item header row itself as the draggable element", () => {
    render(
      <ItemWrapper
        id="item-1"
        sectionKey="experience"
        collapsible
        summary={<span>腾讯</span>}
      >
        <div>内容</div>
      </ItemWrapper>,
    );

    const config = draggableMock.mock.calls.at(-1)?.[0] as unknown as { element: HTMLElement; dragHandle?: HTMLElement };
    expect(config.element.tagName).toBe("DIV");
    expect(config.element.className).toContain("cursor-grab");
    expect(config.dragHandle).toBeUndefined();
  });
});
