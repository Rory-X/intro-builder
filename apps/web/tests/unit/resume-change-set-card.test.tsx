import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SemanticOperation } from "@intro-builder/shared/schemas";

import { ResumeChangeSetCard } from "@/components/agent/resume-change-set-card";
import { buildChangeCard, type BuildChangeCardInput } from "@/lib/ai-client/change-set-card";

/**
 * 提案卡组件的用户可见行为（P06 任务 3 / 7 的 RTL 验证）。
 *
 * 投影层的契约已由 `ai-change-set-card.test.ts`（32 例，纯函数）覆盖。
 * 这里验证组件是否**如实呈现**投影，以及三条只在组件层成立的要求：
 *
 * 1. **点击定位传稳定 itemId**，不传下标；
 * 2. **冲突组在折叠时仍可见**（用投影的 `visibleGroups`，组件不自己写过滤）；
 * 3. **有依赖的项不能单独接受**（禁用勾选，而不是让用户点出必然失败的组合）。
 *
 * 另外一条是诚实性约束：**批准 ≠ 已保存** —— 卡片上不能出现「已保存」，
 * 那个事实只能来自提交回执。
 *
 * 文件名按仓库约定镜像源码（`components/agent/resume-change-set-card.tsx`
 * → `tests/unit/resume-change-set-card.test.tsx`）。plan 的验收命令里写的是
 * `ai-change-set-card.test.tsx`，那是文件命名定型之前的写法。
 */

function op(id: string, kind: SemanticOperation["kind"], extra: Record<string, unknown> = {}) {
  return { id, kind, ...extra } as unknown as SemanticOperation;
}

function setField(id: string, itemId: string, field: string, value: unknown): SemanticOperation {
  return op(id, "set_field", {
    target: { section: "experience", itemId, field },
    condition: { expectedValueHash: "a".repeat(64) },
    value,
  });
}

function insertItem(id: string, itemId: string, value: Record<string, unknown> = {}): SemanticOperation {
  return op(id, "insert_item", {
    section: "experience",
    itemId,
    afterItemId: null,
    expectedOrderHash: "b".repeat(64),
    value,
  });
}

function card(overrides: Partial<BuildChangeCardInput> = {}) {
  return buildChangeCard({
    changeSetId: "cs-1",
    proposalVersion: 1,
    title: "优化项目描述",
    summary: "让贡献更具体",
    status: "pending",
    operations: [setField("op-1", "exp-a", "content", { type: "doc", content: [] })],
    ...overrides,
  });
}

function renderCard(
  overrides: Partial<BuildChangeCardInput> = {},
  handlers: {
    onLocate?: (target: { section: string; itemId: string | null; field: string | null }) => void;
    onApply?: (ids: string[]) => void;
    onReject?: (ids: string[]) => void;
  } = {},
) {
  const onLocate = handlers.onLocate ?? vi.fn();
  const onApply = handlers.onApply ?? vi.fn();
  const onReject = handlers.onReject ?? vi.fn();
  const rendered = render(
    <ResumeChangeSetCard
      card={card(overrides)}
      onLocate={onLocate}
      onApply={onApply}
      onReject={onReject}
    />,
  );
  return { ...rendered, onLocate, onApply, onReject };
}

