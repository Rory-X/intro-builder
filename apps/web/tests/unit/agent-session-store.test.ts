import { EventType, type BaseEvent } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  createInitialAgentSessionSnapshot,
  reduceAgentSessionSnapshot,
} from "@/lib/agent/session-store";

describe("agent session store", () => {
  it("creates an optimize_existing session snapshot with empty workspace state", () => {
    const snapshot = createInitialAgentSessionSnapshot({
      sessionId: "session_resume_abc",
      threadId: "thread_resume_abc",
      userId: "user_123",
      resumeId: "resume_abc",
      mode: "optimize_existing",
      workflowId: "resume-diagnose",
      resumeTitle: "前端工程师",
      now: "2026-06-12T08:30:00.000Z",
    });

    expect(snapshot).toEqual(
      expect.objectContaining({
        sessionId: "session_resume_abc",
        threadId: "thread_resume_abc",
        resumeId: "resume_abc",
        mode: "optimize_existing",
        status: "active",
        workflow: expect.objectContaining({
          workflowId: "resume-diagnose",
          nodeId: "intake_goal",
          loopCount: 0,
        }),
        workspace: expect.objectContaining({
          resumeId: "resume_abc",
          mode: "optimize_existing",
          changeSets: [],
        }),
        contextStatus: null,
        pendingInterrupts: [],
      }),
    );
    expect(snapshot.userIdHash).not.toContain("user_123");
  });

  it("projects context and workspace state deltas into the session snapshot", () => {
    const initial = createInitialAgentSessionSnapshot(baseSessionInput());
    const contextStatus = validContextStatus();
    const workspace = validWorkspace();

    const next = reduceAgentSessionSnapshot(initial, {
      type: EventType.STATE_DELTA,
      delta: [
        { op: "replace", path: "/contextStatus", value: contextStatus },
        { op: "replace", path: "/workspace", value: workspace },
      ],
    });

    expect(next.contextStatus).toEqual(contextStatus);
    expect(next.workspace).toEqual(workspace);
    expect(next.updatedAt).toBe("2026-06-12T08:45:00.000Z");
  });

  it("ignores malformed workspace timestamps when updating session time", () => {
    const initial = createInitialAgentSessionSnapshot(baseSessionInput());

    const next = reduceAgentSessionSnapshot(initial, {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workspace",
          value: { ...validWorkspace(), updatedAt: "req_agent" },
        },
      ],
    });

    expect(next.workspace.updatedAt).toBe("req_agent");
    expect(next.updatedAt).toBe("2026-06-12T08:30:00.000Z");
  });

  it("projects workflow cursor state deltas into the session snapshot", () => {
    const initial = createInitialAgentSessionSnapshot(baseSessionInput());

    const next = reduceAgentSessionSnapshot(initial, {
      type: EventType.STATE_DELTA,
      delta: [
        {
          op: "replace",
          path: "/workflow",
          value: {
            workflowId: "resume-diagnose",
            nodeId: "await_user_input",
            loopCount: 1,
            completedNodeIds: ["intake_goal"],
          },
        },
      ],
    });

    expect(next.workflow).toEqual({
      workflowId: "resume-diagnose",
      nodeId: "await_user_input",
      loopCount: 1,
      completedNodeIds: ["intake_goal"],
    });
  });

  it("records interrupt outcomes as waiting for the user", () => {
    const next = reduceAgentSessionSnapshot(
      createInitialAgentSessionSnapshot(baseSessionInput()),
      {
        type: EventType.RUN_FINISHED,
        threadId: "thread_resume_abc",
        runId: "run_agent",
        outcome: {
          type: "interrupt",
          interrupts: [
            {
              id: "question_target_role",
              reason: "missing_fact",
              message: "你这次主要投递哪个岗位？",
            },
          ],
        },
      },
    );

    expect(next.status).toBe("waiting_user");
    expect(next.pendingInterrupts).toEqual([
      expect.objectContaining({
        id: "question_target_role",
        reason: "missing_fact",
      }),
    ]);
  });

  it("records run errors as failed without exposing internal details in state", () => {
    const next = reduceAgentSessionSnapshot(
      createInitialAgentSessionSnapshot(baseSessionInput()),
      {
        type: EventType.RUN_ERROR,
        message: "模型服务暂不可用",
        code: "dependency_unavailable",
      } as BaseEvent,
    );

    expect(next.status).toBe("failed");
    expect(JSON.stringify(next)).not.toContain("dependency_unavailable");
  });
});

function baseSessionInput() {
  return {
    sessionId: "session_resume_abc",
    threadId: "thread_resume_abc",
    userId: "user_123",
    resumeId: "resume_abc",
    mode: "optimize_existing" as const,
    workflowId: "resume-diagnose",
    resumeTitle: "前端工程师",
    now: "2026-06-12T08:30:00.000Z",
  };
}

function validContextStatus() {
  return {
    effectiveInputBudgetTokens: 200_000,
    modelInputLimitTokens: 214_000,
    reservedOutputTokens: 8_000,
    reservedSystemTokens: 6_000,
    usedInputTokens: 48_000,
    utilization: 0.24,
    status: "healthy" as const,
    policy: "full_context" as const,
    sources: [],
    lastCompactionAt: null,
    warnings: [],
  };
}

function validWorkspace() {
  return {
    resumeId: "resume_abc",
    mode: "optimize_existing" as const,
    goal: {
      workflowId: "resume-diagnose",
      resumeTitle: "前端工程师",
      targetRole: null,
      locale: "zh-CN" as const,
    },
    facts: [],
    draftResume: null,
    changeSets: [
      {
        id: "changeset_req_agent",
        title: "待确认修改",
        summary: "改写最近经历。",
        status: "staged" as const,
        operationIds: ["op_1"],
        operations: [],
        createdAt: "req_agent",
      },
    ],
    decisions: [],
    qualityReport: null,
    updatedAt: "2026-06-12T08:45:00.000Z",
  };
}
