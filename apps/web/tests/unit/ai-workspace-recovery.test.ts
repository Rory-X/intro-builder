import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  describeWorkspaceError,
  inferWorkspaceError,
  restoreWorkspace,
  type WorkspaceErrorKind,
} from "@/lib/ai-client/workspace-recovery";

/**
 * 刷新恢复与错误文案的契约（P06 任务 6）。
 *
 * plan 要求两件事：
 * 1. 恢复后还原已完成工具、已应用/已拒绝建议及等待问题；
 *    **重放 event 不重复 toast/写入**。
 * 2. 四类错误都有**可操作中文文案**：无终态 EOF、没有模型 key、
 *    未完成保存、找不到条目。
 *
 * 关于「重放不重复」：去重归 `reducer.ts`（它有两层机制），本模块只保证
 * **纯函数**（同输入同输出）—— 因此这里的断言是「重放后状态不漂移」，
 * 而不是「本模块再去重一次」。
 */

let counter = 0;
function event(type: RunEventType, payload: Record<string, unknown> = {}): RunEventEnvelope {
  counter += 1;
  return {
    schemaVersion: 1,
    eventId: `e-${counter}`,
    runId: "run-1",
    attemptId: "attempt-1",
    sequence: counter,
    type,
    occurredAt: new Date(0).toISOString(),
    payload,
  };
}

function reset() {
  counter = 0;
}

describe("恢复已完成工具", () => {
  it("还原工具列表与状态", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
        event("tool.succeeded", { toolCallId: "c1" }),
      ],
      runStatus: "completed",
    });
    expect(snapshot.projection.tools).toHaveLength(1);
    expect(snapshot.projection.tools[0].status).toBe("succeeded");
  });

  it("还原等待问题（刷新后要重新聚焦那个问题）", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("run.waiting_user", {
          question: { questionId: "q-1", question: "这个项目的量化结果是什么？" },
        }),
      ],
      runStatus: "waiting_user",
    });
    expect(snapshot.awaitingQuestion?.questionId).toBe("q-1");
    expect(snapshot.awaitingQuestion?.question).toContain("量化结果");
    expect(snapshot.taskCard.status).toBe("waiting_user");
  });

  it("还原已应用/已拒绝的决策", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("decision.recorded", {
          changeSetId: "cs-1",
          proposalVersion: 1,
          // 字段名以 reducer 的解析为准：acceptedOperationIds / rejectedOperationIds。
          acceptedOperationIds: ["op-1"],
          rejectedOperationIds: ["op-2"],
        }),
      ],
      runStatus: "completed",
    });
    expect(snapshot.projection.decisions).toHaveLength(1);
    expect(snapshot.projection.decisions[0].accepted).toEqual(["op-1"]);
    expect(snapshot.projection.decisions[0].rejected).toEqual(["op-2"]);
  });
});

describe("服务端状态优先", () => {
  it("**本地不完整时以服务端为准**（本地以为还在跑，服务端早已结束）", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [event("tool.started", { toolCallId: "c1", toolName: "readResume" })],
      runStatus: "completed",
    });
    // 本地事件流只重放了一部分，不能据此认为还在运行。
    expect(snapshot.projection.status).toBe("completed");
    expect(snapshot.taskCard.status).toBe("done");
  });

  it("服务端说运行中但本地已 EOF → 保持 interrupted（连接问题而非 Run 问题）", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [event("tool.started", { toolCallId: "c1", toolName: "readResume" })],
      runStatus: "running",
    });
    /*
     * 注意：`projection.status` 的初始值是 "idle"（未收到结束事件），
     * 而不是 interrupted —— interrupted 由 `finalizeOnEof` 显式标记。
     * 这里的要点是**不**因为服务端说 running 就把状态当成正常完成。
     */
    expect(snapshot.projection.status).not.toBe("completed");
    expect(snapshot.taskCard.status).not.toBe("done");
  });

  it("服务端 failed / cancelled 如实反映", () => {
    reset();
    expect(restoreWorkspace({ events: [], runStatus: "failed" }).taskCard.status).toBe("failed");
    reset();
    expect(restoreWorkspace({ events: [], runStatus: "cancelled" }).taskCard.status).toBe("cancelled");
  });
});

