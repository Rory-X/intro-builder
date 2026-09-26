import { describe, expect, it } from "vitest";
import type { SemanticOperation } from "@intro-builder/shared/schemas";

import {
  buildChangeCard,
  canAcceptIndividually,
  locateOperation,
  visibleGroups,
  type BuildChangeCardInput,
} from "@/lib/ai-client/change-set-card";

/**
 * 提案卡投影的契约（P06 任务 3）。
 *
 * plan 要求「一组任务对应一张 changeSet 卡；显示具体位置、前后差异、理由、
 * 事实来源、批准/拒绝状态。点击定位稳定 itemId；生成中不偷改正文。
 * **允许依赖无关组部分接受，冲突组保持可见**」。
 *
 * 三个最容易做错的地方，各有专门断言：
 *
 * 1. **把有依赖的操作平铺**，让用户可以只接受「往新条目写内容」而拒绝「新增条目」
 *    → 产出指向不存在目标的命令。
 * 2. **按下标定位** → 内容变化后点击跳错地方。
 * 3. **把「已批准」当成「可应用」或「已保存」** → 用户以为改动生效了。
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

function build(overrides: Partial<BuildChangeCardInput> = {}) {
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

describe("基础投影", () => {
  it("按操作生成卡片项，带稳定 itemId 与位置描述", () => {
    const card = build();
    const item = card.groups[0].items[0];
    expect(item.operationId).toBe("op-1");
    // 定位用 itemId 而非下标（内容变化后下标会指向别的条目）。
    expect(item.target.itemId).toBe("exp-a");
    expect(item.target.section).toBe("experience");
    expect(item.target.field).toBe("content");
    expect(item.locationLabel).toBe("工作经历");
  });

  it("标签是业务语言（不含字段名与 JSON path）", () => {
    const card = build();
    const label = card.groups[0].items[0].label;
    expect(label).toBe("修改正文");
    expect(label).not.toContain("content");
    expect(label).not.toContain("experience");
  });

  it("提案 summary 作为理由兜底（对整组都适用）", () => {
    const card = build();
    expect(card.groups[0].items[0].rationale).toBe("让贡献更具体");
  });

  it("totalCount 反映全部操作数", () => {
    const card = build({
      operations: [
        setField("op-1", "exp-a", "company", "甲"),
        setField("op-2", "exp-a", "title", "工程师"),
        setField("op-3", "exp-b", "company", "乙"),
      ],
    });
    expect(card.totalCount).toBe(3);
  });
});

describe("依赖分组（防止接受出必然失败的组合）", () => {
  it("**insert_item 与指向新条目的 set_field 分到同一组**", () => {
    const card = build({
      operations: [
        insertItem("op-insert", "exp-new", { company: "新公司" }),
        setField("op-fill", "exp-new", "content", { type: "doc", content: [] }),
      ],
    });
    // 同一组（否则用户可以只接受「写内容」而拒绝「新增」）。
    expect(card.groups).toHaveLength(1);
    expect(card.groups[0].items).toHaveLength(2);
  });

  it("组内后续项声明依赖第一条", () => {
    const card = build({
      operations: [
        insertItem("op-insert", "exp-new"),
        setField("op-fill", "exp-new", "content", {}),
      ],
    });
    expect(card.groups[0].items[1].dependsOn).toEqual(["op-insert"]);
  });

  it("指向不同条目的操作分到不同组（真正的「依赖无关组」）", () => {
    const card = build({
      operations: [
        setField("op-1", "exp-a", "company", "甲"),
        setField("op-2", "exp-b", "company", "乙"),
      ],
    });
    expect(card.groups).toHaveLength(2);
  });

  it("**有依赖的操作不能单独接受**（UI 据此禁用单项按钮）", () => {
    const card = build({
      operations: [
        insertItem("op-insert", "exp-new"),
        setField("op-fill", "exp-new", "content", {}),
      ],
    });
    expect(canAcceptIndividually(card, "op-insert")).toBe(true);
    expect(canAcceptIndividually(card, "op-fill")).toBe(false);
  });

  it("无依赖的普通操作可单独接受", () => {
    const card = build({
      operations: [
        setField("op-1", "exp-a", "company", "甲"),
        setField("op-2", "exp-b", "company", "乙"),
      ],
    });
    expect(canAcceptIndividually(card, "op-1")).toBe(true);
    expect(canAcceptIndividually(card, "op-2")).toBe(true);
  });
});

describe("冲突组保持可见", () => {
  it("冲突标记落到组上", () => {
    const card = build({ conflicted: ["op-1"] });
    expect(card.groups[0].hasConflict).toBe(true);
    expect(card.conflicted).toContain("op-1");
  });

  it("**折叠时冲突组仍然可见**（plan 明确要求）", () => {
    const card = build({
      operations: [
        setField("op-1", "exp-a", "company", "甲"),
        setField("op-2", "exp-b", "company", "乙"),
      ],
      conflicted: ["op-2"],
    });
    const visible = visibleGroups(card, { collapsed: true });
    // 只保留有冲突的组 —— 用户必须看到它才能处理。
    expect(visible).toHaveLength(1);
    expect(visible[0].items[0].operationId).toBe("op-2");
  });

  it("不折叠时全部可见", () => {
    const card = build({
      operations: [
        setField("op-1", "exp-a", "company", "甲"),
        setField("op-2", "exp-b", "company", "乙"),
      ],
      conflicted: ["op-2"],
    });
    expect(visibleGroups(card, { collapsed: false })).toHaveLength(2);
  });

  it("冲突的操作使 canApply 为 false", () => {
    const card = build({ accepted: ["op-1"], conflicted: ["op-1"] });
    expect(card.canApply).toBe(false);
  });

  it("接受无冲突的操作时可应用", () => {
    const card = build({ accepted: ["op-1"] });
    expect(card.canApply).toBe(true);
  });
});

describe("canApply 的三个条件", () => {
  it("没有接受任何操作 → false", () => {
    expect(build().canApply).toBe(false);
  });

  it("提案已 committed → false（终态不该再让人应用）", () => {
    expect(build({ accepted: ["op-1"], status: "committed" }).canApply).toBe(false);
  });

  it("提案已 rejected → false", () => {
    expect(build({ accepted: ["op-1"], status: "rejected" }).canApply).toBe(false);
  });

  it("部分提交状态下仍可应用剩余项", () => {
    expect(build({ accepted: ["op-1"], status: "partially_committed" }).canApply).toBe(true);
  });

  it("批准 **不等于** 已保存 —— canApply 只表达「可以提交」", () => {
    const card = build({ accepted: ["op-1"] });
    // 卡片上没有「已保存」字段：那个事实只能来自提交回执。
    expect(card).not.toHaveProperty("saved");
    expect(card).not.toHaveProperty("committed");
  });
});

describe("点击定位用稳定 itemId", () => {
  it("locateOperation 返回 section/itemId/field", () => {
    const card = build();
    expect(locateOperation(card, "op-1")).toEqual({
      section: "experience",
      itemId: "exp-a",
      field: "content",
    });
  });

  it("找不到时返回 null（不猜一个位置）", () => {
    expect(locateOperation(build(), "op-nope")).toBeNull();
  });

  it("**定位不含下标**（下标会随内容变化指向别处）", () => {
    const card = build();
    const target = locateOperation(card, "op-1");
    expect(target).not.toHaveProperty("index");
    expect(JSON.stringify(target)).not.toContain("index");
  });
});

describe("各类操作的展示", () => {
  it("新增条目：标签说明新增到哪里", () => {
    const card = build({ operations: [insertItem("op-1", "exp-new", { company: "甲公司" })] });
    expect(card.groups[0].items[0].label).toBe("新增一条工作经历");
    expect(card.groups[0].items[0].after).toBe("甲公司");
  });

  it("删除条目：明说是删除（破坏性操作要醒目）", () => {
    const card = build({
      operations: [
        op("op-1", "delete_item", {
          target: { section: "experience", itemId: "exp-a" },
          condition: { expectedValueHash: "c".repeat(64) },
        }),
      ],
    });
    expect(card.groups[0].items[0].label).toContain("删除");
  });

  it("重排：展示前后顺序", () => {
    const card = build({
      operations: [
        op("op-1", "reorder_items", {
          section: "experience",
          beforeIds: ["exp-a", "exp-b"],
          afterIds: ["exp-b", "exp-a"],
        }),
      ],
    });
    const item = card.groups[0].items[0];
    expect(item.label).toBe("调整工作经历顺序");
    expect(item.before).toBe("exp-a、exp-b");
    expect(item.after).toBe("exp-b、exp-a");
  });

  it("模块顺序：标签是「模块顺序」而非某个区块", () => {
    const card = build({
      operations: [
        op("op-1", "set_section_order", {
          before: ["basics", "experience"],
          after: ["basics", "projects", "experience"],
        }),
      ],
    });
    expect(card.groups[0].items[0].locationLabel).toBe("模块顺序");
  });

  it("样式：展示改变的键（不展示全部样式 JSON）", () => {
    const card = build({
      operations: [op("op-1", "set_style", { before: { fontSize: 12 }, patch: { fontSize: 14 } })],
    });
    expect(card.groups[0].items[0].label).toBe("调整排版");
    expect(card.groups[0].items[0].after).toBe("fontSize");
  });

  it("标题与模板各成一项", () => {
    const card = build({
      operations: [
        op("op-1", "set_title", { before: "旧", after: "新" }),
        op("op-2", "set_template", { before: "classic", after: "modern", resetStyle: false }),
      ],
    });
    expect(card.groups[0].items[0].label).toBe("修改简历标题");
    expect(card.groups[1].items[0].label).toBe("更换模板");
  });

  it("**富文本值渲染成纯文本，不把 TipTap JSON 塞给用户**", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "做订单接口优化" }] }],
    };
    const card = build({ operations: [setField("op-1", "exp-a", "content", doc)] });
    const after = card.groups[0].items[0].after;
    expect(after).toBe("做订单接口优化");
    expect(after).not.toContain("paragraph");
    expect(after).not.toContain("doc");
  });

  it("技术栈数组渲染成顿号分隔", () => {
    const card = build({
      operations: [setField("op-1", "proj-a", "stack", ["React", "TypeScript"])],
    });
    expect(card.groups[0].items[0].after).toBe("React、TypeScript");
  });
});

describe("批准/拒绝状态如实反映", () => {
  it("accepted / rejected 原样保留", () => {
    const card = build({ accepted: ["op-1"], rejected: ["op-2"] });
    expect(card.accepted).toEqual(["op-1"]);
    expect(card.rejected).toEqual(["op-2"]);
  });

  it("提案版本带出（决策必须绑定版本）", () => {
    expect(build({ proposalVersion: 3 }).proposalVersion).toBe(3);
  });
});
