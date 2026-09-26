import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeVersionListItem } from "@/app/(app)/resume/[id]/edit/actions";

import { VersionHistoryPopover } from "@/components/editor/version-history-popover";

/**
 * 版本历史按任务聚合（P06 任务 5 的 UI 接线）。
 *
 * plan 要求「列表**按任务聚合**，展开看各 revision 和 source；
 * **单条记录能回到 task/run**」。
 *
 * 既有的 `version-history-popover.test.tsx` 覆盖扁平渲染与空状态
 * （那两条记录没有 runId，各自成组，渲染与原文一致 —— 向后兼容）。
 * 这里覆盖**新增的聚合行为**。
 */

/** 构造一条版本记录。默认无 runId（独立修改）。 */
function version(overrides: Partial<ResumeVersionListItem> = {}): ResumeVersionListItem {
  return {
    id: "v1",
    resumeId: "r1",
    source: "agent",
    sourceLabel: "通过对话",
    actorName: "Mem",
    operationCount: 1,
    summary: null,
    createdAt: "2026-06-23T02:18:00.000Z",
    revision: 1,
    runId: null,
    changeSetId: null,
    mutationId: "m-1",
    ...overrides,
  };
}

/** 同一次任务的两次提交（不同时间，同 runId）。 */
const TASK_VERSIONS: ResumeVersionListItem[] = [
  version({
    id: "t1",
    runId: "run-1",
    mutationId: "m-t1",
    summary: "更新项目描述",
    createdAt: "2026-06-23T03:00:00.000Z",
  }),
  version({
    id: "t2",
    runId: "run-1",
    mutationId: "m-t2",
    summary: "调整技能",
    createdAt: "2026-06-23T02:55:00.000Z",
  }),
];

describe("按任务聚合", () => {
  it("**同一次任务的多个版本合成一行**（不再看不出关联）", () => {
    render(<VersionHistoryPopover versions={TASK_VERSIONS} onSelectVersion={vi.fn()} />);

    // 聚合成一个可展开的组，显示提交次数。
    expect(screen.getByRole("button", { name: /2 次提交/ })).toBeInTheDocument();
    // 折叠时**不**直接展示各次提交的时间（那是展开后的事）。
    expect(screen.queryByText(/6 月 23 日 · 上午 10:55/)).not.toBeInTheDocument();
  });

  it("**展开后看到各 revision 和来源**", () => {
    render(<VersionHistoryPopover versions={TASK_VERSIONS} onSelectVersion={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /2 次提交/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    /*
     * 用子项按钮的 aria-label 定位，而不是按文本找时间。
     *
     * 组头显示的是**最新一次提交**的时间，展开后第一条子项也是同一时间 ——
     * 按文本查会命中两个元素。aria-label 带上「N 处修改」后缀，
     * 与组头的标签（带「N 次提交」）可区分。
     */
    expect(screen.getByRole("button", { name: /10:55，1 处修改/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /11:00，1 处修改/ })).toBeInTheDocument();
  });

  it("独立修改（无 runId）各自成一行，不聚合成组", () => {
    render(
      <VersionHistoryPopover
        versions={[
          version({ id: "s1", source: "manual", mutationId: "m-s1" }),
          version({
            id: "s2",
            source: "template",
            mutationId: "m-s2",
            createdAt: "2026-06-23T01:00:00.000Z",
          }),
        ]}
        onSelectVersion={vi.fn()}
      />,
    );

    // 没有「N 次提交」的组头。
    expect(screen.queryByRole("button", { name: /次提交/ })).not.toBeInTheDocument();
    // 两条都直接可见，来源标签正确（不再一律「手动保存」）。
    expect(screen.getByText(/手动保存/)).toBeInTheDocument();
    expect(screen.getByText(/更换模板/)).toBeInTheDocument();
  });

  it("混合列表：任务组与独立记录同时存在", () => {
    render(
      <VersionHistoryPopover
        versions={[...TASK_VERSIONS, version({ id: "s1", source: "manual", mutationId: "m-s1", createdAt: "2026-06-22T01:00:00.000Z" })]}
        onSelectVersion={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /2 次提交/ })).toBeInTheDocument();
    expect(screen.getByText(/手动保存/)).toBeInTheDocument();
  });
});

describe("点击定位到某次提交", () => {
  it("展开后点击某次提交回调它的版本 id", () => {
    const onSelectVersion = vi.fn();
    render(<VersionHistoryPopover versions={TASK_VERSIONS} onSelectVersion={onSelectVersion} />);

    fireEvent.click(screen.getByRole("button", { name: /2 次提交/ }));
    fireEvent.click(screen.getByRole("button", { name: /10:55，1 处修改/ }));
    expect(onSelectVersion).toHaveBeenCalledWith("t2");
  });

  it("展开后高亮正在查看的那次提交", () => {
    render(
      <VersionHistoryPopover
        versions={TASK_VERSIONS}
        activeVersionId="t2"
        onSelectVersion={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /2 次提交/ }));
    expect(screen.getByText("正在查看")).toBeInTheDocument();
  });
});

