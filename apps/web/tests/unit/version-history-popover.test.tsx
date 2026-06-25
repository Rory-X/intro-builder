import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";

import { VersionHistoryPopover } from "@/components/editor/version-history-popover";

const versions: ResumeVersionListItem[] = [
  {
    id: "v1",
    resumeId: "r1",
    source: "agent",
    sourceLabel: "通过对话",
    actorName: "Mem",
    operationCount: 1,
    summary: "AI 修改",
    createdAt: "2026-06-23T02:18:00.000Z",
  },
  {
    id: "v2",
    resumeId: "r1",
    source: "restore",
    sourceLabel: "手动恢复",
    actorName: "文希",
    operationCount: 1,
    summary: "恢复历史版本",
    createdAt: "2026-06-23T02:11:00.000Z",
  },
];

describe("VersionHistoryPopover", () => {
  it("renders Chinese version metadata and calls onSelectVersion", () => {
    const onSelectVersion = vi.fn();

    render(
      <VersionHistoryPopover
        versions={versions}
        activeVersionId="v1"
        onSelectVersion={onSelectVersion}
      />,
    );

    expect(screen.getByText("版本历史")).toBeInTheDocument();
    expect(screen.getByText("1 处修改 · Mem 通过对话")).toBeInTheDocument();
    expect(screen.getByText("正在查看")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /6 月 23 日 · 上午 10:11/ }));
    expect(onSelectVersion).toHaveBeenCalledWith("v2");
  });

  it("shows an empty state when no versions exist", () => {
    render(<VersionHistoryPopover versions={[]} onSelectVersion={vi.fn()} />);

    expect(screen.getByText("还没有版本记录")).toBeInTheDocument();
    expect(screen.getByText("Agent 修改或恢复历史版本后，会在这里留下可对比的记录。")).toBeInTheDocument();
  });
});