describe("重放安全（纯函数）", () => {
  it("同一份事件恢复两次结果相同", () => {
    reset();
    const events = [
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1" }),
      event("mutation.committed", { mutationId: "m-1", revision: 2 }),
    ];
    const first = restoreWorkspace({ events, runStatus: "completed" });
    const second = restoreWorkspace({ events, runStatus: "completed" });
    expect(second).toEqual(first);
  });

  it("**重放（同一批事件追加两次）不产生重复工具/提案/提交**", () => {
    reset();
    const batch = [
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1" }),
      event("proposal.ready", { changeSetId: "cs-1", summary: "建议", proposalVersion: 1 }),
      event("mutation.committed", { mutationId: "m-1", revision: 2 }),
    ];
    const once = restoreWorkspace({ events: batch, runStatus: "completed" });
    const twice = restoreWorkspace({ events: [...batch, ...batch], runStatus: "completed" });

    // 去重由 reducer 负责（eventId + sequence 两层），因此数量不变。
    expect(twice.projection.tools).toHaveLength(once.projection.tools.length);
    expect(twice.projection.committed).toHaveLength(once.projection.committed.length);
    expect(twice.projection.proposals).toHaveLength(once.projection.proposals.length);
    // 任务卡同样不重复。
    expect(twice.taskCard.steps).toHaveLength(once.taskCard.steps.length);
  });

  it("不改动传入的事件数组", () => {
    reset();
    const events = [event("tool.started", { toolCallId: "c1", toolName: "readResume" })];
    const snapshot = JSON.stringify(events);
    restoreWorkspace({ events, runStatus: "running" });
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});

describe("未确认保存的识别（关键的诚实性）", () => {
  it("**工具有成功、有提案、但无回执 → 记为未确认**", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
        event("tool.succeeded", { toolCallId: "c1" }),
        event("proposal.ready", { changeSetId: "cs-1", summary: "改项目", proposalVersion: 1 }),
        event("run.completed"),
      ],
      runStatus: "completed",
    });
    // 模型说完了，但没有任何 mutation.committed —— 用户必须被告知内容未写入。
    expect(snapshot.unconfirmedWrites).toBeGreaterThan(0);
    expect(inferWorkspaceError(snapshot, { hasModelKey: true })).toBe("unconfirmed_save");
  });

  it("有回执 → 不算未确认", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
        event("tool.succeeded", { toolCallId: "c1" }),
        event("proposal.ready", { changeSetId: "cs-1", summary: "改项目", proposalVersion: 1 }),
        event("mutation.committed", { mutationId: "m-1", revision: 2 }),
        event("run.completed"),
      ],
      runStatus: "completed",
    });
    expect(snapshot.unconfirmedWrites).toBe(0);
    expect(inferWorkspaceError(snapshot, { hasModelKey: true })).toBeNull();
  });

  it("**诊断类任务（只读、无提案）不报「未确认保存」**", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
        event("tool.succeeded", { toolCallId: "c1" }),
        event("run.completed"),
      ],
      runStatus: "completed",
    });
    // 只读任务本来就不该有回执 —— 报「未保存」会让用户以为出了问题。
    expect(inferWorkspaceError(snapshot, { hasModelKey: true })).toBeNull();
  });
});

describe("四类错误文案（plan 点名）", () => {
  const KINDS: WorkspaceErrorKind[] = [
    "no_end_event",
    "missing_model_key",
    "unconfirmed_save",
    "target_not_found",
  ];

  it("每一类都有可操作的中文文案", () => {
    for (const kind of KINDS) {
      const message = describeWorkspaceError(kind);
      expect(message.length).toBeGreaterThan(0);
      // 必须告诉用户下一步做什么，而不只是「出错了」。
      expect(message).toMatch(/可以|请|重试|不受影响|刷新/);
      // 不显示内部枚举名。
      expect(message).not.toContain(kind);
    }
  });

  it("**无终态 EOF**：说明连接中断，并告知已保存的修改不受影响", () => {
    const message = describeWorkspaceError("no_end_event");
    expect(message).toContain("连接中断");
    expect(message).toContain("不受影响");
    expect(message).toContain("重新发送");
  });

  it("**缺少模型 key**：给出具体入口（设置里连接模型）", () => {
    const message = describeWorkspaceError("missing_model_key");
    expect(message).toContain("设置");
    expect(message).toContain("密钥");
  });

  it("**未完成保存**：明确说「还没有保存成功」（不能让用户以为已写入）", () => {
    const message = describeWorkspaceError("unconfirmed_save");
    expect(message).toContain("还没有保存成功");
    expect(message).toContain("没有写入");
    // 给出补救手段。
    expect(message).toContain("重试");
  });

  it("**找不到条目**：给出可操作步骤（刷新后重发）", () => {
    const message = describeWorkspaceError("target_not_found");
    expect(message).toContain("找不到");
    expect(message).toContain("刷新");
  });

  it("未知错误有兜底文案（仍给出下一步）", () => {
    const message = describeWorkspaceError("unknown");
    expect(message).toContain("重试");
  });
});

describe("错误类型的推断顺序", () => {
  it("**找不到条目优先于配置问题**（先说会导致操作失败的那个）", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [
        event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
        event("tool.failed", { toolCallId: "c1", code: "target_not_found" }),
      ],
      runStatus: "completed",
    });
    // 即使同时缺 key，也应先说「找不到条目」—— 那是操作失败的直接原因。
    expect(inferWorkspaceError(snapshot, { hasModelKey: false })).toBe("target_not_found");
  });

  it("缺 key 优先于断线", () => {
    reset();
    const snapshot = restoreWorkspace({ events: [], runStatus: "running" });
    expect(inferWorkspaceError(snapshot, { hasModelKey: false })).toBe("missing_model_key");
  });

  it("一切正常时返回 null（不编一个错误出来）", () => {
    reset();
    const snapshot = restoreWorkspace({ events: [], runStatus: "completed" });
    expect(inferWorkspaceError(snapshot, { hasModelKey: true })).toBeNull();
  });
});

describe("interrupted 标记", () => {
  it("本地标记 interrupted 时置位", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [event("run.interrupted")],
      runStatus: "running",
    });
    expect(snapshot.interrupted).toBe(true);
  });

  it("**服务端说 completed 时不置为 interrupted**（真的做完了，不是断线）", () => {
    reset();
    const snapshot = restoreWorkspace({
      events: [event("run.interrupted")],
      runStatus: "completed",
    });
    expect(snapshot.interrupted).toBe(false);
  });

  it("状态是 idle（无事件）时不报断线", () => {
    reset();
    const snapshot = restoreWorkspace({ events: [], runStatus: null });
    expect(snapshot.interrupted).toBe(false);
  });
});
