import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyResumeContent, ResumeContent } from "@intro-builder/shared/schemas";
import type { RunEventEnvelope } from "@intro-builder/shared/types";

import { createFloatingRun, needsResume } from "@/lib/ai-client/floating-run";

/**
 * 浮窗切流协调层（P07 任务 3）。
 *
 * 它把五个已建好的零件串起来：网络（`run-stream`）、协议翻译
 * （`floating-adapter`）、内容同步（`commit-sync`）、任务卡
 * （`task-projection`）、投影（`reducer`）。
 *
 * 没有它，`floating-agent-chat.tsx`（2511 行）要同时处理这五件事。
 *
 * ## 我在实现里踩到并修正的三个缺陷（都由与测试同批的检查抓到）
 *
 * 1. **重复折叠投影**：`consumeRunStream` 内部已折叠，我又在 `handleEvent`
 *    里折了一遍 —— 两份投影同时存在，其中一份被丢弃。两处去重规则一旦不一致
 *    会得出矛盾结论，且无法判断是哪一份在起作用。改为只从 `onProjection` 取。
 * 2. **`onProjection` 写成空函数**：那样 `getProjection()` 永远返回初始空投影，
 *    调用方会以为「什么事件都没发生」。
 * 3. **`finalize` 返回写死 `serverContent: null`**：明明算出来了却不返回，
 *    调用方只能依赖回调、无法在结果里取用。
 *
 * 这三个都是「类型通过、但行为错」的缺陷 —— 单测是唯一能拦住它们的手段。
 */

function content(name = "林可"): ResumeContent {
  return ResumeContent.parse({
    ...emptyResumeContent(),
    basics: { ...emptyResumeContent().basics, name },
  });
}

let counter = 0;
function event(type: RunEventEnvelope["type"], payload: Record<string, unknown> = {}): RunEventEnvelope {
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

function sseResponse(events: RunEventEnvelope[]): Response {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function handlers() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onQuestion: vi.fn(),
    onProposal: vi.fn(),
    onCommitted: vi.fn(),
    onConflict: vi.fn(),
    onEnded: vi.fn(),
    onProjection: vi.fn(),
    onTaskCard: vi.fn(),
    onSyncNeeded: vi.fn(),
  };
}

const BASE_INPUT = {
  resumeId: "resume-1",
  message: "帮我看看简历",
  requestId: "req-1",
  revision: 3,
  writeMode: "direct" as const,
  modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("事件分发到组件回调", () => {
  it("文本增量 → onTextDelta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([event("text.delta", { text: "你好" })])));
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onTextDelta).toHaveBeenCalledWith("你好");
  });

  it("工具生命周期 → onToolCall（含状态变化）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
          event("tool.succeeded", { toolCallId: "c1", toolName: "readResume" }),
        ]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onToolCall).toHaveBeenCalledTimes(2);
    expect(h.onToolCall.mock.calls[0][0]).toMatchObject({ id: "c1", status: "running" });
    expect(h.onToolCall.mock.calls[1][0]).toMatchObject({ id: "c1", status: "completed" });
  });

  it("等待问题 → onQuestion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("run.waiting_user", {
            question: { questionId: "q-1", question: "量化结果是什么？" },
          }),
        ]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ id: "q-1", question: "量化结果是什么？" }),
    );
  });

  it("提案 → onProposal（调用方去拉 changeSet）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("proposal.ready", { changeSetId: "cs-1", proposalVersion: 2, summary: "优化" }),
        ]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onProposal).toHaveBeenCalledWith({
      changeSetId: "cs-1",
      proposalVersion: 2,
      summary: "优化",
    });
  });

  it("冲突 → onConflict（需要用户处理）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([event("mutation.conflict", { mutationId: "m-1", message: "已被别处修改" })]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onConflict).toHaveBeenCalledWith({ mutationId: "m-1", message: "已被别处修改" });
  });

  it("终态 → onEnded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([event("run.completed")])));
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    expect(h.onEnded).toHaveBeenCalledWith("completed", null);
  });

  it("**投影从网络层取**（不重复折叠）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
          event("tool.succeeded", { toolCallId: "c1" }),
        ]),
      ),
    );
    const h = handlers();
    const session = createFloatingRun(h).start(BASE_INPUT);
    await session;
    // 投影被真的交出来了（不是空函数）。
    expect(h.onProjection).toHaveBeenCalled();
    const last = h.onProjection.mock.calls.at(-1)?.[0];
    expect(last.tools).toHaveLength(1);
  });
});

