import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import {
  TemplateSwitchPanel,
  type TemplatePanelItem,
} from "@/components/editor/template-switch-panel";
import { demoResume } from "@/lib/demo-resume";

// jsdom 缺 IntersectionObserver / ResizeObserver —— TemplateThumbnail 用到。
class MockObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = () => [];
  root = null;
  rootMargin = "";
  thresholds = [];
  constructor(_cb: unknown) {
    void _cb;
  }
}

const all: TemplatePanelItem[] = [
  { id: "professional", name: "专业", resolved: { source: "builtin", id: "professional" } },
  { id: "modern", name: "现代", resolved: { source: "builtin", id: "modern" } },
  { id: "classic", name: "经典", resolved: { source: "builtin", id: "classic" } },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof TemplateSwitchPanel>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <TemplateSwitchPanel
      favorites={[all[0]]}
      all={all}
      currentTemplateId="professional"
      pendingTemplateId={null}
      previewContent={demoResume}
      onApply={onApply}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApply, onClose };
}

describe("TemplateSwitchPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockObserver);
    vi.stubGlobal("ResizeObserver", MockObserver);
  });

  it("有收藏时渲染「已收藏」+「全部模板」两个分组", () => {
    renderPanel();
    expect(screen.getByText("已收藏")).toBeInTheDocument();
    expect(screen.getByText("全部模板")).toBeInTheDocument();
  });

  it("无收藏时不渲染「已收藏」分组，仍有「全部模板」", () => {
    renderPanel({ favorites: [] });
    expect(screen.queryByText("已收藏")).toBeNull();
    expect(screen.getByText("全部模板")).toBeInTheDocument();
  });

  it("点非当前模板调 onApply(id)", () => {
    const { onApply } = renderPanel();
    // modern 在「全部模板」里（非当前），点击应套用
    fireEvent.click(screen.getByRole("button", { name: "套用模板 现代" }));
    expect(onApply).toHaveBeenCalledWith("modern");
  });

  it("当前模板项标「使用中」且禁用（不可再点）", () => {
    const { onApply } = renderPanel();
    // professional 同时在收藏与全部，至少有一个标使用中
    const currentBtns = screen.getAllByRole("button", { name: "专业（使用中）" });
    expect(currentBtns.length).toBeGreaterThan(0);
    currentBtns.forEach((b) => expect(b).toBeDisabled());
    fireEvent.click(currentBtns[0]);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("点关闭调 onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "关闭模板面板" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("套用中（pending）时其它项禁用防连点", () => {
    const { onApply } = renderPanel({ pendingTemplateId: "modern" });
    fireEvent.click(screen.getByRole("button", { name: "套用模板 经典" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
