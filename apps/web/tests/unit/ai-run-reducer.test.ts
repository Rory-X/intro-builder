import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  createRunProjection,
  finalizeOnEof,
  reduceRunEvent,
  reduceRunEvents,
} from "@/lib/ai-client/reducer";

let seq = 0;
function event(
  type: RunEventType,
  payload: Record<string, unknown> = {},
  overrides: Partial<RunEventEnvelope> = {},
): RunEventEnvelope {
  seq += 1;
  return {
    schemaVersion: 1,
    eventId: `e${seq}`,
    runId: "run-1",
    attemptId: "att-1",
    sequence: seq,
    type,
    occurredAt: new Date().toISOString(),
    payload,
    ...overrides,
  };
}

describe("reducer：文本与工具", () => {
  it("累积文本增量", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("text.delta", { text: "你" })).state;
    state = reduceRunEvent(state, event("text.delta", { text: "好" })).state;
    expect(state.text).toBe("你好");
  });

  it("工具开始后参数片段累积，但仅用于展示", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("tool.started", { toolCallId: "c1", toolName: "readResume" })).state;
    state = reduceRunEvent(state, event("tool.arguments", { toolCallId: "c1", delta: '{"sec' })).state;
    state = reduceRunEvent(state, event("tool.arguments", { toolCallId: "c1", delta: 'tion":"basics"}' })).state;
    expect(state.tools).toHaveLength(1);
    expect(state.tools[0].partialArguments).toBe('{"section":"basics"}');
    // 参数片段不得被当成已完成的调用（仍是 running）。
    expect(state.tools[0].status).toBe("running");
  });

  it("工具成功时记录结果与提交关联", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("tool.started", { toolCallId: "c1", toolName: "addWorkExperience" })).state;
    state = reduceRunEvent(
      state,
      event("tool.succeeded", {
        toolCallId: "c1",
        toolName: "addWorkExperience",
        result: { status: "committed" },
        mutationId: "m-1",
      }),
    ).state;
    expect(state.tools[0].status).toBe("succeeded");
    expect(state.tools[0].mutationId).toBe("m-1");
  });

  it("工具失败记录错误码（不当成成功）", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("tool.started", { toolCallId: "c1", toolName: "x" })).state;
    state = reduceRunEvent(state, event("tool.failed", { toolCallId: "c1", name: "x", code: "provider_timeout" })).state;
    expect(state.tools[0].status).toBe("failed");
    expect(state.tools[0].errorCode).toBe("provider_timeout");
  });

  it("同一 toolCallId 重复 tool.started 不产生重复条目", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("tool.started", { toolCallId: "c1", toolName: "x" })).state;
    state = reduceRunEvent(state, event("tool.started", { toolCallId: "c1", toolName: "x" })).state;
    expect(state.tools).toHaveLength(1);
  });
});

describe("reducer：去重", () => {
  it("重复 eventId 不改变状态（UI 不应产生副作用）", () => {
    const first = event("text.delta", { text: "甲" });
    let state = createRunProjection();
    const applied = reduceRunEvent(state, first);
    state = applied.state;
    expect(applied.changed).toBe(true);

    const replay = reduceRunEvent(state, first);
    expect(replay.changed).toBe(false);
    expect(replay.state.text).toBe("甲");
  });

  it("sequence 不递增的事件被忽略（乱序/重复投递）", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("text.delta", { text: "甲" }, { sequence: 5 })).state;
    const stale = reduceRunEvent(state, event("text.delta", { text: "乙" }, { sequence: 3 }));
    expect(stale.changed).toBe(false);
    expect(stale.state.text).toBe("甲");
  });

  it("重放整段事件流：只有首次应用会改变状态", () => {
    const events = [
      event("run.started"),
      event("text.delta", { text: "你好" }),
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("run.completed"),
    ];
    const first = reduceRunEvents(createRunProjection(), events);
    const replay = reduceRunEvents(first.state, events);
    expect(replay.appliedCount).toBe(0);
    expect(replay.state.text).toBe("你好");
    expect(replay.state.tools).toHaveLength(1);
  });

  it("其他 Run 的事件被忽略（一个投影只服务一个 Run）", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("run.started")).state;
    const other = reduceRunEvent(state, event("text.delta", { text: "别的" }, { runId: "run-2" }));
    expect(other.changed).toBe(false);
  });

  it("同一 mutationId 重复提交事件只记一次", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("mutation.committed", { mutationId: "m-1", revision: 1, versionId: "v1" }),
    ).state;
    const dup = reduceRunEvent(
      state,
      event("mutation.committed", { mutationId: "m-1", revision: 1, versionId: "v1" }),
    );
    expect(dup.state.committed).toHaveLength(1);
  });
});

