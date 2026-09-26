import { describe, expect, it } from "vitest";

import {
  canUndo,
  describeUndoFailure,
  findUndoTarget,
  groupVersionsByTask,
  runLinkFor,
  sourceLabel,
  type VersionRecord,
} from "@/lib/ai-client/version-history";

/**
 * 版本历史聚合的契约（P06 任务 5）。
 *
 * plan 要求「列表**按任务聚合**，展开看各 revision 和 source；
 * **单条记录能回到 task/run**」。
 *
 * 数据库里 `resume_version` 已含全部所需字段（迁移 0014 加了
 * runId/changeSetId/mutationId/revision），但读取层没取出来 ——
 * 因此既有的 `ResumeVersionListItem` 无法聚合也无法跳转。本模块补上投影。
 *
 * 关键区分：**一次任务 ≠ 一个版本**。一次 Agent 任务可能产生多个版本
 * （多个工具各自提交一次），聚合键是 `runId`。
 */

let counter = 0;
function record(overrides: Partial<VersionRecord> = {}): VersionRecord {
  counter += 1;
  return {
    id: `v-${counter}`,
    resumeId: "resume-1",
    source: "manual",
    actorName: "林可",
    operationCount: 1,
    summary: null,
    createdAt: new Date(2026, 8, 26, 10, counter).toISOString(),
    revision: counter,
    runId: null,
    changeSetId: null,
    mutationId: `m-${counter}`,
    ...overrides,
  };
}

function reset() {
  counter = 0;
}

describe("来源标签", () => {
  it("每种来源都有中文说明", () => {
    for (const source of [
      "manual",
      "agent",
      "polish",
      "restore",
      "template",
      "style",
      "system",
      "collab",
      "undo",
    ] as const) {
      expect(sourceLabel(source).length).toBeGreaterThan(0);
      // 不把内部枚举名直接展示给用户。
      expect(sourceLabel(source)).not.toBe(source);
    }
  });

  it("撤销是独立的来源（用户要能区分「我改了」与「我撤销了」）", () => {
    expect(sourceLabel("undo")).toBe("撤销");
  });
});

describe("按任务聚合", () => {
  it("**同一次任务的多个版本合成一组**（一次任务 ≠ 一个版本）", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ runId: "run-1", source: "agent", summary: "更新项目描述" }),
      record({ runId: "run-1", source: "agent", summary: "更新技能" }),
      record({ runId: "run-1", source: "agent", summary: "调整排版" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind).toBe("task");
    expect(grouped[0].count).toBe(3);
  });

  it("**没有 runId 的记录各自成组**（它们不属于任何任务）", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ source: "manual" }),
      record({ source: "template" }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((group) => group.kind === "single")).toBe(true);
  });

  it("组内按时间倒序（最新在前）", () => {
    reset();
    const older = record({ runId: "run-1", createdAt: "2026-09-26T10:00:00.000Z" });
    const newer = record({ runId: "run-1", createdAt: "2026-09-26T12:00:00.000Z" });
    const grouped = groupVersionsByTask([older, newer]);
    expect(grouped[0].versions[0].id).toBe(newer.id);
    expect(grouped[0].versions[1].id).toBe(older.id);
  });

  it("组间按组内最新时间倒序", () => {
    reset();
    const oldTask = record({ runId: "run-old", createdAt: "2026-09-20T10:00:00.000Z" });
    const newTask = record({ runId: "run-new", createdAt: "2026-09-26T10:00:00.000Z" });
    const grouped = groupVersionsByTask([oldTask, newTask]);
    expect(grouped[0].id).toBe("run-new");
  });

  it("展开信息：sources 含组内全部来源", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ runId: "run-1", source: "agent" }),
      record({ runId: "run-1", source: "polish" }),
    ]);
    expect(grouped[0].sources.sort()).toEqual(["agent", "polish"]);
  });

  it("hasUndo 标记组内是否含撤销记录", () => {
    reset();
    const withUndo = groupVersionsByTask([
      record({ runId: "run-1", source: "agent" }),
      record({ runId: "run-1", source: "undo" }),
    ]);
    expect(withUndo[0].hasUndo).toBe(true);

    const without = groupVersionsByTask([record({ runId: "run-2", source: "agent" })]);
    expect(without[0].hasUndo).toBe(false);
  });

  it("**不同简历的同名 runId 不合并**（组键含 resumeId）", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ resumeId: "resume-A", runId: "run-1" }),
      record({ resumeId: "resume-B", runId: "run-1" }),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it("空列表 → 空分组", () => {
    expect(groupVersionsByTask([])).toEqual([]);
  });

  it("组键拼接无歧义（resumeId/runId 含分隔符也不会撞键）", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ resumeId: "a", runId: "b:c" }),
      record({ resumeId: "a:b", runId: "c" }),
    ]);
    // 若不使用不可打印分隔符，这两条会撞成同一个键。
    expect(grouped).toHaveLength(2);
  });

  it("无法解析的时间不抛异常（展示路径不该因脏数据崩）", () => {
    reset();
    const grouped = groupVersionsByTask([
      record({ runId: "run-1", createdAt: "not-a-date" }),
      record({ runId: "run-1", createdAt: "2026-09-26T10:00:00.000Z" }),
    ]);
    expect(grouped).toHaveLength(1);
    // 可解析的排在前面。
    expect(grouped[0].versions[0].createdAt).toBe("2026-09-26T10:00:00.000Z");
  });
});

