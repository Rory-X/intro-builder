import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import {
  ResumePickerDialog,
  type PickerResume,
} from "@/components/templates/resume-picker-dialog";
import { demoResume } from "@/lib/demo-resume";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";

// jsdom 缺 IntersectionObserver / ResizeObserver —— TemplateThumbnail 用到它们。
// noop mock 让缩略图停在骨架屏（不挂载真实模板），测试只验卡片结构与选择交互。
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

const tpl: SerializableResolvedTemplate = {
  source: "unified",
  id: "professional",
  templateId: "professional",
  html: '<main><slot data-bind="basic.name"></slot></main>',
  css: null,
  sectionIcons: {},
  name: "专业",
};

const resumes: PickerResume[] = [
  { id: "r1", title: "前端工程师简历", content: demoResume, templateId: "professional", updatedLabel: "最近修改" },
  { id: "r2", title: "产品经理简历", content: demoResume, templateId: "professional", updatedLabel: "3 天前" },
];

const resumeTemplates = { professional: tpl };

function renderPicker(extra?: Partial<React.ComponentProps<typeof ResumePickerDialog>>) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const onCreateNew = vi.fn();
  render(
    <ResumePickerDialog
      open
      onOpenChange={onOpenChange}
      resumes={resumes}
      resumeTemplates={resumeTemplates}
      templateName="Abbey 蓝调"
      defaultSelectedId="r1"
      onConfirm={onConfirm}
      onCreateNew={onCreateNew}
      {...extra}
    />,
  );
  return { onConfirm, onOpenChange, onCreateNew };
}

describe("ResumePickerDialog", () => {
  it("open=false 时不渲染弹窗", () => {
    render(
      <ResumePickerDialog
        open={false}
        onOpenChange={vi.fn()}
        resumes={resumes}
        resumeTemplates={resumeTemplates}
        templateName="Abbey 蓝调"
        defaultSelectedId="r1"
        onConfirm={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("resume-picker")).toBeNull();
  });

  it("open=true 时每份简历渲染一张卡 + 显示模板名", () => {
    renderPicker();
    expect(screen.getAllByTestId("resume-picker-card")).toHaveLength(2);
    expect(document.body.textContent).toContain("Abbey 蓝调");
    expect(document.body.textContent).toContain("前端工程师简历");
    expect(document.body.textContent).toContain("产品经理简历");
  });

  it("默认选中 defaultSelectedId 那张（aria-pressed=true）", () => {
    renderPicker();
    const cards = screen.getAllByTestId("resume-picker-card");
    expect(cards[0]).toHaveAttribute("aria-pressed", "true");
    expect(cards[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("选第 2 张再点应用 → onConfirm 收到该简历 id", () => {
    const { onConfirm } = renderPicker();
    fireEvent.click(screen.getAllByTestId("resume-picker-card")[1]);
    fireEvent.click(screen.getByTestId("resume-picker-apply"));
    expect(onConfirm).toHaveBeenCalledWith("r2");
  });

  it("双击某张卡直接应用到该简历", () => {
    const { onConfirm } = renderPicker();
    fireEvent.doubleClick(screen.getAllByTestId("resume-picker-card")[1]);
    expect(onConfirm).toHaveBeenCalledWith("r2");
  });

  it("点「＋新建简历」卡触发 onCreateNew", () => {
    const { onCreateNew, onConfirm } = renderPicker();
    expect(screen.getByTestId("resume-picker-new")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("resume-picker-new"));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