describe("reducer：模型完成 ≠ 修改已保存", () => {
  it("文本生成结束后状态仍是 running（不能据此显示已保存）", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("run.started")).state;
    state = reduceRunEvent(state, event("text.delta", { text: "已经帮你改好了" })).state;
    // 模型说完了，但没有 mutation.committed。
    expect(state.status).toBe("running");
    expect(state.committed).toHaveLength(0);
  });

  it("只有 mutation.committed 才产生「已保存」凭据", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("mutation.committed", { mutationId: "m-1", revision: 2, versionId: "v2", changeSetId: "cs-1" }),
    ).state;
    expect(state.committed).toEqual([
      { mutationId: "m-1", revision: 2, versionId: "v2", changeSetId: "cs-1" },
    ]);
  });

  it("冲突单独记录，不被当作成功", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("mutation.conflict", { mutationId: "m-1", message: "内容已更新" }),
    ).state;
    expect(state.conflicts).toHaveLength(1);
    expect(state.committed).toHaveLength(0);
  });
});

describe("reducer：提案与决策", () => {
  it("提案按 changeSetId 更新版本（新版本替换旧的）", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 1, summary: "v1", operationCount: 2 }),
    ).state;
    state = reduceRunEvent(
      state,
      event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 2, summary: "v2", operationCount: 3 }),
    ).state;
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0].proposalVersion).toBe(2);
  });

  it("提交回执把对应提案推进为 committed", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 1 })).state;
    state = reduceRunEvent(
      state,
      event("mutation.committed", { mutationId: "m-1", revision: 1, versionId: "v1", changeSetId: "cs-1" }),
    ).state;
    expect(state.proposals[0].status).toBe("committed");
  });

  it("部分提交被如实标记", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 1 })).state;
    state = reduceRunEvent(
      state,
      event("mutation.committed", {
        mutationId: "m-1", revision: 1, versionId: "v1", changeSetId: "cs-1", partiallyCommitted: true,
      }),
    ).state;
    expect(state.proposals[0].status).toBe("partially_committed");
  });

  it("决策按 changeSetId+version 去重", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("decision.recorded", { changeSetId: "cs-1", proposalVersion: 1, acceptedOperationIds: ["o1"] }),
    ).state;
    state = reduceRunEvent(
      state,
      event("decision.recorded", { changeSetId: "cs-1", proposalVersion: 1, acceptedOperationIds: ["o1"] }),
    ).state;
    expect(state.decisions).toHaveLength(1);
  });
});

