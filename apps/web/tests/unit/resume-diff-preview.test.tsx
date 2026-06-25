import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";
import { stringToDoc } from "@intro-builder/shared/types";

import { ResumeDiffPreview } from "@/components/preview/resume-diff-preview";

const versions: ResumeVersionListItem[] = [
  {
    id: "v1",
    resumeId: "r1",
    source: "agent",
    sourceLabel: "通过对话",
    actorName: "Mem",
    operationCount: 1,
    summary: "AI 修改了个人总结",
    createdAt: "2026-06-23T02:18:00.000Z",
  },
];

describe("ResumeDiffPreview", () => {
  it("renders a Chinese read-only diff toolbar and version history state", () => {
    const onClose = vi.fn();
    const onRestore = vi.fn();
    const onSelectVersion = vi.fn();

    render(
      <ResumeDiffPreview
        oldContent={emptyResumeContent()}
        newContent={emptyResumeContent()}
        viewedVersion={versions[0]}
        versions={versions}
        onClose={onClose}
        onRestore={onRestore}
        onSelectVersion={onSelectVersion}
      />,
    );

    expect(screen.getByText("正在查看历史版本，简历内容暂不可编辑")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复此版本" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭版本对比" })).toBeInTheDocument();
    expect(screen.getByText("版本历史")).toBeInTheDocument();
    expect(screen.getByText("正在查看")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭版本对比" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks added and removed resume text inside the A4 resume structure", () => {
    const oldContent = emptyResumeContent();
    oldContent.basics.name = "王小明";
    oldContent.basics.title = "产品助理";
    oldContent.summary = stringToDoc("执行力强");
    const newContent = emptyResumeContent();
    newContent.basics.name = "王小明";
    newContent.basics.title = "增长产品经理";
    newContent.summary = stringToDoc("推动实验提升转化");

    const { container } = render(
      <ResumeDiffPreview
        oldContent={oldContent}
        newContent={newContent}
        viewedVersion={versions[0]}
        versions={versions}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(screen.getByRole("article", { name: "简历版本差异预览" })).toBeInTheDocument();
    expect(container.querySelector('[data-diff-token="removed"]')).toHaveTextContent("产品助理");
    expect(container.querySelector('[data-diff-token="added"]')).toHaveTextContent("增长产品经理");
    expect(container.querySelectorAll('[data-diff-block="removed"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-diff-block="added"]').length).toBeGreaterThan(0);
  });

  it("renders added rich-text dividers without dropping the section", () => {
    const oldContent = emptyResumeContent();
    oldContent.summary = { type: "doc", content: [] };
    const newContent = emptyResumeContent();
    newContent.summary = {
      type: "doc",
      content: [{ type: "horizontalRule" }],
    };

    const { container } = render(
      <ResumeDiffPreview
        oldContent={oldContent}
        newContent={newContent}
        viewedVersion={versions[0]}
        versions={versions}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(screen.getByText("个人总结")).toBeInTheDocument();
    expect(container.querySelector('hr[data-diff-block="added"]')).toBeInTheDocument();
  });

  it("keeps ordered list numbering in rich-text diff blocks", () => {
    const oldContent = emptyResumeContent();
    oldContent.summary = { type: "doc", content: [] };
    const newContent = emptyResumeContent();
    newContent.summary = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "第一步" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const { container } = render(
      <ResumeDiffPreview
        oldContent={oldContent}
        newContent={newContent}
        viewedVersion={versions[0]}
        versions={versions}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(container.querySelector('ol[data-diff-block="added"]')).toBeInTheDocument();
    expect(container.querySelector('ol[data-diff-block="added"] li')).toHaveTextContent("第一步");
  });

  it("confirms before restoring the selected version", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onRestore = vi.fn();

    render(
      <ResumeDiffPreview
        oldContent={emptyResumeContent()}
        newContent={emptyResumeContent()}
        viewedVersion={versions[0]}
        versions={versions}
        onClose={vi.fn()}
        onRestore={onRestore}
        onSelectVersion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复此版本" }));

    expect(confirmSpy).toHaveBeenCalledWith("确定要恢复到这个历史版本吗？恢复前会把当前内容保存为一条可找回的版本记录。");
    expect(onRestore).toHaveBeenCalledWith("v1");
  });
});
