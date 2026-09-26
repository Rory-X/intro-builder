import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunEventEnvelope } from "@intro-builder/shared/types";

import { AI_REQUEST_LIMITS } from "@/lib/ai/provider-policy";
import {
  consumeRunStream,
  consumeSseBuffer,
  resumeRun,
  streamRun,
  type StreamRunOptions,
} from "@/lib/ai-client/run-stream";

/**
 * Run 流客户端消费的契约（P06 接线 / P07 切流的前置）。
 *
 * 这个模块此前**不存在** —— `/api/ai/runs` 服务端早就交付，但没有任何客户端
 * 消费方，浮窗仍走旧的微服务入口。因此这里要覆盖的是「两端契约的接头处」，
 * 而那正是最容易出问题的地方。
 *
 * 两个重点：
 *
 * 1. **`POST /api/ai/runs` 不一定返回 SSE**。`requestId` 命中已有 Run 时
 *    服务端返回 JSON（`{ runId, reused: true }`）。混在一起解析会让这条路径
 *    静默拿不到任何事件 —— 界面停在那里，看起来像「模型没响应」。
 * 2. **续读用 `after` 游标**，不从头重放。
 */

let counter = 0;
function event(overrides: Partial<RunEventEnvelope> = {}): RunEventEnvelope {
  counter += 1;
  return {
    schemaVersion: 1,
    eventId: `e-${counter}`,
    runId: "run-1",
    attemptId: "attempt-1",
    sequence: counter,
    type: "text.delta",
    occurredAt: new Date(0).toISOString(),
    payload: { text: "x" },
    ...overrides,
  };
}

function reset() {
  counter = 0;
}

