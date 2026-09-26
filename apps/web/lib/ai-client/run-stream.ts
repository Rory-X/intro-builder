import type { RunEventEnvelope, RunStatus } from "@intro-builder/shared/types";

import { reduceRunEvent, createRunProjection, type RunProjection } from "./reducer";

/**
 * Run 流的客户端消费（P06 接线 / P07 切流的共同前置）。
 *
 * ## 为什么需要它
 *
 * `/api/ai/runs` 早已存在（P04 交付），服务端契约完整：SSE 推送业务事件、
 * 事件逐条落库、`GET ?events=1&after=n` 可续读。但**没有任何客户端消费方** ——
 * 浮窗仍走旧的 `/api/agent/floating/chat`（微服务入口）。
 *
 * 因此这一环是 P06 的「把投影接到 UI」与 P07 的「唯一入口切流」共同缺的东西。
 *
 * ## 两个容易搞错的地方
 *
 * 1. **`POST /api/ai/runs` 不一定返回 SSE**。当 `requestId` 命中已有 Run 时
 *    服务端返回 **JSON**（`{ runId, reused: true, ... }`）而不是事件流 ——
 *    意在告知客户端「去读事件流，不要期待这里再推一次」。把两种情况混在一起
 *    解析会让这条路径静默拿不到任何事件。
 * 2. **续读要用 `after` 游标**。刷新或断线重连后从 `lastSequence` 之后继续，
 *    而不是从头重放 —— 头部的 `run.started` 之类再看一遍虽然被 reducer 去重，
 *    但白白传输；更重要的是「从头读」在长 Run 上会拉回大量事件。
 */

/**
 * 找出下一个事件边界。
 *
 * **必须同时认 `\n\n` 与 `\r\n\r\n`**。第一版只找 `\n\n`，
 * 而 `\r\n\r\n` 里根本没有连续两个 `\n`（是 `\n\r\n`）——
 * 于是 CRLF 分隔的流**一个事件都解析不出来**，且不报错、只是静默停住。
 * 由测试抓出（单测里 `expected [] to have a length of 1`）。
 *
 * 当前服务端写的是 `\n\n`，所以线上路径侥幸能用；但代理、中间件或
 * 未来的规范调整都可能改成 CRLF，而那种失效非常难排查（界面像「卡住了」）。
 */
function findEventBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

/** 服务端 SSE 的 `data:` 行承载一个完整的事件信封。 */
const SSE_PREFIX = "data:";

export type RunStreamHandlers = {
  /** 每收到一条事件（已去重后仍然全部回传，便于 UI 展示原始流）。 */
  onEvent: (event: RunEventEnvelope) => void;
  /** 投影更新（已去重、已应用终态保护）。 */
  onProjection: (projection: RunProjection) => void;
  /** 流结束（正常结束或中断）。 */
  onDone: () => void;
};

export type StreamRunOptions = {
  resumeId: string;
  message: string;
  /** 幂等键。同一 requestId 不会二次调用模型。 */
  requestId: string;
  revision: number;
  mode: string;
  writeMode: "direct" | "approval";
  sessionId?: string | null;
  modelConfig: { baseUrl: string; apiKey: string; modelName: string };
  signal?: AbortSignal;
};

export type StreamRunResult =
  | { status: "streamed"; runId: string | null }
  /**
   * 服务端复用了已有 Run（幂等命中），**没有**返回事件流。
   *
   * 调用方应当转而用 `resumeRun` 读事件 —— 这是服务端刻意设计的分支，
   * 不是错误。
   */
  | { status: "reused"; runId: string; runStatus: RunStatus }
  | { status: "error"; code: string; message: string };

/**
 * 解析 SSE 缓冲区，对每个完整的 `data:` 块回调。
 *
 * 返回**剩余的**缓冲区（可能含不完整的尾块）。这与浮窗既有的
 * `consumeFloatingStreamBuffer` 是同一套分帧逻辑 —— 服务端两侧都用
 * `data: <json>\n\n`，因此分帧规则一致。
 */
export function consumeSseBuffer(
  buffer: string,
  onEvent: (event: RunEventEnvelope) => void,
): string {
  let next = buffer;
  while (true) {
    const boundary = findEventBoundary(next);
    if (!boundary) break;
    const raw = next.slice(0, boundary.index);
    next = next.slice(boundary.index + boundary.length);

    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith(SSE_PREFIX))
      .map((line) => line.slice(SSE_PREFIX.length).trimStart())
      .join("\n");
    if (!data) continue;

    try {
      onEvent(JSON.parse(data) as RunEventEnvelope);
    } catch {
      /*
       * 单条事件解析失败**不终止整个流**：一次格式异常不该让用户丢掉
       * 后续所有内容（模型可能还会产出可用建议）。丢掉这一条并继续。
       */
      continue;
    }
  }
  return next;
}

/**
 * 发起一次 Run 并消费其事件流。
 *
 * 不做投影以外的任何解释 —— 事件由 `reducer` 折叠，这里只负责网络与分帧。
 */