describe("基础呈现", () => {
  it("显示提案标题与操作项", () => {
    renderCard();
    expect(screen.getByText("优化项目描述")).toBeInTheDocument();
    expect(screen.getByText("修改正文")).toBeInTheDocument();
  });

  it("显示位置描述（用户知道改哪里）", () => {
    renderCard();
    expect(screen.getByText("工作经历")).toBeInTheDocument();
  });

  it("显示理由（来自提案 summary）", () => {
    renderCard();
    expect(screen.getByText(/让贡献更具体/)).toBeInTheDocument();
  });

  it("显示「已选 N/M」", () => {
    renderCard();
    expect(screen.getByText(/已选 0\/1/)).toBeInTheDocument();
  });

  it("**不显示「已保存」**（批准 ≠ 落盘，那个事实只能来自回执）", () => {
    const { container } = renderCard({ accepted: ["op-1"] });
    expect(screen.queryByText(/已保存/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("已保存");
  });

  it("按钮文案是「应用」而非「保存」", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "应用" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });
});

describe("点击定位用稳定 itemId", () => {
  it("点击操作项回调 onLocate，带上投影给的 target", () => {
    const { onLocate } = renderCard();
    fireEvent.click(screen.getByText("修改正文"));
    expect(onLocate).toHaveBeenCalledWith({
      section: "experience",
      itemId: "exp-a",
      field: "content",
    });
  });

  it("**定位参数不含下标**（下标在内容变化后会指向别处）", () => {
    const { onLocate } = renderCard();
    fireEvent.click(screen.getByText("修改正文"));
    const target = (onLocate as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(target).not.toHaveProperty("index");
  });
});

describe("勾选与应用", () => {
  it("勾选后「已选」计数增加，应用按钮生效", () => {
    const { onApply } = renderCard();
    fireEvent.click(screen.getByRole("checkbox", { name: /接受：修改正文/ }));
    expect(screen.getByText(/已选 1\/1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith(["op-1"]);
  });

  it("**未勾选时应用按钮禁用**（空集没东西可应用）", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
  });

  it("拒绝回传选中的操作 id", () => {
    const { onReject } = renderCard();
    fireEvent.click(screen.getByRole("checkbox", { name: /接受：修改正文/ }));
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onReject).toHaveBeenCalledWith(["op-1"]);
  });

  it("投影里已接受的操作默认处于勾选状态", () => {
    renderCard({ accepted: ["op-1"] });
    expect(screen.getByRole("checkbox", { name: /接受：修改正文/ })).toBeChecked();
  });

  it("提案已 committed 时应用按钮禁用（终态不该再让人应用）", () => {
    renderCard({ accepted: ["op-1"], status: "committed" });
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
  });
});

describe("依赖项不能单独接受（防止必然失败的组合）", () => {
  const dependent = {
    operations: [insertItem("op-insert", "exp-new"), setField("op-fill", "exp-new", "content", {})],
  };

  it("**有依赖的项勾选被禁用**", () => {
    renderCard(dependent);
    const checkboxes = screen.getAllByRole("checkbox");
    // 第一条（新增经历）可单独接受。
    expect(checkboxes[0]).not.toBeDisabled();
    // 第二条依赖它 —— 让用户点出必然被服务端拒绝的组合是更差的体验。
    expect(checkboxes[1]).toBeDisabled();
  });

  it("给出「需要一起接受」的说明（而不只是禁用）", () => {
    renderCard(dependent);
    expect(screen.getByText(/依赖上面新增的内容，需要一起接受/)).toBeInTheDocument();
  });
});

describe("冲突组在折叠时仍可见（plan 明确要求）", () => {
  const twoGroups = {
    // 刻意用不同字段：两处都写 company 会让标签都是「修改公司」，断言不唯一。
    operations: [
      setField("op-1", "exp-a", "company", "甲公司"),
      setField("op-2", "exp-b", "title", "工程师"),
    ],
  };

  it("折叠时隐藏无冲突的组，并如实说明收起数量", () => {
    renderCard(twoGroups);
    fireEvent.click(screen.getByRole("button", { name: /收起/ }));
    expect(screen.getByText(/已收起 2 组修改/)).toBeInTheDocument();
  });

  it("**冲突组折叠后仍然可见**（看不到就无法处理）", () => {
    renderCard({ ...twoGroups, conflicted: ["op-2"] });
    // 折叠前两处都在。
    expect(screen.getByText("修改公司")).toBeInTheDocument();
    expect(screen.getByText("修改职位")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /收起/ }));
    // 冲突组（修改职位）保留，非冲突组（修改公司）收起 ——
    // 且如实说明只收起了 1 组，而不是让用户以为没有别的内容。
    expect(screen.getByText(/已收起 1 组修改/)).toBeInTheDocument();
    expect(screen.getByText("修改职位")).toBeInTheDocument();
    expect(screen.queryByText("修改公司")).not.toBeInTheDocument();
    expect(screen.getByText(/需要处理的冲突/)).toBeInTheDocument();
  });

  it("冲突项显示提示文案", () => {
    renderCard({ ...twoGroups, conflicted: ["op-1"] });
    expect(screen.getByText(/已被别处修改，需要你先确认/)).toBeInTheDocument();
  });

  it("有冲突时提示必须先处理", () => {
    renderCard({ ...twoGroups, conflicted: ["op-1"], accepted: ["op-1"] });
    expect(screen.getByText(/1 处冲突未解决，处理后才可应用/)).toBeInTheDocument();
  });

  it("冲突使应用按钮禁用（即使已勾选）", () => {
    renderCard({ ...twoGroups, conflicted: ["op-1"], accepted: ["op-1"] });
    expect(screen.getByRole("button", { name: "应用" })).toBeDisabled();
  });
});

describe("不泄漏内部信息", () => {
  it("渲染结果不含字段名、JSON path、操作 id", () => {
    const { container } = renderCard();
    const html = container.innerHTML;
    // 面向用户的标签是业务语言，不含内部标识。
    expect(html).not.toContain("expectedValueHash");
    expect(html).not.toContain("exp-a");
    expect(html).not.toContain("op-1");
  });
});
