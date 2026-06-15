import { describe, expect, it } from "vitest";

import {
  applyWrite,
  createPreview,
  MAX_PREVIEW_OPERATIONS,
  plainTextToTipTapDoc,
  previewSnapshot,
  setPreviewGoal,
} from "../src/agent/preview.js";

describe("preview model", () => {
  it("records an insert operation with a TipTap doc for content fields", () => {
    const preview = createPreview({ resumeId: "r1" });
    const result = applyWrite(preview, {
      toolCallId: "t1",
      section: "experience",
      fieldPath: "experience.0.content",
      label: "工作经历",
      afterPlainText: "- 负责后端\n- 优化性能",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.operation).toBe("insert_section");
    expect(result.operation.replacementTiptapJson).toBeDefined();
    expect(preview.operations).toHaveLength(1);
  });

  it("is last-write-wins per fieldPath (update replaces prior op)", () => {
    const preview = createPreview();
    applyWrite(preview, { toolCallId: "t1", section: "skills", fieldPath: "skills", label: "技能", afterPlainText: "Go" });
    const second = applyWrite(preview, { toolCallId: "t2", section: "skills", fieldPath: "skills", label: "技能", afterPlainText: "Go, Rust" });
    expect(preview.operations).toHaveLength(1);
    expect(second.ok && second.operation.operation).toBe("update_section");
    expect(second.ok && second.operation.beforePlainText).toBe("Go");
  });

  it("rejects a disallowed fieldPath", () => {
    const preview = createPreview();
    const result = applyWrite(preview, { toolCallId: "t1", section: "summary", fieldPath: "totally.invalid", label: "x", afterPlainText: "y" });
    expect(result.ok).toBe(false);
  });

  it("enforces the operation cap for new fields", () => {
    const preview = createPreview();
    for (let i = 0; i < MAX_PREVIEW_OPERATIONS; i += 1) {
      const r = applyWrite(preview, { toolCallId: `t${i}`, section: "experience", fieldPath: `experience.${i}.content`, label: `E${i}`, afterPlainText: "x" });
      expect(r.ok).toBe(true);
    }
    const overflow = applyWrite(preview, { toolCallId: "tx", section: "experience", fieldPath: "experience.99.content", label: "E99", afterPlainText: "x" });
    expect(overflow.ok).toBe(false);
  });

  it("tracks profileSummary and missingFacts in the snapshot", () => {
    const preview = createPreview({ title: "我的简历" });
    setPreviewGoal(preview, { targetRole: "后端工程师" });
    applyWrite(preview, { toolCallId: "t1", section: "summary", fieldPath: "basics.summary", label: "个人简介", afterPlainText: "三年后端经验" });
    applyWrite(preview, { toolCallId: "t2", section: "experience", fieldPath: "experience.0.content", label: "工作经历", afterPlainText: "待补充", status: "needs_user_fact" });
    const snap = previewSnapshot(preview);
    expect(snap.profileSummary).toBe("三年后端经验");
    expect(snap.targetRole).toBe("后端工程师");
    expect(snap.missingFacts).toContain("工作经历");
  });

  it("plainTextToTipTapDoc makes a bulletList when all lines are bullets", () => {
    const doc = plainTextToTipTapDoc("- a\n- b");
    expect((doc.content[0] as { type: string }).type).toBe("bulletList");
  });
});
