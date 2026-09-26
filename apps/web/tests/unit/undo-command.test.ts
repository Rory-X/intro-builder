import { describe, expect, it } from "vitest";
import type { SemanticOperation } from "@intro-builder/shared/schemas";
import { hashTargetValue } from "@intro-builder/shared/schemas";

import {
  buildUndoCommand,
  describeUndoPreconditionFailure,
  undoIsDestructive,
} from "@/lib/resume-mutations/undo";
import { prepareMutation } from "@/lib/resume-mutations/prepare";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";

/**
 * 条件撤销的契约（P06 任务 5）。
 *
 * plan 要求「撤销调用服务端**条件** undo，失败保留用户内容」，且验收明确：
 * 「**修改 A 后用户补技能，再撤销 A，技能仍保留**」。
 *
 * 这条把两种做法分开了：
 * - **错的**：把内容整体回退到 A 之前的状态 —— 会抹掉用户随后补的技能；
 * - **对的**：用 `inverse` 把 **A 改过的那些字段**还原，其它字段不动。
 *
 * 本文件的重点就是证明实现走的是后者。
 */

function doc(text: string) {
  return { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function content(overrides: Record<string, unknown> = {}): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    basics: { ...emptyResumeContent().basics, name: "林可", summary: "" },
    experience: [
      { id: "exp-a", company: "甲公司", title: "前端", start: "", end: "", location: "", content: doc("做甲") },
    ],
    skills: doc("Go"),
    sectionOrder: ["basics", "experience", "skills"],
    ...overrides,
  });
}

/** 用真实的 prepare 生成 inverse —— 不手写，避免与实现脱节。 */
function inverseFrom(
  before: ResumeContent,
  operations: SemanticOperation[],
  expectedRevision = 1,
): SemanticOperation[] {
  const prepared = prepareMutation({
    content: before,
    currentRevision: expectedRevision,
    expectedRevision,
    operations,
    newItemId: () => "itm-new",
    resumeRow: { title: "简历", templateId: "classic" },
  });
  if (!prepared.ok) throw new Error(`prepare 失败：${prepared.code} ${prepared.message}`);
  return prepared.inverse;
}

function setFieldOp(id: string, section: string, itemId: string, field: string, value: unknown, before: unknown): SemanticOperation {
  return {
    id,
    kind: "set_field",
    target: { section, itemId, field },
    condition: { expectedValueHash: hashTargetValue(before) },
    value,
  } as unknown as SemanticOperation;
}

