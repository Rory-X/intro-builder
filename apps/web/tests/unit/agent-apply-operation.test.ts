import { describe, expect, it } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import type { ResumeOperation } from "@intro-builder/shared/types";

import { applyResumeOperation } from "@/lib/agent/apply-operation";

function makeOp(partial: Partial<ResumeOperation>): ResumeOperation {
  return {
    id: "op_1",
    toolCallId: "tool_1",
    label: "测试",
    section: "experience",
    fieldPath: "experience.0.content",
    operation: "insert_section",
    beforePlainText: "（空）",
    afterPlainText: "内容",
    changeSummary: "新增",
    riskFlags: [],
    ...partial,
  };
}

const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };

describe("applyResumeOperation", () => {
  it("creates a missing experience item with default fields and keeps it in order", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ fieldPath: "experience.0.content", replacementTiptapJson: doc }),
    );
    expect(result).not.toBeNull();
    expect(result!.content.experience).toHaveLength(1);
    expect(result!.content.experience[0].content).toEqual(doc);
    expect(result!.content.experience[0].company).toBe("");
    expect(result!.content.sectionOrder).toContain("experience");
  });

  it("adds a non-default section (research) to sectionOrder", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "research", fieldPath: "research.0.content", replacementTiptapJson: doc }),
    );
    expect(result!.content.research).toHaveLength(1);
    expect(result!.content.sectionOrder).toContain("research");
    expect(result!.changedKeys).toContain("sectionOrder");
  });

  it("creates a custom section item with an id and registers that id in order", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "custom", fieldPath: "custom.0.content", replacementTiptapJson: doc }),
    );
    const item = result!.content.custom[0];
    expect(typeof item.id).toBe("string");
    expect(item.id.length).toBeGreaterThan(0);
    expect(result!.content.sectionOrder).toContain(item.id);
  });

  it("sets basics.summary as a string", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "summary", fieldPath: "basics.summary", afterPlainText: "三年后端经验" }),
    );
    expect(result!.content.basics.summary).toBe("三年后端经验");
    expect(result!.changedKeys).toEqual(["basics"]);
  });

  it("sets the top-level skills TipTap field", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ section: "skills", fieldPath: "skills", replacementTiptapJson: doc }),
    );
    expect(result!.content.skills).toEqual(doc);
  });

  it("updates an existing array item in place without adding a new one", () => {
    const base = emptyResumeContent();
    base.experience = [{ company: "蜂鸟", title: "后端", start: "2021", end: "2024", location: "", content: { type: "doc", content: [] } }];
    const result = applyResumeOperation(
      base,
      makeOp({ operation: "update_section", fieldPath: "experience.0.content", replacementTiptapJson: doc }),
    );
    expect(result!.content.experience).toHaveLength(1);
    expect(result!.content.experience[0].company).toBe("蜂鸟");
    expect(result!.content.experience[0].content).toEqual(doc);
  });

  it("replaces sectionOrder for reorder_sections", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ operation: "reorder_sections", sectionOrder: ["basics", "skills", "experience"] }),
    );
    expect(result!.content.sectionOrder).toEqual(["basics", "skills", "experience"]);
    expect(result!.changedKeys).toEqual(["sectionOrder"]);
  });

  it("returns null for unsupported field paths", () => {
    const result = applyResumeOperation(
      emptyResumeContent(),
      makeOp({ operation: "delete_section", fieldPath: "experience.0", afterPlainText: "x" }),
    );
    expect(result).toBeNull();
  });
});
