import { describe, expect, it } from "vitest";

import { validateAgentToolOutput } from "../src/agent-tools";
import {
  MAX_DRAFT_OPERATIONS,
  createDraft,
  draftSnapshot,
  draftToChangeSet,
  plainTextToTipTapDoc,
  rehydrateDraft,
  setGoal,
  upsertSection,
} from "../src/workflows/draft";
import type { AgentResumeWorkspaceSnapshot } from "../src/workflows/resume-workspace";

describe("draft model", () => {
  it("starts empty with a default title", () => {
    const draft = createDraft();
    expect(draft.operations).toHaveLength(0);
    expect(draft.toolCalls).toHaveLength(0);
    expect(draftSnapshot(draft).title).toBe("新简历");
    expect(draftToChangeSet(draft, { requestId: "req_1" })).toBeNull();
  });

  it("records an insert operation + matching tool call on first write", () => {
    const draft = createDraft({ targetRole: "后端工程师" });
    const result = upsertSection(draft, {
      toolCallId: "call_1",
      section: "experience",
      fieldPath: "experience.0.content",
      label: "后端工程师 · 蜂鸟科技",
      afterPlainText: "主导订单系统 Go 重构，P99 延迟下降 42%。",
    });

    expect(result.ok).toBe(true);
    expect(draft.operations).toHaveLength(1);
    expect(draft.operations[0].operation).toBe("insert_section");
    expect(draft.operations[0].toolCallId).toBe("call_1");
    expect(draft.toolCalls).toHaveLength(1);
    expect(draft.toolCalls[0].name).toBe("resume_insert_section");
  });

  it("treats a second write to the same field path as a last-write-wins update", () => {
    const draft = createDraft();
    upsertSection(draft, {
      toolCallId: "call_1",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验。",
    });
    const second = upsertSection(draft, {
      toolCallId: "call_2",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验，擅长 Go 与云原生。",
    });

    expect(second.ok).toBe(true);
    expect(draft.operations).toHaveLength(1);
    expect(draft.operations[0].operation).toBe("update_section");
    expect(draft.operations[0].afterPlainText).toContain("云原生");
    // both tool calls are retained as visible loop history
    expect(draft.toolCalls).toHaveLength(2);
    expect(draftSnapshot(draft).profileSummary).toContain("云原生");
  });

  it("rejects a field path that is not an allowed operation target", () => {
    const draft = createDraft();
    const result = upsertSection(draft, {
      toolCallId: "call_1",
      section: "experience",
      fieldPath: "experience.evil",
      label: "x",
      afterPlainText: "y",
    });
    expect(result.ok).toBe(false);
    expect(draft.operations).toHaveLength(0);
  });

  it("rejects empty content", () => {
    const draft = createDraft();
    const result = upsertSection(draft, {
      toolCallId: "call_1",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "   ",
    });
    expect(result.ok).toBe(false);
  });

  it("builds a staged change-set whose operation ids line up", () => {
    const draft = createDraft();
    setGoal(draft, { title: "后端工程师简历" });
    upsertSection(draft, {
      toolCallId: "call_1",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验，擅长 Go 与云原生。",
    });
    upsertSection(draft, {
      toolCallId: "call_2",
      section: "skills",
      fieldPath: "skills",
      label: "技能",
      afterPlainText: "Go、Kubernetes、PostgreSQL",
    });

    const changeSet = draftToChangeSet(draft, { requestId: "req_42", now: "2026-06-15T00:00:00.000Z" });
    expect(changeSet).not.toBeNull();
    expect(changeSet!.status).toBe("staged");
    expect(changeSet!.operationIds).toEqual(draft.operations.map((op) => op.id));
    expect(changeSet!.operations).toHaveLength(2);
    expect(changeSet!.title).toContain("后端工程师简历");
  });

  it("produces tool output compatible with the existing validator", () => {
    const draft = createDraft();
    upsertSection(draft, {
      toolCallId: "call_1",
      section: "experience",
      fieldPath: "experience.0.content",
      label: "后端工程师 · 蜂鸟科技",
      afterPlainText: "用 Kubernetes 把发布回滚从 15min 降到 90s。",
    });
    upsertSection(draft, {
      toolCallId: "call_2",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验。",
    });

    const validation = validateAgentToolOutput({
      toolCalls: draft.toolCalls,
      proposedOperations: draft.operations,
    });
    expect(validation.ok).toBe(true);
  });

  it("rehydrates a draft from a stored workspace so continue keeps prior work", () => {
    const first = createDraft();
    upsertSection(first, {
      toolCallId: "call_1",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验。",
    });
    const changeSet = draftToChangeSet(first, { requestId: "req_1" })!;
    const workspace = {
      resumeId: null,
      mode: "create_from_zero",
      goal: { workflowId: "create-from-zero", resumeTitle: "后端简历", targetRole: "后端工程师", locale: "zh-CN" },
      facts: [],
      draftResume: draftSnapshot(first),
      changeSets: [changeSet],
      decisions: [],
      qualityReport: null,
      updatedAt: "2026-06-15T00:00:00.000Z",
    } as unknown as AgentResumeWorkspaceSnapshot;

    const resumed = rehydrateDraft(workspace);
    expect(resumed.operations).toHaveLength(1);
    expect(resumed.targetRole).toBe("后端工程师");
    expect(resumed.toolCalls).toHaveLength(1);

    // A new write to the same field path stays last-write-wins (no duplicate op).
    upsertSection(resumed, {
      toolCallId: "call_2",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验，擅长 Go 与云原生。",
    });
    expect(resumed.operations).toHaveLength(1);
    expect(resumed.operations[0].afterPlainText).toContain("云原生");

    // A genuinely new section is added on top of the rehydrated draft.
    upsertSection(resumed, {
      toolCallId: "call_3",
      section: "skills",
      fieldPath: "skills",
      label: "技能",
      afterPlainText: "Go、Kubernetes",
    });
    expect(resumed.operations).toHaveLength(2);
    expect(
      validateAgentToolOutput({
        toolCalls: resumed.toolCalls,
        proposedOperations: resumed.operations,
      }).ok,
    ).toBe(true);
  });

  it("attaches TipTap content for tiptap fields but not for basics.summary", () => {
    const draft = createDraft();
    upsertSection(draft, {
      toolCallId: "call_1",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "三年后端经验。",
    });
    upsertSection(draft, {
      toolCallId: "call_2",
      section: "experience",
      fieldPath: "experience.0.content",
      label: "工作经历",
      afterPlainText: "- 主导订单系统 Go 重构\n- 把回滚从 15min 降到 90s",
    });

    const summaryOp = draft.operations.find((op) => op.fieldPath === "basics.summary")!;
    const expOp = draft.operations.find((op) => op.fieldPath === "experience.0.content")!;
    expect(summaryOp.replacementTiptapJson).toBeUndefined();
    expect(expOp.replacementTiptapJson).toMatchObject({ type: "doc" });
    // bullet lines become a bulletList
    expect(JSON.stringify(expOp.replacementTiptapJson)).toContain("bulletList");
  });

  it("plainTextToTipTapDoc makes paragraphs and bullet lists", () => {
    expect(plainTextToTipTapDoc("一行文本")).toMatchObject({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    const bullets = plainTextToTipTapDoc("- a\n- b");
    expect(JSON.stringify(bullets)).toContain("bulletList");
  });

  it("enforces the draft operation cap on new fields but allows updates", () => {
    const draft = createDraft();
    // Fill up to the cap with distinct custom field paths.
    for (let i = 0; i < MAX_DRAFT_OPERATIONS; i++) {
      const result = upsertSection(draft, {
        toolCallId: `call_${i}`,
        section: "custom",
        fieldPath: `custom.${i}.content`,
        label: `自定义 ${i}`,
        afterPlainText: `内容 ${i}`,
      });
      expect(result.ok).toBe(true);
    }
    expect(draft.operations).toHaveLength(MAX_DRAFT_OPERATIONS);

    // A brand-new field is rejected past the cap...
    const overflow = upsertSection(draft, {
      toolCallId: "call_overflow",
      section: "summary",
      fieldPath: "basics.summary",
      label: "个人简介",
      afterPlainText: "溢出",
    });
    expect(overflow.ok).toBe(false);

    // ...but updating an existing field still works.
    const update = upsertSection(draft, {
      toolCallId: "call_update",
      section: "custom",
      fieldPath: "custom.0.content",
      label: "自定义 0",
      afterPlainText: "更新后的内容",
    });
    expect(update.ok).toBe(true);
    expect(draft.operations).toHaveLength(MAX_DRAFT_OPERATIONS);
  });
});
