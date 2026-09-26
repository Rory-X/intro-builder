import { describe, it, expect } from "vitest";
import {
  MutationCommand,
  SemanticOperation,
  hashTargetValue,
  type SemanticOperation as Op,
} from "@intro-builder/shared/schemas";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";

import { prepareMutation } from "@/lib/resume-mutations/prepare";
import type { ResumeOperation as LegacyResumeOperation } from "@intro-builder/shared/types";

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/** 两条经历 A、B。A 在前。测试全部围绕「A 的建议不能写进 B」。 */
function contentAB(): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    experience: [
      { id: "A", company: "甲公司", title: "前端", start: "2020", end: "2021", location: "", content: doc("做甲") },
      { id: "B", company: "乙公司", title: "后端", start: "2021", end: "2022", location: "", content: doc("做乙") },
    ],
    sectionOrder: ["basics", "experience"],
  });
}

function setCompany(id: string, value: string, expected: string): Op {
  return {
    id: `op-${id}`,
    kind: "set_field",
    target: { section: "experience", itemId: id, field: "company" },
    condition: { expectedValueHash: hashTargetValue(expected) },
    value,
  };
}

const newItemId = () => "itm_generated";

describe("prepare：happy path", () => {
  it("条件满足时应用字段更新并给出真实前后值", () => {
    const content = contentAB();
    const result = prepareMutation({
      content,
      currentRevision: 3,
      expectedRevision: 3,
      operations: [setCompany("A", "甲公司（改）", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.changed).toBe(true);
    expect(result.nextContent.experience[0].company).toBe("甲公司（改）");
    expect(result.changes[0].before).toBe("甲公司");
    expect(result.changes[0].after).toBe("甲公司（改）");
  });

  it("原样重复提交返回 no-op（changed=false），不产生空修订", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 3,
      expectedRevision: 3,
      operations: [setCompany("A", "甲公司", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.changed).toBe(false);
    expect(result.inverse).toEqual([]);
  });
});

describe("prepare：F03 提案与重排竞争（必须失败，不能误改）", () => {
  it("A/B 重排后，旧提案仍按 ID 定位到 A；绝不修改 B", () => {
    // 提案基于「A 在前」生成……
    const proposal = setCompany("A", "甲公司（改）", "甲公司");

    // ……期间用户把 B 拖到最前。
    const reordered = ResumeContent.parse({
      ...contentAB(),
      experience: [contentAB().experience[1], contentAB().experience[0]],
    });

    const result = prepareMutation({
      content: reordered,
      currentRevision: 3,
      expectedRevision: 3,
      operations: [proposal],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });

    // 提案条件针对 A 的 company；重排不改变 A 的 company，因此这里应当**成功**，
    // 而且必须改到 A（现在下标 1），绝不能改到 B（现在下标 0）。
    if (!result.ok) throw new Error(result.message);
    const byId = new Map(result.nextContent.experience.map((e) => [e.id, e.company]));
    expect(byId.get("A")).toBe("甲公司（改）");
    expect(byId.get("B")).toBe("乙公司");
  });

  it("重排且 A 的字段已被手改时，旧提案冲突", () => {
    const proposal = setCompany("A", "甲公司（改）", "甲公司");
    const edited = ResumeContent.parse({
      ...contentAB(),
      experience: [
        { ...contentAB().experience[0], company: "用户手改" },
        contentAB().experience[1],
      ],
    });
    const result = prepareMutation({
      content: edited,
      currentRevision: 4,
      expectedRevision: 3,
      operations: [proposal],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("revision_mismatch");
  });

  it("同 revision 下目标字段被改，条件哈希拦截", () => {
    const proposal = setCompany("A", "甲公司（改）", "甲公司");
    const edited = ResumeContent.parse({
      ...contentAB(),
      experience: [
        { ...contentAB().experience[0], company: "用户手改" },
        contentAB().experience[1],
      ],
    });
    const result = prepareMutation({
      content: edited,
      currentRevision: 3,
      expectedRevision: 3,
      operations: [proposal],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("condition_mismatch");
    expect(result.targets[0]).toMatchObject({ section: "experience", itemId: "A" });
  });

  it("目标条目已被删除时明确报告 target_not_found", () => {
    const deleted = ResumeContent.parse({
      ...contentAB(),
      experience: [contentAB().experience[1]],
    });
    const result = prepareMutation({
      content: deleted,
      currentRevision: 3,
      expectedRevision: 3,
      operations: [setCompany("A", "x", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("target_not_found");
  });

  it("绝不回退到下标：找不到 ID 就失败，而不是改同下标的条目", () => {
    const content = ResumeContent.parse({
      ...contentAB(),
      experience: [contentAB().experience[1]],
    });
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [setCompany("A", "甲公司（改）", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // B 仍然完好，没有被当成 A。
    expect(content.experience[0].company).toBe("乙公司");
  });
});

describe("prepare：插入 / 删除 / 排序", () => {
  it("插入使用稳定 ID 与相邻锚点，落在锚点之后", () => {
    const content = contentAB();
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-insert",
          kind: "insert_item",
          section: "experience",
          itemId: "C",
          afterItemId: "A",
          expectedOrderHash: hashTargetValue(["A", "B"]),
          value: { company: "丙公司", title: "", start: "", end: "", location: "", content: doc("做丙") },
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.nextContent.experience.map((e) => e.id)).toEqual(["A", "C", "B"]);
  });

  it("条目集合变化后插入拒绝（order_mismatch）", () => {
    const content = contentAB();
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-insert",
          kind: "insert_item",
          section: "experience",
          itemId: "C",
          afterItemId: "A",
          expectedOrderHash: hashTargetValue(["A"]),
          value: {},
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("order_mismatch");
  });

  it("删除要求整条条件匹配，否则拒绝", () => {
    const content = contentAB();
    const stale = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-del",
          kind: "delete_item",
          target: { section: "experience", itemId: "B" },
          condition: { expectedValueHash: hashTargetValue({ company: "别的东西" }) },
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(stale.ok).toBe(false);

    const ok = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-del",
          kind: "delete_item",
          target: { section: "experience", itemId: "B" },
          condition: { expectedValueHash: hashTargetValue(contentAB().experience[1]) },
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!ok.ok) throw new Error(ok.message);
    expect(ok.nextContent.experience.map((e) => e.id)).toEqual(["A"]);
  });

  it("删除条目同时把该 ID 从 sectionOrder 之外的地方正确处理（custom 场景）", () => {
    const base = emptyResumeContent();
    const content = ResumeContent.parse({
      ...base,
      custom: [{ id: "sec-1", title: "自定义一", content: doc("甲") }],
      sectionOrder: ["basics", "sec-1"],
    });
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-del",
          kind: "delete_item",
          target: { section: "custom", itemId: "sec-1" },
          condition: { expectedValueHash: hashTargetValue(content.custom[0]) },
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.nextContent.custom).toEqual([]);
  });

  it("仅交换位置时，Diff 语义是「移动」而非两条全文改写", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-reorder",
          kind: "reorder_items",
          section: "experience",
          beforeIds: ["A", "B"],
          afterIds: ["B", "A"],
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.nextContent.experience.map((e) => e.id)).toEqual(["B", "A"]);
    const changedFields = result.changes.flatMap((c) => c.targets);
    expect(changedFields).toEqual([]);
  });

  it("条目集合不一致时重排拒绝", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-reorder",
          kind: "reorder_items",
          section: "experience",
          beforeIds: ["A"],
          afterIds: ["A"],
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("order_mismatch");
  });

  it("模块顺序调整校验前置顺序", () => {
    const content = contentAB();
    const ok = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-order",
          kind: "set_section_order",
          before: ["basics", "experience"],
          after: ["experience", "basics"],
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!ok.ok) throw new Error(ok.message);
    expect(ok.nextContent.sectionOrder).toEqual(["experience", "basics"]);

    const stale = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        {
          id: "op-order",
          kind: "set_section_order",
          before: ["experience", "basics"],
          after: ["basics", "experience"],
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(stale.ok).toBe(false);
  });
});

describe("prepare：样式 / 标题 / 模板", () => {
  it("样式 patch 只合并给出的键", () => {
    const content = contentAB();
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        { id: "op-style", kind: "set_style", before: {}, patch: { fontSize: 12 } },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.nextContent.styleSettings?.fontSize).toBe(12);
  });

  it("样式前置值不符时拒绝", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        { id: "op-style", kind: "set_style", before: { fontSize: 99 }, patch: { fontSize: 12 } },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("标题与模板是行级字段，通过 rowPatch 返回而不是塞进 content", () => {
    const content = contentAB();
    const ok = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        { id: "op-title", kind: "set_title", before: "我的简历", after: "前端简历" },
        { id: "op-tpl", kind: "set_template", before: "classic", after: "modern", resetStyle: false },
      ],
      newItemId,
      resumeRow: { title: "我的简历", templateId: "classic" },
    });
    if (!ok.ok) throw new Error(ok.message);
    expect(ok.rowPatch).toEqual({ title: "前端简历", templateId: "modern", resetStyle: false });
    // 行级变更不得污染 content —— 否则「模板换了正文没换」无法被发现。
    expect((ok.nextContent as unknown as Record<string, unknown>).templateId).toBeUndefined();
    expect(ok.nextContent).toEqual(content);
  });

  it("标题前置值不符时拒绝", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 0,
      expectedRevision: 0,
      operations: [{ id: "op-title", kind: "set_title", before: "旧标题", after: "新标题" }],
      newItemId,
      resumeRow: { title: "别的标题", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("condition_mismatch");
  });

  it("同一命令里连续两次改标题，第二次能看到第一次的结果", () => {
    const result = prepareMutation({
      content: contentAB(),
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        { id: "op-1", kind: "set_title", before: "原名", after: "中间名" },
        { id: "op-2", kind: "set_title", before: "中间名", after: "最终名" },
      ],
      newItemId,
      resumeRow: { title: "原名", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.rowPatch.title).toBe("最终名");
  });
});

describe("prepare：条件撤销（inverse）", () => {
  it("生成的反向操作能把内容还原", () => {
    const content = contentAB();
    const forward = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [setCompany("A", "甲公司（改）", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!forward.ok) throw new Error(forward.message);
    expect(forward.inverse).toHaveLength(1);

    const undo = prepareMutation({
      content: forward.nextContent,
      currentRevision: 1,
      expectedRevision: 1,
      operations: forward.inverse,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!undo.ok) throw new Error(undo.message);
    expect(undo.nextContent.experience[0].company).toBe("甲公司");
  });

  it("撤销前目标被改成别的值时，撤销冲突（不会抹掉后续编辑）", () => {
    const content = contentAB();
    const forward = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [setCompany("A", "甲公司（改）", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!forward.ok) throw new Error(forward.message);

    // 撤销前用户又手改了同一个字段。
    const handEdited = ResumeContent.parse({
      ...forward.nextContent,
      experience: [
        { ...forward.nextContent.experience[0], company: "用户后来改的" },
        forward.nextContent.experience[1],
      ],
    });

    const undo = prepareMutation({
      content: handEdited,
      currentRevision: 2,
      expectedRevision: 2,
      operations: forward.inverse,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(undo.ok).toBe(false);
    if (undo.ok) return;
    expect(undo.code).toBe("condition_mismatch");
  });

  it("撤销不相交字段时，无关输入保留", () => {
    const content = contentAB();
    // 改 A 的 company
    const forward = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [setCompany("A", "甲公司（改）", "甲公司")],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!forward.ok) throw new Error(forward.message);

    // 用户补了 B 的内容（不相交）
    const withOtherEdit = ResumeContent.parse({
      ...forward.nextContent,
      skills: doc("新增技能"),
    });

    const undo = prepareMutation({
      content: withOtherEdit,
      currentRevision: 2,
      expectedRevision: 2,
      operations: forward.inverse,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!undo.ok) throw new Error(undo.message);
    expect(undo.nextContent.experience[0].company).toBe("甲公司");
    // 不相交的编辑必须还在。
    expect(undo.nextContent.skills).toEqual(doc("新增技能"));
  });
});

describe("prepare：多操作依赖与顺序", () => {
  it("插入后更新同一条目，按依赖顺序执行", () => {
    const content = contentAB();
    const result = prepareMutation({
      content,
      currentRevision: 0,
      expectedRevision: 0,
      operations: [
        // 故意把「更新」放在「插入」前面，验证排序生效。
        {
          id: "op-update-new",
          kind: "set_field",
          target: { section: "experience", itemId: "C", field: "company" },
          condition: { expectedValueHash: hashTargetValue("") },
          value: "丙公司",
        },
        {
          id: "op-insert",
          kind: "insert_item",
          section: "experience",
          itemId: "C",
          afterItemId: "A",
          expectedOrderHash: hashTargetValue(["A", "B"]),
          value: { company: "", title: "", start: "", end: "", location: "", content: doc("做丙") },
        },
      ],
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!result.ok) throw new Error(result.message);
    const inserted = result.nextContent.experience.find((e) => e.id === "C");
    expect(inserted?.company).toBe("丙公司");
    expect(result.orderedOperationIds).toEqual(["op-insert", "op-update-new"]);
  });

  it("命令解析：MutationCommand 拒绝空 operations", () => {
    expect(
      MutationCommand.safeParse({ mutationId: "m", resumeId: "r", expectedRevision: 0, operations: [] }).success,
    ).toBe(false);
  });

  it("命令样例可被 SemanticOperation 解析（契约自洽）", () => {
    const op = setCompany("A", "x", "甲公司");
    expect(SemanticOperation.safeParse(op).success).toBe(true);
  });
});

describe("旧操作兼容映射", () => {
  it("旧下标提案在「同 revision 且条目未动」时可映射到稳定 ID", async () => {
    const { mapLegacyOperation } = await import("@/lib/resume-mutations/legacy-adapter");
    const content = contentAB();
    const legacy: LegacyResumeOperation = {
      id: "legacy-1",
      toolCallId: "tc-1",
      label: "更新公司",
      section: "experience",
      fieldPath: "experience.0.company",
      operation: "update_section",
      beforePlainText: "甲公司",
      afterPlainText: "甲公司（改）",
      changeSummary: "",
      riskFlags: [],
    };
    const result = mapLegacyOperation(legacy, {
      content,
      baseRevision: 2,
      currentRevision: 2,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].kind).toBe("set_field");
    if (result.operations[0].kind !== "set_field") return;
    expect(result.operations[0].target).toMatchObject({ section: "experience", itemId: "A" });
  });

  it("旧提案基于不同 revision 时拒绝", async () => {
    const { mapLegacyOperation } = await import("@/lib/resume-mutations/legacy-adapter");
    const legacy = {
      id: "legacy-1",
      toolCallId: "tc-1",
      label: "x",
      section: "experience",
      fieldPath: "experience.0.company",
      operation: "update_section",
      beforePlainText: "甲公司",
      afterPlainText: "x",
      changeSummary: "",
      riskFlags: [],
    } satisfies LegacyResumeOperation;
    const result = mapLegacyOperation(legacy, {
      content: contentAB(),
      baseRevision: 1,
      currentRevision: 2,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("revision_mismatch");
  });

  it("旧下标越界（条目已被删）时拒绝，不猜 ID", async () => {
    const { mapLegacyOperation } = await import("@/lib/resume-mutations/legacy-adapter");
    const legacy = {
      id: "legacy-1",
      toolCallId: "tc-1",
      label: "x",
      section: "experience",
      fieldPath: "experience.5.company",
      operation: "update_section",
      beforePlainText: "",
      afterPlainText: "x",
      changeSummary: "",
      riskFlags: [],
    } satisfies LegacyResumeOperation;
    const result = mapLegacyOperation(legacy, {
      content: contentAB(),
      baseRevision: 0,
      currentRevision: 0,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("stale");
    expect(result.message).toContain("重新生成");
  });

  it("旧 itemOrder 用下标表达时，映射为按 ID 的 reorder", async () => {
    const { mapLegacyOperation } = await import("@/lib/resume-mutations/legacy-adapter");
    const legacy = {
      id: "legacy-reorder",
      toolCallId: "tc-1",
      label: "排序",
      section: "experience",
      fieldPath: "experience",
      operation: "reorder_items",
      beforePlainText: "",
      afterPlainText: "",
      itemOrder: [1, 0],
      changeSummary: "",
      riskFlags: [],
    } satisfies LegacyResumeOperation;
    const result = mapLegacyOperation(legacy, {
      content: contentAB(),
      baseRevision: 0,
      currentRevision: 0,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operations[0]).toMatchObject({ kind: "reorder_items", afterIds: ["B", "A"] });
  });

  it("旧 itemOrder 条目集合不符时拒绝", async () => {
    const { mapLegacyOperation } = await import("@/lib/resume-mutations/legacy-adapter");
    const legacy = {
      id: "legacy-reorder",
      toolCallId: "tc-1",
      label: "排序",
      section: "experience",
      fieldPath: "experience",
      operation: "reorder_items",
      beforePlainText: "",
      afterPlainText: "",
      itemOrder: [0],
      changeSummary: "",
      riskFlags: [],
    } satisfies LegacyResumeOperation;
    const result = mapLegacyOperation(legacy, {
      content: contentAB(),
      baseRevision: 0,
      currentRevision: 0,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("旧提案重放判定：过期内容不可重放", async () => {
    const { isLegacyProposalReplayable } = await import("@/lib/resume-mutations/legacy-adapter");
    const legacy = [
      {
        id: "legacy-1",
        toolCallId: "tc-1",
        label: "x",
        section: "experience",
        fieldPath: "experience.0.company",
        operation: "update_section",
        beforePlainText: "",
        afterPlainText: "x",
        changeSummary: "",
        riskFlags: [],
      },
    ] satisfies LegacyResumeOperation[];
    expect(
      isLegacyProposalReplayable(legacy, {
        content: contentAB(),
        baseRevision: 0,
        currentRevision: 0,
        newItemId,
      }),
    ).toBe(true);
    expect(
      isLegacyProposalReplayable(legacy, {
        content: contentAB(),
        baseRevision: 0,
        currentRevision: 1,
        newItemId,
      }),
    ).toBe(false);
  });

  it("映射后的命令能把旧提案真正写进正确的条目（端到端：映射 → prepare）", async () => {
    const { mapLegacyOperations } = await import("@/lib/resume-mutations/legacy-adapter");
    const content = contentAB();
    const mapped = mapLegacyOperations(
      [
        {
          id: "legacy-1",
          toolCallId: "tc-1",
          label: "x",
          section: "experience",
          fieldPath: "experience.1.company",
          operation: "update_section",
          beforePlainText: "乙公司",
          afterPlainText: "乙公司（改）",
          changeSummary: "",
          riskFlags: [],
        },
      ],
      { content, baseRevision: 0, currentRevision: 0, newItemId, resumeRow: { title: "", templateId: "" } },
    );
    if (!mapped.ok) throw new Error(mapped.message);

    // 用户重排后再提交：仍必须改到原来的「乙」。
    const reordered = ResumeContent.parse({
      ...content,
      experience: [content.experience[1], content.experience[0]],
    });
    const prepared = prepareMutation({
      content: reordered,
      currentRevision: 0,
      expectedRevision: 0,
      operations: mapped.operations,
      newItemId,
      resumeRow: { title: "", templateId: "" },
    });
    if (!prepared.ok) throw new Error(prepared.message);
    const byId = new Map(prepared.nextContent.experience.map((e) => [e.id, e.company]));
    expect(byId.get("B")).toBe("乙公司（改）");
    expect(byId.get("A")).toBe("甲公司");
  });
});