describe("回到 task/run", () => {
  it("有 runId 的记录能跳回任务", () => {
    const link = runLinkFor(record({ runId: "run-1", changeSetId: "cs-1" }));
    expect(link).toEqual({ runId: "run-1", changeSetId: "cs-1" });
  });

  it("**无 runId 时返回 null**（UI 应当隐藏入口，而不是给一个点了没反应的按钮）", () => {
    expect(runLinkFor(record({ runId: null }))).toBeNull();
  });

  it("组上的 canOpenRun 反映是否至少有一条可跳", () => {
    reset();
    const withRun = groupVersionsByTask([record({ runId: "run-1" })]);
    expect(withRun[0].canOpenRun).toBe(true);

    const without = groupVersionsByTask([record({ runId: null })]);
    expect(without[0].canOpenRun).toBe(false);
  });
});

describe("撤销的可行性", () => {
  it("普通 agent 版本可撤销", () => {
    expect(canUndo(record({ source: "agent", mutationId: "m-1" }))).toBe(true);
  });

  it("手动编辑可撤销", () => {
    expect(canUndo(record({ source: "manual", mutationId: "m-1" }))).toBe(true);
  });

  it("**撤销记录本身不可撤销**（那是重做，属另一个功能）", () => {
    expect(canUndo(record({ source: "undo", mutationId: "m-1" }))).toBe(false);
  });

  it("**没有 mutationId 的旧数据不可撤销**（无法构造条件 undo 的幂等键）", () => {
    expect(canUndo(record({ source: "agent", mutationId: null }))).toBe(false);
  });

  it("无主的系统操作不可撤销", () => {
    expect(canUndo(record({ source: "system", runId: null }))).toBe(false);
    // 但有 runId 的系统操作（属于某次任务）可以。
    expect(canUndo(record({ source: "system", runId: "run-1" }))).toBe(true);
  });

  it("findUndoTarget 只按 id 找记录，不计算目标内容", () => {
    reset();
    const target = record({ runId: "run-1" });
    const found = findUndoTarget([target, record()], target.id);
    expect(found?.id).toBe(target.id);
    // 找不到时返回 null（不猜一个）。
    expect(findUndoTarget([target], "nope")).toBeNull();
  });

  it("**撤销失败时给出「内容未受影响」的可操作说明**（条件 undo 的语义）", () => {
    // plan 要求「失败保留用户内容」—— 条件不匹配时绝不能强行覆盖。
    const conflict = describeUndoFailure("condition_mismatch");
    expect(conflict).toContain("没有执行");
    expect(conflict).toContain("你的改动");
  });

  it("未知错误码有兜底说明（不显示原始码）", () => {
    const message = describeUndoFailure("some_internal_code");
    expect(message).toContain("未受影响");
    expect(message).not.toContain("some_internal_code");
  });

  it("每种已知失败都有专门说明", () => {
    for (const code of [
      "condition_mismatch",
      "revision_conflict",
      "target_not_found",
      "run_not_writable",
      "idempotency_key_reuse",
    ]) {
      const message = describeUndoFailure(code);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });
});

describe("plan 验收场景：撤销 A 时保留之后的改动", () => {
  it("撤销的目标是**那条记录**，不是「时间上的前一条」", () => {
    reset();
    /*
     * plan 验收：「修改 A 后用户补技能，再撤销 A，技能仍保留」。
     *
     * 因此撤销 A 时目标必须是 A 这条记录本身（提交层据此用条件 undo
     * 把字段还原到 A 之前的值），而不是「回退到 A 之前的状态」——
     * 后者会把用户随后补的技能一起抹掉。
     */
    const a = record({ id: "ver-a", source: "agent", runId: "run-1", summary: "改项目描述" });
    const b = record({ id: "ver-b", source: "manual", summary: "补技能" });

    const grouped = groupVersionsByTask([a, b]);
    // a 与 b 分属不同组（a 属于任务，b 是独立手动编辑）。
    expect(grouped).toHaveLength(2);

    // 撤销 a 时拿到的是 a 这条记录。
    const target = findUndoTarget([a, b], "ver-a");
    expect(target?.id).toBe("ver-a");
    // 绝不是 b。
    expect(target?.id).not.toBe("ver-b");
  });
});