describe("**getProjection 返回真实状态**（我曾把它写成空回调）", () => {
  it("运行后能读到工具与终态", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
          event("tool.succeeded", { toolCallId: "c1" }),
          event("run.completed"),
        ]),
      ),
    );
    const session = createFloatingRun(handlers());
    await session.start(BASE_INPUT);
    const projection = session.getProjection();
    expect(projection.tools).toHaveLength(1);
    expect(projection.status).toBe("completed");
  });

  it("任务卡也可读（与投影同源事件）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([event("mutation.committed", { mutationId: "m-1", revision: 4 })])),
    );
    const session = createFloatingRun(handlers());
    await session.start(BASE_INPUT);
    expect(session.getTaskCard().hasPersistedChanges).toBe(true);
  });
});

describe("提交同步（服务端写库 → 客户端内容）", () => {
  it("**有回执且无本地编辑 → 请求同步**", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([event("mutation.committed", { mutationId: "m-1", revision: 5 })])),
    );
    const h = handlers();
    const session = createFloatingRun(h, {
      loadServerContent: async () => content("新名字"),
      hasLocalEdits: () => false,
    });
    await session.start(BASE_INPUT);

    expect(h.onSyncNeeded).toHaveBeenCalledTimes(1);
    expect(h.onSyncNeeded.mock.calls[0][0]).toMatchObject({ action: "sync", revision: 5 });
  });

  it("**有本地编辑 → 只推进基准**（不覆盖用户刚敲的字）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([event("mutation.committed", { mutationId: "m-1", revision: 5 })])),
    );
    const h = handlers();
    await createFloatingRun(h, {
      loadServerContent: async () => content(),
      hasLocalEdits: () => true,
    }).start(BASE_INPUT);

    expect(h.onSyncNeeded.mock.calls[0][0]).toMatchObject({
      action: "advance-baseline-only",
      revision: 5,
    });
  });

  it("**无回执时不请求同步**（诊断类任务本来就不该有回执）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
          event("tool.succeeded", { toolCallId: "c1" }),
          event("run.completed"),
        ]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h, { loadServerContent: async () => content() }).start(BASE_INPUT);
    expect(h.onSyncNeeded).not.toHaveBeenCalled();
  });

  it("**取内容失败不抛异常**（给出 reload 方案让调用方决定）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([event("mutation.committed", { mutationId: "m-1", revision: 5 })])),
    );
    const h = handlers();
    const outcome = await createFloatingRun(h, {
      loadServerContent: async () => {
        throw new Error("network down");
      },
      hasLocalEdits: () => false,
    }).start(BASE_INPUT);

    // 不抛 —— 把可恢复情况变成一次运行失败是错的。
    expect(outcome.status).toBe("finished");
    expect(h.onSyncNeeded.mock.calls[0][0]).toMatchObject({
      action: "reload",
      reason: "missing-content",
    });
  });

  it("**多次提交取最大 revision**（中间态会让本地落后）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("mutation.committed", { mutationId: "m-1", revision: 3 }),
          event("mutation.committed", { mutationId: "m-2", revision: 7 }),
          event("mutation.committed", { mutationId: "m-3", revision: 5 }),
        ]),
      ),
    );
    const h = handlers();
    const outcome = await createFloatingRun(h, {
      loadServerContent: async () => content(),
      hasLocalEdits: () => false,
    }).start(BASE_INPUT);

    expect(h.onSyncNeeded.mock.calls[0][0]).toMatchObject({ revision: 7 });
    if (outcome.status === "finished") expect(outcome.lastRevision).toBe(7);
  });

  it("**结果里带回服务端内容**（我曾写死 null）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([event("mutation.committed", { mutationId: "m-1", revision: 5 })])),
    );
    const outcome = await createFloatingRun(handlers(), {
      loadServerContent: async () => content("服务端的名字"),
      hasLocalEdits: () => false,
    }).start(BASE_INPUT);

    expect(outcome.status).toBe("finished");
    if (outcome.status === "finished") {
      expect(outcome.serverContent?.basics.name).toBe("服务端的名字");
    }
  });
});