describe("reducer：等待用户与结束", () => {
  it("等待用户时记录结构化问题", () => {
    let state = createRunProjection();
    state = reduceRunEvent(
      state,
      event("run.waiting_user", {
        question: { questionId: "q1", question: "这段的主导还是参与？", target: "experience.0.content" },
      }),
    ).state;
    expect(state.status).toBe("waiting_user");
    expect(state.pendingQuestion?.question).toContain("主导还是参与");
  });

  it("新 attempt 不重置历史文本与工具", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("run.started")).state;
    state = reduceRunEvent(state, event("text.delta", { text: "第一段" })).state;
    state = reduceRunEvent(state, event("run.waiting_user", {})).state;
    state = reduceRunEvent(state, event("attempt.started")).state;
    expect(state.status).toBe("running");
    expect(state.text).toBe("第一段");
  });

  it("失败与取消是独立终态", () => {
    const failed = reduceRunEvent(createRunProjection(), event("run.failed", { message: "模型超时" })).state;
    expect(failed.status).toBe("failed");
    expect(failed.endReason).toBe("模型超时");

    const cancelled = reduceRunEvent(createRunProjection(), event("run.cancelled")).state;
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("EOF：不假称完成（与服务端判据一致）", () => {
  it("没有结束事件时判定为 interrupted", () => {
    let state = createRunProjection();
    state = reduceRunEvent(state, event("run.started")).state;
    state = reduceRunEvent(state, event("text.delta", { text: "看起来说完了" })).state;

    const finalized = finalizeOnEof(state);
    expect(finalized.status).toBe("interrupted");
    expect(finalized.endReason).toContain("未收到结束事件");
  });

  it("已完成/已失败/已取消的 Run 不因 EOF 被改写", () => {
    for (const type of ["run.completed", "run.failed", "run.cancelled"] as const) {
      const state = reduceRunEvent(createRunProjection(), event(type, {})).state;
      expect(finalizeOnEof(state).status).toBe(state.status);
    }
  });

  it("waiting_user 是 attempt 的正常结束，不改成 interrupted", () => {
    const state = reduceRunEvent(createRunProjection(), event("run.waiting_user", {})).state;
    expect(finalizeOnEof(state).status).toBe("waiting_user");
  });
});

describe("【复核发现】终态保护：晚到事件不得改写最终结论", () => {
  it("取消之后收到晚到的 run.completed，状态仍是 cancelled", () => {
    /*
     * 真实缺陷：取消路由写 run.cancelled（attemptId="cancel"），执行中的 attempt
     * 随后写 run.completed（sequence 更大，不触发去重），reducer 此前会把状态
     * 改回 completed —— 用户点了取消，界面先显示已取消、随后跳回已完成。
     * 服务端 finishRun 有「终态只出现一次」的保证，reducer 必须对称。
     */
    let state = createRunProjection();
    state = reduceRunEvent(state, event("run.started")).state;
    state = reduceRunEvent(state, event("run.cancelled")).state;
    expect(state.status).toBe("cancelled");

    const late = reduceRunEvent(state, event("run.completed"));
    expect(late.state.status).toBe("cancelled");
    expect(late.changed).toBe(false);
  });

  it("失败/完成之后收到其他终态事件同样不改写", () => {
    for (const first of ["run.completed", "run.failed", "run.cancelled"] as const) {
      const state = reduceRunEvent(
        reduceRunEvent(createRunProjection(), event("run.started")).state,
        event(first),
      ).state;
      for (const late of ["run.completed", "run.failed", "run.cancelled", "run.interrupted"] as const) {
        const result = reduceRunEvent(state, event(late));
        expect(result.state.status, `${first} 后收到 ${late}`).toBe(state.status);
      }
    }
  });

  it("终态之后仍推进 sequence（去重游标不倒退）", () => {
    const state = reduceRunEvent(createRunProjection(), event("run.cancelled")).state;
    const before = state.lastSequence;
    const late = reduceRunEvent(state, event("run.completed"));
    expect(late.state.lastSequence).toBeGreaterThan(before);
  });

  it("waiting_user / interrupted 不是终态：后续事件仍可推进结论", () => {
    // waiting_user 可以被新的 attempt 拉回 running，也能被取消改写。
    const waiting = reduceRunEvent(createRunProjection(), event("run.waiting_user", {})).state;
    const cancelled = reduceRunEvent(waiting, event("run.cancelled"));
    expect(cancelled.state.status).toBe("cancelled");

    const interrupted = reduceRunEvent(createRunProjection(), event("run.interrupted")).state;
    const completed = reduceRunEvent(interrupted, event("run.completed"));
    expect(completed.state.status).toBe("completed");
  });
});

describe("reducer：不虚构进度", () => {
  it("没有任何事件时状态为 idle（不显示进行中）", () => {
    const state = createRunProjection();
    expect(state.status).toBe("idle");
    expect(state.tools).toHaveLength(0);
    expect(state.text).toBe("");
  });

  it("未知事件类型不改变业务状态", () => {
    const before = reduceRunEvent(createRunProjection(), event("run.started")).state;
    const after = reduceRunEvent(before, event("some.future.event" as RunEventType, {}));
    expect(after.state.status).toBe("running");
    expect(after.state.tools).toHaveLength(0);
  });
});