function sseResponse(events: RunEventEnvelope[]): Response {
  const body = events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("");
  return new Response(body, {
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

const BASE_OPTIONS: StreamRunOptions = {
  resumeId: "resume-1",
  message: "帮我看看简历",
  requestId: "req-1",
  revision: 3,
  mode: "optimize_existing",
  writeMode: "direct",
  modelConfig: { baseUrl: "https://api.example.com/v1", apiKey: "sk-x", modelName: "m" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE 分帧", () => {
  it("解析多个完整事件", () => {
    reset();
    const seen: RunEventEnvelope[] = [];
    const rest = consumeSseBuffer(
      `data: ${JSON.stringify(event())}\n\ndata: ${JSON.stringify(event())}\n\n`,
      (item) => seen.push(item),
    );
    expect(seen).toHaveLength(2);
    expect(rest).toBe("");
  });

  it("**保留不完整的尾块**（等下一批数据到达再解析）", () => {
    reset();
    const seen: RunEventEnvelope[] = [];
    const partial = `data: ${JSON.stringify(event())}\n\ndata: {"schemaVers`;
    const rest = consumeSseBuffer(partial, (item) => seen.push(item));
    expect(seen).toHaveLength(1);
    expect(rest).toBe(`data: {"schemaVers`);
  });

  it("忽略空 data 行与非 data 行", () => {
    reset();
    const seen: RunEventEnvelope[] = [];
    consumeSseBuffer(`event: ping\n\ndata: \n\ndata: ${JSON.stringify(event())}\n\n`, (item) =>
      seen.push(item),
    );
    expect(seen).toHaveLength(1);
  });

  it("**单条事件格式异常不终止整个流**（否则用户丢掉后续所有内容）", () => {
    reset();
    const seen: RunEventEnvelope[] = [];
    const buffer = [
      "data: {not json}\n\n",
      `data: ${JSON.stringify(event())}\n\n`,
      `data: ${JSON.stringify(event())}\n\n`,
    ].join("");
    consumeSseBuffer(buffer, (item) => seen.push(item));
    // 坏的那条被丢掉，后面两条照常。
    expect(seen).toHaveLength(2);
  });

  it("处理 CRLF 换行", () => {
    reset();
    const seen: RunEventEnvelope[] = [];
    consumeSseBuffer(`data: ${JSON.stringify(event())}\r\n\r\n`, (item) => seen.push(item));
    expect(seen).toHaveLength(1);
  });
});

describe("流式消费", () => {
  it("逐条回调事件，并用 reducer 折叠出投影", async () => {
    reset();
    const events: RunEventEnvelope[] = [];
    const projections: Array<{ status: string; tools: number }> = [];

    const result = await consumeRunStream(sseResponse([
      event({ type: "tool.started", payload: { toolCallId: "c1", toolName: "readResume" } }),
      event({ type: "tool.succeeded", payload: { toolCallId: "c1" } }),
      event({ type: "run.completed" }),
    ]), {
      onEvent: (item) => events.push(item),
      onProjection: (projection) =>
        projections.push({ status: projection.status, tools: projection.tools.length }),
      onDone: () => {},
    });

    expect(result.status).toBe("streamed");
    expect(events).toHaveLength(3);
    // 最后一条投影反映终态与工具数。
    expect(projections.at(-1)).toEqual({ status: "completed", tools: 1 });
  });

  it("**去重后不重复回调投影**（reducer 的 `changed` 为 false 时不推）", async () => {
    reset();
    const same = event({ sequence: 5 });
    let projectionCalls = 0;

    await consumeRunStream(sseResponse([same, same, same]), {
      onEvent: () => {},
      onProjection: () => {
        projectionCalls += 1;
      },
      onDone: () => {},
    });

    // 同一 eventId + 同一 sequence：只有第一次会改变状态。
    expect(projectionCalls).toBe(1);
  });

  it("结束时调用 onDone", async () => {
    reset();
    let done = false;
    await consumeRunStream(sseResponse([event()]), {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {
        done = true;
      },
    });
    expect(done).toBe(true);
  });

  it("返回 runId（从事件里取）", async () => {
    reset();
    const result = await consumeRunStream(sseResponse([event({ runId: "run-42" })]), {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    // 结果新增 trimmedHistory（未传 history → 0 条被裁）。
    expect(result).toEqual({ status: "streamed", runId: "run-42", trimmedHistory: 0 });
  });

  it("响应无 body 时报错而不是静默成功", async () => {
    const result = await consumeRunStream(new Response(null, { status: 200 }), {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("empty_body");
  });
});

describe("幂等复用分支（返回 JSON 而非 SSE）", () => {
  it("**`reused: true` 时返回 reused 而不是试图解析流**", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ runId: "run-9", reused: true, status: "running" })),
    );

    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });

    /*
     * 若统一按 SSE 解析，这条分支会拿不到任何事件、onDone 也不会被调 ——
     * 界面停在那里，看起来像「模型没响应」。
     */
    expect(result).toEqual({ status: "reused", runId: "run-9", runStatus: "running" });
  });

  it("复用分支不回调任何事件", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ runId: "run-9", reused: true, status: "running" })),
    );
    let eventCalls = 0;
    await streamRun(BASE_OPTIONS, {
      onEvent: () => {
        eventCalls += 1;
      },
      onProjection: () => {},
      onDone: () => {},
    });
    // 服务端明确说「去读事件流（GET）」，因此这里不该有事件。
    expect(eventCalls).toBe(0);
  });

  it("复用分支缺 runId 时按异常处理（不返回半成品）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ reused: true })));
    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result.status).toBe("error");
  });
});

describe("错误处理", () => {
  it("HTTP 错误 → 带服务端 code 与 message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "该简历上已有正在执行的任务", code: "held_by_other" }, 409)),
    );
    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result).toEqual({
      status: "error",
      code: "held_by_other",
      message: "该简历上已有正在执行的任务",
    });
  });

  it("网络异常 → network_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("network_failed");
  });

  it("非 SSE 且非复用 → unexpected_response（不静默成功）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ something: "else" })));
    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("unexpected_response");
  });

  it("合法 SSE 走流式路径（content-type 判定优先于 body 内容）", async () => {
    reset();
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([event({ runId: "run-7" })])));
    const result = await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result).toEqual({ status: "streamed", runId: "run-7", trimmedHistory: 0 });
  });

  it("请求体带上 modelConfig 与 requestId（BYOK，随请求传）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ runId: "r", reused: true }));
    vi.stubGlobal("fetch", fetchMock);
    await streamRun({ ...BASE_OPTIONS, requestId: "req-abc" }, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.requestId).toBe("req-abc");
    expect(body.modelConfig).toEqual(BASE_OPTIONS.modelConfig);
  });
});

