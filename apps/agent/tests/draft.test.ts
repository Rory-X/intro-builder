import { describe, expect, it } from "vitest";

import { validateAgentToolOutput } from "../src/agent-tools";
import {
  createDraft,
  draftSnapshot,
  draftToChangeSet,
  setGoal,
  upsertSection,
} from "../src/workflows/draft";

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
});
