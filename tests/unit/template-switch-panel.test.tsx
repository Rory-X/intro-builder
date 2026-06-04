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

const favorites: TemplatePanelItem[] = [
  { id: "professional", name: "专业", resolved: { source: "unified", id: "professional", html: '<div><slot data-bind="basics.name"></slot></div>', css: null, templateId: "professional", sectionIcons: {} } },
  { id: "modern", name: "现代", resolved: { source: "unified", id: "modern", html: '<div><slot data-bind="basics.name"></slot></div>', css: null, templateId: "modern", sectionIcons: {} } },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof TemplateSwitchPanel>> = {}) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <TemplateSwitchPanel
      favorites={favorites}
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

  it("只渲染收藏的模板（无「全部模板」分组）", () => {
    renderPanel();
    expect(screen.getByText("我收藏的模板")).toBeInTheDocument();
    expect(screen.queryByText("全部模板")).toBeNull();
    expect(screen.getByRole("button", { name: "套用模板 现代" })).toBeInTheDocument();
  });

  it("没有收藏时显示空状态 + 去模板库链接", () => {
    renderPanel({ favorites: [] });
    expect(screen.getByText(/还没有收藏的模板/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "模板库" });
    expect(link).toHaveAttribute("href", "/templates");
  });

  it("点非当前模板调 onApply(id)", () => {
    const { onApply } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "套用模板 现代" }));
    expect(onApply).toHaveBeenCalledWith("modern");
  });

  it("当前模板项标「使用中」且禁用", () => {
    const { onApply } = renderPanel();
    const current = screen.getByRole("button", { name: "专业（使用中）" });
    expect(current).toBeDisabled();
    fireEvent.click(current);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("点关闭调 onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "关闭模板面板" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("套用中（pending）时其它项禁用防连点", () => {
    const { onApply } = renderPanel({ pendingTemplateId: "modern" });
    fireEvent.click(screen.getByRole("button", { name: "套用模板 现代" }));
    expect(onApply).not.toHaveBeenCalled();
  });
});
