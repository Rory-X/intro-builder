import { describe, expect, it } from "vitest";
import type { RunEventEnvelope, RunEventType } from "@intro-builder/shared/types";

import {
  emptyTaskCard,
  projectTaskCard,
  shouldShowSavedBadge,
  taskCardHeadline,
} from "@/lib/ai-client/task-projection";

/**
 * 任务卡投影的契约（P06 任务 2）。
 *
 * plan 的四条约束，每条都对应一类会让用户误判的行为：
 *
 * 1. **没有事件不虚构进度或百分比** —— 编一句「正在处理」比不显示更糟。
 * 2. **模型完成和修改保存分开** —— 这是「模型完成 ≠ 已保存」在 UI 层的落点。
 * 3. **等待原因可操作** —— `run.waiting_user` 必须带出问题文本。
 * 4. **不暴露内部推理与凭据** —— 不显示原始工具名、错误码、payload。
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

describe("空状态：不虚构进度", () => {
  it("空事件 → idle，无步骤", () => {
    const card = projectTaskCard([]);
    expect(card.status).toBe("idle");
    expect(card.steps).toEqual([]);
    expect(card.hasPersistedChanges).toBe(false);
  });

  it("**没有步骤时不显示「正在处理」**（编一句比不显示更糟）", () => {
    const card = projectTaskCard([event("attempt.started")]);
    expect(card.status).toBe("running");
    expect(taskCardHeadline(card)).toBeNull();
  });

  it("emptyTaskCard 与空事件投影一致", () => {
    expect(projectTaskCard([])).toEqual(emptyTaskCard());
  });
});

describe("工具步骤：业务语言而非内部命名", () => {
  it("工具开始 → running 步骤，标签是业务动作", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
    ]);
    expect(card.steps).toHaveLength(1);
    expect(card.steps[0].label).toBe("更新项目经历");
    expect(card.steps[0].status).toBe("running");
  });

  it("**不显示原始工具名**（对用户无意义且暴露内部命名）", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
    ]);
    expect(card.steps[0].label).not.toContain("updateProjectBlock");
  });

  it("未知工具给兜底文案，不回显原始名", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "someInternalTool" }),
    ]);
    expect(card.steps[0].label).toBe("执行一项操作");
    expect(card.steps[0].label).not.toContain("someInternalTool");
  });

  it("工具成功 → done", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
    ]);
    expect(card.steps[0].status).toBe("done");
  });

  it("工具失败 → failed，且 detail 是**可操作的中文**而非原始错误码", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
      event("tool.failed", { toolCallId: "c1", code: "target_not_found" }),
    ]);
    expect(card.steps[0].status).toBe("failed");
    expect(card.steps[0].detail).toBe("找不到这条内容，可能已被删除");
    expect(card.steps[0].detail).not.toContain("target_not_found");
  });

  it("冲突类失败给出「请刷新后重试」这类可操作说明", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
      event("tool.failed", { toolCallId: "c1", code: "revision_conflict" }),
    ]);
    expect(card.steps[0].detail).toContain("刷新");
  });

  it("未识别的错误码有兜底文案（不显示原始码）", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.failed", { toolCallId: "c1", code: "weird_internal_code" }),
    ]);
    expect(card.steps[0].detail).toBe("这一步没有完成");
    expect(card.steps[0].detail).not.toContain("weird_internal_code");
  });
});

describe("模型完成与保存分开（核心约束）", () => {
  it("**只有 run.completed → 显示「已完成」，不显示已保存**", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
      event("run.completed"),
    ]);
    expect(card.status).toBe("done");
    expect(card.hasPersistedChanges).toBe(false);
    expect(shouldShowSavedBadge(card)).toBe(false);
    // 文案必须能区分「完成」与「完成并保存」。
    expect(taskCardHeadline(card)).toBe("已完成");
  });

  it("有回执 → 显示「已完成并保存」", () => {
    reset();
    const card = projectTaskCard([
      event("mutation.committed", { mutationId: "m-1", revision: 5 }),
      event("run.completed"),
    ]);
    expect(card.hasPersistedChanges).toBe(true);
    expect(shouldShowSavedBadge(card)).toBe(true);
    expect(taskCardHeadline(card)).toBe("已完成并保存");
  });

  it("提交步骤带上版本号（用户能据此核对留痕）", () => {
    reset();
    const card = projectTaskCard([event("mutation.committed", { mutationId: "m-1", revision: 7 })]);
    const commit = card.steps.find((step) => step.kind === "commit");
    expect(commit?.label).toContain("7");
    expect(commit?.status).toBe("done");
  });

  it("**有回执但连接中断 → 仍显示已保存**（落盘是事实，不因断线撤销）", () => {
    reset();
    const card = projectTaskCard([
      event("mutation.committed", { mutationId: "m-1", revision: 5 }),
      event("run.interrupted"),
    ]);
    expect(card.hasPersistedChanges).toBe(true);
    expect(card.status).toBe("interrupted");
    // 状态是中断，但已保存的事实保留 —— UI 需要两个字段一起看。
    expect(taskCardHeadline(card)).toBe("连接中断，未完成");
  });
});

describe("等待用户：原因是可操作的", () => {
  it("run.waiting_user 带出问题文本", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "askUser" }),
      event("run.waiting_user", {
        question: { questionId: "q-1", question: "这个项目的量化结果是什么？" },
      }),
    ]);
    expect(card.status).toBe("waiting_user");
    expect(card.pendingQuestion?.question).toBe("这个项目的量化结果是什么？");
    expect(taskCardHeadline(card)).toBe("等待你的回答");
  });

  it("askUser 步骤标为 waiting（用户的注意力在「还没回答」上）", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "askUser" }),
      event("run.waiting_user", { question: { questionId: "q-1", question: "x" } }),
    ]);
    expect(card.steps[0].kind).toBe("question");
    expect(card.steps[0].status).toBe("waiting");
  });

  it("等待事件缺少问题文本时 pendingQuestion 为 null（不编一个问题）", () => {
    reset();
    const card = projectTaskCard([event("run.waiting_user", {})]);
    expect(card.status).toBe("waiting_user");
    expect(card.pendingQuestion).toBeNull();
    // 仍能给出不撒谎的概览。
    expect(taskCardHeadline(card)).toBe("等待你的确认");
  });
});

describe("提案：就绪不等于已保存", () => {
  it("proposal.ready → waiting 步骤（等用户决定）", () => {
    reset();
    const card = projectTaskCard([
      event("proposal.ready", { changeSetId: "cs-1", summary: "优化项目描述", proposalVersion: 1 }),
    ]);
    expect(card.steps[0].kind).toBe("proposal");
    expect(card.steps[0].label).toBe("优化项目描述");
    expect(card.steps[0].status).toBe("waiting");
    // 提案不等于落盘。
    expect(card.hasPersistedChanges).toBe(false);
  });
});

describe("终态收尾：不留转圈的步骤", () => {
  it("**中断时仍在 running 的步骤标为未完成**（否则永远显示「正在处理…」）", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateProjectBlock" }),
      event("run.interrupted"),
    ]);
    expect(card.steps[0].status).toBe("failed");
    expect(card.steps[0].detail).toBe("未完成");
  });

  it("取消时的未完成步骤标注「已取消」", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("run.cancelled"),
    ]);
    expect(card.steps[0].detail).toBe("已取消");
  });

  it("已完成状态**不**改动等待中的提案步骤（它在等用户）", () => {
    reset();
    const card = projectTaskCard([
      event("proposal.ready", { changeSetId: "cs-1", summary: "建议", proposalVersion: 1 }),
      event("run.completed"),
    ]);
    expect(card.steps[0].status).toBe("waiting");
  });

  it("失败状态 → failed 概览", () => {
    reset();
    const card = projectTaskCard([event("run.failed", { message: "boom" })]);
    expect(card.status).toBe("failed");
    expect(taskCardHeadline(card)).toBe("执行失败");
    // 不把原始 message 放进概览（可能含内部信息）。
    expect(taskCardHeadline(card)).not.toContain("boom");
  });
});

describe("冲突计数", () => {
  it("统计冲突事件数", () => {
    reset();
    const card = projectTaskCard([
      event("mutation.conflict", { mutationId: "m-1" }),
      event("mutation.conflict", { mutationId: "m-2" }),
    ]);
    expect(card.conflictCount).toBe(2);
  });

  it("无冲突时为 0", () => {
    reset();
    expect(projectTaskCard([event("run.completed")]).conflictCount).toBe(0);
  });
});

describe("纯函数性质（重放安全）", () => {
  it("同一份事件重复投影得到相同结果", () => {
    reset();
    const events = [
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1" }),
      event("mutation.committed", { mutationId: "m-1", revision: 2 }),
      event("run.completed"),
    ];
    const first = projectTaskCard(events);
    const second = projectTaskCard(events);
    expect(second).toEqual(first);
  });

  it("重放（同一批事件追加两次）不产生重复步骤", () => {
    reset();
    const batch = [
      event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
      event("tool.succeeded", { toolCallId: "c1" }),
    ];
    const once = projectTaskCard(batch);
    const twice = projectTaskCard([...batch, ...batch]);
    /*
     * 工具事件按 toolCallId 索引：第二次 `tool.started` 会覆盖同一索引，
     * 因此步骤数不变。这是「重放不重复渲染」的机制。
     */
    expect(twice.steps).toHaveLength(once.steps.length);
  });

  it("不修改传入的事件数组", () => {
    reset();
    const events = [event("tool.started", { toolCallId: "c1", toolName: "readResume" })];
    const snapshot = JSON.stringify(events);
    projectTaskCard(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});

describe("不暴露内部信息", () => {
  it("任务卡里不含 payload / key / 工具原始参数", () => {
    reset();
    const card = projectTaskCard([
      event("tool.started", { toolCallId: "c1", toolName: "updateBasicsBlock", args: { apiKey: "sk-secret" } }),
      event("tool.succeeded", { toolCallId: "c1", output: { raw: "sk-secret" } }),
      event("run.completed"),
    ]);
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("raw");
  });
});