describe("撤销命令构造", () => {
  it("由 inverse 构造命令，并带上 undoOf", () => {
    const before = content();
    const inverse = inverseFrom(before, [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);

    const result = buildUndoCommand({
      undoOfMutationId: "m-original",
      inverse,
      mutationId: "m-undo",
      resumeId: "resume-1",
      expectedRevision: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("预期成功");
    expect(result.command.undoOf).toBe("m-original");
    expect(result.command.mutationId).toBe("m-undo");
    expect(result.command.expectedRevision).toBe(2);
    expect(result.command.operations).toHaveLength(1);
  });

  it("**操作 id 重新生成**（复用会让提交层无法区分原操作与撤销操作）", () => {
    const inverse = inverseFrom(content(), [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);
    const result = buildUndoCommand({
      undoOfMutationId: "m-original",
      inverse,
      mutationId: "m-undo",
      resumeId: "resume-1",
      expectedRevision: 2,
    });
    if (!result.ok) throw new Error("预期成功");
    expect(result.command.operations[0].id).toBe(`${inverse[0].id}:undo`);
    expect(result.command.operations[0].id).not.toBe(inverse[0].id);
  });

  it("**幂等键必须与被撤销命令不同**（相同会被识别为重放，撤销静默失效）", () => {
    const inverse = inverseFrom(content(), [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);
    const result = buildUndoCommand({
      undoOfMutationId: "m-same",
      inverse,
      mutationId: "m-same",
      resumeId: "resume-1",
      expectedRevision: 2,
    });
    // 相同则服务端返回原回执（「什么都没发生」），用户会看到撤销「成功」但内容没变。
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("reused_mutation_id");
  });

  it("**空 inverse 一律拒绝**（静默成功会让用户以为撤掉了什么）", () => {
    const result = buildUndoCommand({
      undoOfMutationId: "m-original",
      inverse: [],
      mutationId: "m-undo",
      resumeId: "resume-1",
      expectedRevision: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("nothing_to_undo");
  });

  it("缺少撤销目标时拒绝", () => {
    const result = buildUndoCommand({
      undoOfMutationId: "",
      inverse: [setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司")],
      mutationId: "m-undo",
      resumeId: "resume-1",
      expectedRevision: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing_undo_target");
  });
});

describe("plan 验收：撤销 A 时保留之后的改动", () => {
  it("**inverse 只还原 A 改过的字段，不动其它字段**", () => {
    /*
     * 场景：A 把 experience[0].company 从「甲公司」改成「乙公司」；
     * 随后用户（B）补了技能。
     * 撤销 A 应当只把 company 还原成「甲公司」，技能保持用户补的内容。
     */
    const beforeA = content();
    const inverseA = inverseFrom(beforeA, [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);

    // A 之后的文档：company 变了，技能也变了（用户的后续改动）。
    const afterB = content({
      experience: [
        { id: "exp-a", company: "乙公司", title: "前端", start: "", end: "", location: "", content: doc("做甲") },
      ],
      skills: doc("Go、PostgreSQL"), // 用户补的技能
    });

    // 先构造撤销命令（这一步本身也要验证成功）。
    const undo = buildUndoCommand({
      undoOfMutationId: "m-a",
      inverse: inverseA,
      mutationId: "m-undo",
      resumeId: "resume-1",
      expectedRevision: 3,
    });
    if (!undo.ok) throw new Error(`撤销命令构造失败：${undo.code}`);

    // 用撤销命令在当前文档（含用户后续改动）上应用。
    const undoPrepared = prepareMutation({
      content: afterB,
      currentRevision: 3,
      expectedRevision: 3,
      operations: undo.command.operations,
      newItemId: () => "itm-new",
      resumeRow: { title: "简历", templateId: "classic" },
    });

    expect(undoPrepared.ok).toBe(true);
    if (!undoPrepared.ok) throw new Error("撤销应能应用");

    const undone = undoPrepared.nextContent as ResumeContent;
    // A 改的字段被还原。
    expect(undone.experience[0].company).toBe("甲公司");
    // **用户随后补的技能被保留** —— 这是验收的核心。
    expect(JSON.stringify(undone.skills)).toContain("PostgreSQL");
  });

  it("**条件不成立时撤销被拒**（目标在撤销前又被改过）", () => {
    const beforeA = content();
    const inverseA = inverseFrom(beforeA, [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);

    // 撤销前有人把 company 改成了「丙公司」—— inverse 的条件（期望「乙公司」）不再成立。
    const changedAgain = content({
      experience: [
        { id: "exp-a", company: "丙公司", title: "前端", start: "", end: "", location: "", content: doc("做甲") },
      ],
    });

    const prepared = prepareMutation({
      content: changedAgain,
      currentRevision: 4,
      expectedRevision: 4,
      operations: inverseA.map((op) => ({ ...op, id: `${op.id}:undo` })) as SemanticOperation[],
      newItemId: () => "itm-new",
      resumeRow: { title: "简历", templateId: "classic" },
    });

    // 必须失败 —— 否则会用旧建议覆盖用户的新输入。
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) expect(prepared.code).toBe("condition_mismatch");
  });
});

describe("破坏性撤销需要确认", () => {
  it("**撤销一次「新增」是破坏性的**（会删掉内容，UI 应二次确认）", () => {
    const inverse = inverseFrom(content(), [
      {
        id: "op-ins",
        kind: "insert_item",
        section: "experience",
        itemId: "exp-new",
        afterItemId: "exp-a",
        expectedOrderHash: hashTargetValue(["exp-a"]),
        value: { id: "exp-new", company: "丙公司" },
      } as unknown as SemanticOperation,
    ]);
    // 撤销「新增」的反操作是「删除」。
    expect(inverse.map((op) => op.kind)).toContain("delete_item");
    expect(undoIsDestructive(inverse)).toBe(true);
  });

  it("撤销一次普通字段修改不是破坏性的", () => {
    const inverse = inverseFrom(content(), [
      setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司"),
    ]);
    expect(undoIsDestructive(inverse)).toBe(false);
  });

  it("撤销一次删除是「新增」——不是破坏性的", () => {
    const inverse = inverseFrom(content(), [
      {
        id: "op-del",
        kind: "delete_item",
        target: { section: "experience", itemId: "exp-a" },
        condition: { expectedValueHash: hashTargetValue(content().experience[0]) },
      } as unknown as SemanticOperation,
    ]);
    expect(inverse.some((op) => op.kind === "insert_item")).toBe(true);
    expect(undoIsDestructive(inverse)).toBe(false);
  });
});

describe("失败说明", () => {
  it("条件不成立时明确「未覆盖你的改动」", () => {
    const message = describeUndoPreconditionFailure("condition_changed");
    expect(message).toContain("没有执行");
    expect(message).toContain("你的改动");
  });

  it("每种已知情况都有专门说明，且不含原始码", () => {
    for (const code of [
      "nothing_to_undo",
      "reused_mutation_id",
      "missing_undo_target",
      "condition_changed",
    ]) {
      const message = describeUndoPreconditionFailure(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });

  it("未知码有兜底说明（明确内容未受影响）", () => {
    const message = describeUndoPreconditionFailure("weird");
    expect(message).toContain("未受影响");
    expect(message).not.toContain("weird");
  });
});

describe("提交层返回 inverse（接线）", () => {
  it("prepare 的返回值包含 inverse（撤销链路的输入来源）", () => {
    const prepared = prepareMutation({
      content: content(),
      currentRevision: 1,
      expectedRevision: 1,
      operations: [setFieldOp("op-1", "experience", "exp-a", "company", "乙公司", "甲公司")],
      newItemId: () => "itm-new",
      resumeRow: { title: "简历", templateId: "classic" },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("预期成功");
    // inverse 非空 —— 这是撤销能工作的前提。
    expect(prepared.inverse.length).toBeGreaterThan(0);
  });

  it("无变化时 inverse 为空（没有可撤销的内容）", () => {
    const same = content();
    const prepared = prepareMutation({
      content: same,
      currentRevision: 1,
      expectedRevision: 1,
      // 写成与当前相同的值 → 不产生变更。
      operations: [setFieldOp("op-1", "experience", "exp-a", "company", "甲公司", "甲公司")],
      newItemId: () => "itm-new",
      resumeRow: { title: "简历", templateId: "classic" },
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error("预期成功");
    expect(prepared.inverse).toEqual([]);
  });
});
