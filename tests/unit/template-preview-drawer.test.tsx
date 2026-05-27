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

const builtinResolved: SerializableResolvedTemplate = {
  source: "builtin",
  id: "professional",
};

describe("TemplatePreviewDrawer", () => {
  it("open=false 时不渲染抽屉内容", () => {
    const { queryByTestId } = render(
      <TemplatePreviewDrawer
        open={false}
        onOpenChange={vi.fn()}
        resolved={builtinResolved}
        content={demoResume}
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
        resolved={builtinResolved}
        content={demoResume}
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
        resolved={builtinResolved}
        content={demoResume}
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
        resolved={builtinResolved}
        content={demoResume}
        resumeId="r1"
        onApply={onApply}
      />,
    );
    fireEvent.click(getByTestId("drawer-apply"));
    expect(onApply).toHaveBeenCalled();
  });

  it("resumeId=null 时 apply 按钮 disabled + 显示提示", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={builtinResolved}
        content={demoResume}
        resumeId={null}
        onApply={vi.fn()}
      />,
    );
    const applyBtn = getByTestId("drawer-apply") as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    // 抽屉内容走 Portal，textContent 要看 document.body —— 用 screen 查全局
    expect(document.body.textContent).toMatch(/还没创建简历|建一份/);
  });

  it("isApplying=true 时按钮全部 disabled + apply 按钮显示加载文案", () => {
    const { getByTestId } = render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={builtinResolved}
        content={demoResume}
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

  it("uploaded 模板：source label 显示「上传」", () => {
    const uploadedResolved: SerializableResolvedTemplate = {
      source: "uploaded",
      id: "abbey-stub",
      template: {
        id: "abbey-stub",
        name: "Abbey Stub",
        description: "测试用上传模板",
        thumbnailUrl: null,
        decoration: null,
        layout: {
          frame: { kind: "vertical" },
          headerVariant: "professional",
          sectionTitleVariant: "professional",
          itemHeaderVariant: "professional",
          theme: { primaryColor: "#000" },
          sectionIcons: {},
        },
        customHtml: null,
        customCss: null,
      },
    };
    render(
      <TemplatePreviewDrawer
        open={true}
        onOpenChange={vi.fn()}
        resolved={uploadedResolved}
        content={demoResume}
        resumeId="r1"
        onApply={vi.fn()}
      />,
    );
    // Sheet 走 Portal，要看全局 body
    expect(document.body.textContent).toContain("上传");
    expect(document.body.textContent).toContain("Abbey Stub");
    // screen import 用法验证（避免 unused import 警告）
    expect(screen.getByTestId("drawer-apply")).toBeInTheDocument();
  });
});
