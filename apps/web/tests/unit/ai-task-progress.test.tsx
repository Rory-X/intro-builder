import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TaskProgressCard } from "@/components/agent/task-progress";
import { emptyTaskCard, type TaskCard, type TaskStep } from "@/lib/ai-client/task-projection";

/**
 * 任务卡组件的用户可见行为（P06 任务 2 / 7 的 RTL 验证）。
 *
 * 投影层的契约已由 `ai-task-projection.test.ts` 覆盖（28 例，纯函数）。
 * 这里验证的是**组件是否如实呈现投影**，以及两条只在组件层成立的约束：
 *
 * 1. **不虚构进度**：无可展示内容时不渲染（显示空卡片比不显示更糟）。
 * 2. **用户滚走时不强制拉回**：折叠状态不因步骤增加而被重置。
 *
 * 关键：组件**不得**自己判断「已保存」。那个标记必须来自投影的
 * `hasPersistedChanges`（唯一依据是 `mutation.committed` 回执）。
 */

function step(overrides: Partial<TaskStep> = {}): TaskStep {
  return {
    id: "s1",
    kind: "tool",
    label: "更新项目经历",
    status: "done",
    ...overrides,
  };
}

function card(overrides: Partial<TaskCard> = {}): TaskCard {
  return { ...emptyTaskCard(), ...overrides };
}

describe("空与待机状态：不虚构进度", () => {
  it("**无标题且无步骤时不渲染任何内容**", () => {
    const { container } = render(<TaskProgressCard card={emptyTaskCard()} />);
    expect(container.firstChild).toBeNull();
  });

  it("待机但有步骤时渲染（有真实内容就展示）", () => {
    render(<TaskProgressCard card={card({ steps: [step()] })} />);
    expect(screen.getByText("更新项目经历")).toBeInTheDocument();
  });

  it("运行中但无步骤时不渲染（投影返回 null 标题）", () => {
    const { container } = render(<TaskProgressCard card={card({ status: "running" })} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("完成与保存分开（组件的核心约束）", () => {
  it("**status=done 但无回执 → 显示「已完成」，不显示「已保存」**", () => {
    render(<TaskProgressCard card={card({ status: "done", steps: [step()] })} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("✓ 已保存")).not.toBeInTheDocument();
  });

  it("有回执 → 同时显示「已完成并保存」与「已保存」标记", () => {
    render(
      <TaskProgressCard
        card={card({ status: "done", hasPersistedChanges: true, steps: [step()] })}
      />,
    );
    expect(screen.getByText("已完成并保存")).toBeInTheDocument();
    expect(screen.getByText("✓ 已保存")).toBeInTheDocument();
  });

  it("**中断但已保存 → 显示连接中断，同时保留已保存标记**", () => {
    render(
      <TaskProgressCard
        card={card({ status: "interrupted", hasPersistedChanges: true, steps: [step()] })}
      />,
    );
    expect(screen.getByText("连接中断，未完成")).toBeInTheDocument();
    // 落盘是已发生的事实，不因断线撤销 —— 两个事实一起展示。
    expect(screen.getByText("✓ 已保存")).toBeInTheDocument();
  });
});

describe("等待用户", () => {
  it("显示问题文本（等待原因可操作）", () => {
    render(
      <TaskProgressCard
        card={card({
          status: "waiting_user",
          pendingQuestion: { questionId: "q-1", question: "这个项目的量化结果是什么？" },
          steps: [step({ kind: "question", status: "waiting" })],
        })}
      />,
    );
    expect(screen.getByText("等待你的回答")).toBeInTheDocument();
    expect(screen.getByText("这个项目的量化结果是什么？")).toBeInTheDocument();
  });
});

describe("失败的步骤", () => {
  it("显示可操作的 detail（不是原始错误码）", () => {
    render(
      <TaskProgressCard
        card={card({
          steps: [step({ status: "failed", detail: "找不到这条内容，可能已被删除" })],
        })}
      />,
    );
    expect(screen.getByText("找不到这条内容，可能已被删除")).toBeInTheDocument();
    expect(screen.queryByText(/target_not_found/)).not.toBeInTheDocument();
  });
});

describe("冲突提示", () => {
  it("有冲突时显示数量", () => {
    render(<TaskProgressCard card={card({ conflictCount: 2, steps: [step()] })} />);
    expect(screen.getByText(/2 处修改与你的编辑冲突/)).toBeInTheDocument();
  });

  it("无冲突时不显示（不显示无意义的 0）", () => {
    render(<TaskProgressCard card={card({ steps: [step()] })} />);
    expect(screen.queryByText(/冲突/)).not.toBeInTheDocument();
  });
});

describe("折叠行为（用户滚走时不强制拉回）", () => {
  it("默认展开，展示全部步骤", () => {
    render(
      <TaskProgressCard
        card={card({ steps: [step({ id: "a", label: "读取简历内容" }), step({ id: "b" })] })}
      />,
    );
    expect(screen.getByText("读取简历内容")).toBeInTheDocument();
  });

  it("可以折叠并再展开", () => {
    render(<TaskProgressCard card={card({ steps: [step()] })} />);
    const toggle = screen.getByRole("button", { name: /1 步/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("更新项目经历")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText("更新项目经历")).toBeInTheDocument();
  });

  it("**步骤增加不重置折叠状态**（否则就是把用户滚走的视图拉回来）", () => {
    const { rerender } = render(<TaskProgressCard card={card({ steps: [step()] })} />);
    fireEvent.click(screen.getByRole("button", { name: /1 步/ }));
    expect(screen.queryByText("更新项目经历")).not.toBeInTheDocument();

    // 新步骤到达 —— 折叠状态必须保持。
    rerender(
      <TaskProgressCard
        card={card({ steps: [step({ id: "a" }), step({ id: "b", label: "调整排版" })] })}
      />,
    );
    expect(screen.queryByText("更新项目经历")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2 步/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("支持默认折叠", () => {
    render(<TaskProgressCard card={card({ steps: [step()] })} defaultCollapsed />);
    expect(screen.queryByText("更新项目经历")).not.toBeInTheDocument();
  });

  it("无步骤时不显示折叠按钮", () => {
    render(<TaskProgressCard card={card({ status: "done" })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("不泄漏内部信息", () => {
  it("渲染结果不含工具名、payload 或密钥", () => {
    const { container } = render(
      <TaskProgressCard
        card={card({
          status: "done",
          hasPersistedChanges: true,
          steps: [step({ label: "更新项目经历" })],
        })}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toContain("updateProjectBlock");
    expect(html).not.toContain("apiKey");
    expect(html).not.toContain("sk-");
  });
});