export async function streamRun(
  options: StreamRunOptions,
  handlers: RunStreamHandlers,
): Promise<StreamRunResult> {
  let response: Response;
  try {
    response = await fetch("/api/ai/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        requestId: options.requestId,
        sessionId: options.sessionId ?? null,
        resumeId: options.resumeId,
        revision: options.revision,
        message: options.message,
        mode: options.mode,
        writeMode: options.writeMode,
        modelConfig: options.modelConfig,
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    return {
      status: "error",
      code: "network_failed",
      message: error instanceof Error ? error.message : "网络请求失败",
    };
  }

  const contentType = response.headers.get("content-type") ?? "";

  /*
   * 幂等命中：服务端返回 JSON，而不是事件流。
   *
   * 必须**先**判 content-type 再决定走哪条路径。若统一按 SSE 解析，
   * 这个分支会拿不到任何事件，而界面会停在那里 —— 看起来像「模型没响应」。
   */
  if (!contentType.includes("text/event-stream")) {
    const body = (await response.json().catch(() => null)) as
      | { runId?: unknown; reused?: unknown; status?: unknown; error?: unknown; code?: unknown }
      | null;

    if (!response.ok) {
      return {
        status: "error",
        code: typeof body?.code === "string" ? body.code : "request_failed",
        message: typeof body?.error === "string" ? body.error : "AI 助手请求失败",
      };
    }

    if (body && body.reused === true && typeof body.runId === "string") {
      const runStatus = (typeof body.status === "string" ? body.status : "running") as RunStatus;
      return { status: "reused", runId: body.runId, runStatus };
    }

    return {
      status: "error",
      code: "unexpected_response",
      message: "AI 助手返回了预期之外的响应",
    };
  }

  return consumeRunStream(response, handlers);
}

/**
 * 消费一个已经是 SSE 的响应。
 *
 * 导出它是为了让「复用分支之后接着读流」与测试可以单独驱动。
 */
export async function consumeRunStream(
  response: Response,
  handlers: RunStreamHandlers,
): Promise<StreamRunResult> {
  if (!response.body) {
    return { status: "error", code: "empty_body", message: "响应为空" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let projection = createRunProjection();
  let runId: string | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSseBuffer(buffer, (event) => {
        runId = event.runId;
        handlers.onEvent(event);
        /*
         * 用 reducer 折叠 —— 它是**唯一**投影来源（P04 的契约）。
         * 这里不自己判重或判终态：那会让两处规则不一致。
         */
        const result = reduceRunEvent(projection, event);
        if (result.changed) {
          projection = result.state;
          handlers.onProjection(projection);
        }
      });
    }
    // 冲掉解码器里可能残留的多字节字符。
    buffer += decoder.decode();
    consumeSseBuffer(buffer, (event) => {
      runId = event.runId;
      handlers.onEvent(event);
      const result = reduceRunEvent(projection, event);
      if (result.changed) {
        projection = result.state;
        handlers.onProjection(projection);
      }
    });
  } catch (error) {
    handlers.onDone();
    return {
      status: "error",
      code: "stream_failed",
      message: error instanceof Error ? error.message : "读取事件流失败",
    };
  }

  handlers.onDone();
  return { status: "streamed", runId };
}

export type ResumeRunResult =
  | { status: "ok"; events: RunEventEnvelope[]; runStatus: RunStatus; lastSequence: number; isTerminal: boolean }
  | { status: "error"; code: string; message: string };

/**
 * 续读一个 Run 的事件（刷新恢复 / 断线重连）。
 *
 * `after` 传上次的 `lastSequence`，只取其后的事件。不传则从头读 ——
 * 用于「刷新后本地没有任何事件」的场景。
 */
export async function resumeRun(input: {
  runId: string;
  after?: number;
  limit?: number;
}): Promise<ResumeRunResult> {
  const params = new URLSearchParams({ events: "1" });
  if (typeof input.after === "number") params.set("after", String(input.after));
  if (typeof input.limit === "number") params.set("limit", String(input.limit));

  let response: Response;
  try {
    response = await fetch(`/api/ai/runs/${encodeURIComponent(input.runId)}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    return {
      status: "error",
      code: "network_failed",
      message: error instanceof Error ? error.message : "网络请求失败",
    };
  }

  const body = (await response.json().catch(() => null)) as
    | {
        status?: unknown;
        isTerminal?: unknown;
        events?: unknown;
        lastSequence?: unknown;
        error?: unknown;
      }
    | null;

  if (!response.ok) {
    return {
      status: "error",
      code: "resume_failed",
      message: typeof body?.error === "string" ? body.error : "读取任务状态失败",
    };
  }

  const events = Array.isArray(body?.events) ? (body?.events as RunEventEnvelope[]) : [];
  return {
    status: "ok",
    events,
    runStatus: (typeof body?.status === "string" ? body.status : "running") as RunStatus,
    lastSequence: typeof body?.lastSequence === "number" ? body.lastSequence : (input.after ?? 0),
    isTerminal: body?.isTerminal === true,
  };
}