describe("回到这次对话", () => {
  it("**有 runId 的组显示「回到对话」入口**", () => {
    // 必须传 onOpenRun —— 未传时按设计不显示（见下一组断言）。
    render(
      <VersionHistoryPopover
        versions={TASK_VERSIONS}
        onSelectVersion={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "回到这次对话" })).toBeInTheDocument();
  });

  it("点击回调 runId", () => {
    const onOpenRun = vi.fn();
    render(
      <VersionHistoryPopover
        versions={TASK_VERSIONS}
        onSelectVersion={vi.fn()}
        onOpenRun={onOpenRun}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "回到这次对话" }));
    expect(onOpenRun).toHaveBeenCalledWith("run-1");
  });

  it("**未传 onOpenRun 时不显示该入口**（不给点了没反应的按钮）", () => {
    render(<VersionHistoryPopover versions={TASK_VERSIONS} onSelectVersion={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "回到这次对话" })).not.toBeInTheDocument();
  });

  it("独立记录不显示「回到对话」", () => {
    render(
      <VersionHistoryPopover
        versions={[version({ id: "s1", source: "manual", mutationId: "m-s1" })]}
        onSelectVersion={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "回到这次对话" })).not.toBeInTheDocument();
  });
});

describe("撤销入口的可撤销性", () => {
  it("**未传 onUndo 时不渲染撤销按钮**（没接线的按钮比不显示更糟）", () => {
    render(
      <VersionHistoryPopover
        versions={[version({ id: "s1", mutationId: "m-s1" })]}
        onSelectVersion={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /撤销/ })).not.toBeInTheDocument();
  });

  it("传了 onUndo 且有 mutationId 时显示撤销", () => {
    render(
      <VersionHistoryPopover
        versions={[version({ id: "s1", mutationId: "m-s1" })]}
        onSelectVersion={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /撤销/ })).toBeInTheDocument();
  });

  it("点击撤销回调版本 id", () => {
    const onUndo = vi.fn();
    render(
      <VersionHistoryPopover
        versions={[version({ id: "s1", mutationId: "m-s1" })]}
        onSelectVersion={vi.fn()}
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /撤销/ }));
    expect(onUndo).toHaveBeenCalledWith("s1");
  });

  it("**撤销记录本身不可撤销**（那是重做，属另一个功能）", () => {
    render(
      <VersionHistoryPopover
        versions={[version({ id: "u1", source: "undo", mutationId: "m-u1" })]}
        onSelectVersion={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /撤销/ })).not.toBeInTheDocument();
  });

  it("**没有 mutationId 的旧数据不可撤销**（无法构造幂等键）", () => {
    render(
      <VersionHistoryPopover
        versions={[version({ id: "s1", mutationId: null })]}
        onSelectVersion={vi.fn()}
        onUndo={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /撤销/ })).not.toBeInTheDocument();
  });
});

describe("撤销记录的可见标记", () => {
  it("组内含撤销时给出「含撤销」提示", () => {
    render(
      <VersionHistoryPopover
        versions={[
          version({ id: "t1", runId: "run-1", mutationId: "m-t1" }),
          version({
            id: "u1",
            runId: "run-1",
            source: "undo",
            mutationId: "m-u1",
            createdAt: "2026-06-23T02:00:00.000Z",
          }),
        ]}
        onSelectVersion={vi.fn()}
      />,
    );
    // 用户看到内容与记忆不符时能确认「是那次撤销」。
    expect(screen.getByText(/含撤销/)).toBeInTheDocument();
  });
});

describe("向后兼容（既有断言不变）", () => {
  it("无聚合字段的记录渲染与原文一致", () => {
    render(
      <VersionHistoryPopover
        versions={[
          version({
            id: "v2",
            source: "restore",
            sourceLabel: "手动恢复",
            actorName: "文希",
            createdAt: "2026-06-23T02:11:00.000Z",
            mutationId: "m-v2",
            // 旧数据可能完全没有这些字段。
            revision: undefined,
            runId: undefined,
            changeSetId: undefined,
          } as unknown as ResumeVersionListItem),
        ]}
        activeVersionId="v2"
        onSelectVersion={vi.fn()}
      />,
    );
    expect(screen.getByText("1 处修改 · 文希 手动恢复")).toBeInTheDocument();
    expect(screen.getByText("正在查看")).toBeInTheDocument();
  });
});