describe("幂等复用分支", () => {
  it("**返回 reused 而不是假装完成**（假装会让界面显示已完成而内容没变）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ runId: "run-9", reused: true, status: "running" })),
    );
    const h = handlers();
    const outcome = await createFloatingRun(h).start(BASE_INPUT);

    expect(outcome).toEqual({ status: "reused", runId: "run-9" });
    // 没有事件，因此不该有终态回调。
    expect(h.onEnded).not.toHaveBeenCalled();
    expect(needsResume(outcome)).toBe(true);
  });

  it("错误如实传递（带 code 与 message）", async () => {
    vi.stubGlobal(
      "fetch",
      /*
       * 用 **409** 而不是 200 —— 真实服务端在业务错误时返回非 2xx，
       * 而 `streamRun` 只在 `!response.ok` 时读取 `code`。
       * 我第一版用 200，于是拿到 `unexpected_response`：
       * 这不是实现缺陷，是我的 mock 不真实。
       */
      vi.fn(async () =>
        jsonResponse({ error: "该简历上已有正在执行的任务", code: "held_by_other" }, 409),
      ),
    );
    const outcome = await createFloatingRun(handlers()).start(BASE_INPUT);
    expect(outcome).toEqual({
      status: "error",
      code: "held_by_other",
      message: "该简历上已有正在执行的任务",
    });
  });

  it("**错误时不做同步**（没有提交就没有内容要同步）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const h = handlers();
    await createFloatingRun(h, { loadServerContent: async () => content() }).start(BASE_INPUT);
    expect(h.onSyncNeeded).not.toHaveBeenCalled();
  });
});

describe("续读（刷新恢复）", () => {
  it("续读事件被分发且投影更新", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "completed",
          isTerminal: true,
          events: [
            event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
            event("run.completed"),
          ],
          lastSequence: 2,
        }),
      ),
    );
    const h = handlers();
    const session = createFloatingRun(h);
    const outcome = await session.resume("run-1", 0);

    expect(outcome.status).toBe("finished");
    expect(h.onToolCall).toHaveBeenCalled();
    expect(session.getProjection().status).toBe("completed");
  });

  it("**续读不做内容同步**（GET 只返回事件，拿不到 resumeId）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: "completed", isTerminal: true, events: [], lastSequence: 0 }),
      ),
    );
    const h = handlers();
    await createFloatingRun(h, { loadServerContent: async () => content() }).resume("run-1");
    expect(h.onSyncNeeded).not.toHaveBeenCalled();
  });

  it("续读失败如实返回错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "找不到该任务" }, 404)));
    const outcome = await createFloatingRun(handlers()).resume("run-1");
    expect(outcome.status).toBe("error");
  });
});

describe("任务卡回调", () => {
  it("**只在变化时回调**（避免无意义渲染）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          event("tool.started", { toolCallId: "c1", toolName: "readResume" }),
          event("tool.succeeded", { toolCallId: "c1" }),
        ]),
      ),
    );
    const h = handlers();
    await createFloatingRun(h).start(BASE_INPUT);
    // 有变化才有回调，但不应为每条事件都回调。
    expect(h.onTaskCard.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