describe("续读（刷新恢复）", () => {
  it("带上 events=1 与 after 游标", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "completed", isTerminal: true, events: [], lastSequence: 8 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await resumeRun({ runId: "run-1", after: 5, limit: 100 });

    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/api/ai/runs/run-1?");
    expect(url).toContain("events=1");
    expect(url).toContain("after=5");
    expect(url).toContain("limit=100");
  });

  it("不传 after 时不带该参数（用于本地无事件的场景）", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "running", isTerminal: false, events: [], lastSequence: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await resumeRun({ runId: "run-1" });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).not.toContain("after=");
  });

  it("返回事件、状态、游标与终态标记", async () => {
    reset();
    const items = [event({ sequence: 6 }), event({ sequence: 7 })];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: "waiting_user", isTerminal: false, events: items, lastSequence: 7 }),
      ),
    );
    const result = await resumeRun({ runId: "run-1", after: 5 });
    expect(result).toEqual({
      status: "ok",
      events: items,
      runStatus: "waiting_user",
      lastSequence: 7,
      isTerminal: false,
    });
  });

  it("HTTP 错误 → 可读消息", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "找不到该任务" }, 404)));
    const result = await resumeRun({ runId: "run-1" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toBe("找不到该任务");
  });

  it("网络异常 → network_failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const result = await resumeRun({ runId: "run-1" });
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("network_failed");
  });

  it("runId 做 URL 编码（防注入到路径）", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "running", isTerminal: false, events: [], lastSequence: 0 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await resumeRun({ runId: "a/b?c" });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("a%2Fb%3Fc");
  });

  it("events 字段不是数组时退化为空数组（不崩）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "running", events: "nope", lastSequence: 3 })),
    );
    const result = await resumeRun({ runId: "run-1" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.events).toEqual([]);
  });
});

describe("对话历史传参（多轮会话不失忆）", () => {
  it("**history 被放进请求体**（这是切流后不失忆的依据）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ runId: "r", reused: true }));
    vi.stubGlobal("fetch", fetchMock);

    const history = [
      { role: "user" as const, content: "帮我看看简历" },
      { role: "assistant" as const, content: "我看到三个问题" },
    ];
    await streamRun({ ...BASE_OPTIONS, history }, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.history).toEqual(history);
  });

  it("不传 history 时请求体里是空数组", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ runId: "r", reused: true }));
    vi.stubGlobal("fetch", fetchMock);
    await streamRun(BASE_OPTIONS, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.history).toEqual([]);
  });

  it("**超上限时在客户端裁掉**（服务端会整体拒绝，那会让用户连当前这轮都发不出去）", async () => {
    const fetchMock = vi.fn(async () => sseResponse([event({ runId: "run-1" })]));
    vi.stubGlobal("fetch", fetchMock);

    // 构造 200 条（上限 100）。
    const history = Array.from({ length: 200 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}`,
    }));

    const result = await streamRun({ ...BASE_OPTIONS, history }, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = (JSON.parse(String(init.body)) as { history: unknown[] }).history;
    // 请求体里的历史不超上限。
    expect(sent.length).toBeLessThanOrEqual(AI_REQUEST_LIMITS.maxHistoryMessages);
    // 裁掉的数量被如实回报（调用方可据此提示用户）。
    expect(result.status).toBe("streamed");
    if (result.status === "streamed") {
      expect(result.trimmedHistory).toBeGreaterThan(0);
    }
  });

  it("未超限时 trimmedHistory 为 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([event({ runId: "run-1" })])));
    const history = [
      { role: "user" as const, content: "u1" },
      { role: "assistant" as const, content: "a1" },
    ];
    const result = await streamRun({ ...BASE_OPTIONS, history }, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });
    expect(result.status).toBe("streamed");
    if (result.status === "streamed") expect(result.trimmedHistory).toBe(0);
  });

  it("**裁剪不改变最近几轮的顺序**（模型看到的是结尾那段对话）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ runId: "r", reused: true }));
    vi.stubGlobal("fetch", fetchMock);

    const history = Array.from({ length: 200 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `m${index}`,
    }));
    await streamRun({ ...BASE_OPTIONS, history }, {
      onEvent: () => {},
      onProjection: () => {},
      onDone: () => {},
    });

    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = (JSON.parse(String(init.body)) as { history: Array<{ content: string }> }).history;
    // 保留的是最近的 —— 最后一条仍是原历史的最后一条。
    expect(sent.at(-1)?.content).toBe("m199");
  });
});
