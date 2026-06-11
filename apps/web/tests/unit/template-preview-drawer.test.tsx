import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { TemplatePreviewDrawer } from "@/components/templates/template-preview-drawer";
import { demoResume } from "@/lib/demo-resume";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

// jsdom 缺 IntersectionObserver / ResizeObserver —— TemplateThumbnail 在抽屉
// 内部用了它们；用 minimal mock 让它们 noop（forceMount 路径不依赖
// IntersectionObserver 触发，但构造函数还是会被调用）。
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

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockObserver);
  vi.stubGlobal("ResizeObserver", MockObserver);
});

const dbResolved: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  html: '<div><slot data-bind="basic.name"></slot></div>',
  css: null,
  templateId: "professional",
  sectionIcons: {},
  name: "专业",
  description: "单栏清晰",
  category: "tech",
  features: ["清晰单栏", "适合互联网求职", "ATS 友好"],
};

describe("TemplatePreviewDrawer", () => {
  it("open=false 时不渲染抽屉内容", () => {
    const { queryByTestId } = render(
      <TemplatePreviewDrawer
        open={false}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    expect(queryByTestId("drawer-apply")).toBeNull();
  });

  it("open=true 时渲染 apply / cancel 按钮", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    expect(getByTestId("drawer-apply")).toBeInTheDocument();
    expect(getByTestId("drawer-cancel")).toBeInTheDocument();
  });

  it("点击 cancel 调 onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={onOpenChange}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    fireEvent.click(getByTestId("drawer-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("点击 apply 调 onApply 回调", () => {
    const onApply = vi.fn();
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={onApply}
      />,
    );
    fireEvent.click(getByTestId("drawer-apply"));
    expect(onApply).toHaveBeenCalled();
  });

  it("resumeCount=0 时 apply 按钮可点且文案为「用此模板新建简历」", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId={null}
        resumeCount={0}
        onApply={vi.fn()}
      />,
    );
    const applyBtn = getByTestId("drawer-apply") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);
    expect(applyBtn.textContent).toMatch(/用此模板新建简历/);
  });

  it("isApplying=true 时按钮全部 disabled + apply 按钮显示加载文案", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        isApplying
        onApply={vi.fn()}
      />,
    );
    const applyBtn = getByTestId("drawer-apply") as HTMLButtonElement;
    const cancelBtn = getByTestId("drawer-cancel") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);
    expect(applyBtn.textContent).toMatch(/正在应用/);
  });

  it("显示 DB 模板名", () => {
    const unifiedResolved: SerializableResolvedTemplate = {
      source: "unified",
      id: "abbey-stub",
      html: '<div><slot data-bind="basic.name"></slot></div>',
      css: null,
      templateId: "abbey-stub",
      sectionIcons: {},
      name: "Abbey Stub",
    };
    render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={unifiedResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    // Sheet 走 Portal，要看全局 body
    expect(document.body.textContent).toContain("Abbey Stub");
    // screen import 用法验证（避免 unused import 警告）
    expect(screen.getByTestId("drawer-apply")).toBeInTheDocument();
  });

  it("resumeCount>1 时 apply 按钮文案为「应用到简历…」", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        resumeCount={3}
        onApply={vi.fn()}
      />,
    );
    expect(getByTestId("drawer-apply").textContent).toMatch(/应用到简历/);
  });

  it("不传 onToggleFavorite 时不渲染收藏控件（向后兼容）", () => {
    const { queryByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    expect(queryByTestId("drawer-favorite")).toBeNull();
  });

  it("传 onToggleFavorite 时渲染收藏控件，点击调用回调", () => {
    const onToggleFavorite = vi.fn();
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
        isFavorited={false}
        onToggleFavorite={onToggleFavorite}
      />,
    );
    const favBtn = getByTestId("drawer-favorite");
    expect(favBtn.textContent).toMatch(/收藏/);
    fireEvent.click(favBtn);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  });

  it("isFavorited=true 时收藏控件显示「已收藏」", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={dbResolved}
        demoContent={demoResume}
        userContent={null}
        resumeId="r1"
        onApply={vi.fn()}
        isFavorited
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(getByTestId("drawer-favorite").textContent).toMatch(/已收藏/);
  });
});
