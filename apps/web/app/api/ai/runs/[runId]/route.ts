import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  appendEvent,
  getRun,
  isRunWritable,
  listEvents,
  listToolExecutions,
  reconcileMutationEvents,
  requestCancel,
  type DbRun,
} from "@/lib/ai/run-store";
import { isTerminalRunStatus } from "@/lib/ai/events";

/**
 * Run 的查询与取消 API（P04 任务 6）。
 *
 * 这些路由刻意是**只读或状态标记**，与「启动执行」分开：
 *
 * - `GET`（本文件）**绝不启动模型**。旧实现在「查看进度」这类操作里也会触发执行，
 *   于是刷新页面就等于又跑一次 —— 既浪费额度，也会让同一任务被两个 Run 处理。
 * - `POST` 只写取消意图。取消必须落库，因为拦住晚到提交的是数据库 fence，
 *   而不是内存里的一个标志。
 *
 * 归属校验一律基于**会话里的 userId**，不接受请求体自称的身份。
 */

function assertServerRuntime(): void {
  const nodeVersion = (globalThis as { process?: { versions?: { node?: string } } }).process
    ?.versions?.node;
  if (!nodeVersion) {
    throw new Error("api/ai/runs 只能在服务端使用");
  }
}
assertServerRuntime();

/** 脱敏 Run：只暴露 UI 需要的字段，绝不返回模型 key 或完整 checkpoint 正文。 */
function presentRun(run: DbRun) {
  return {
    runId: run.id,
    resumeId: run.resumeId,
    sessionId: run.sessionId,
    status: run.status,
    mode: run.mode,
    writeMode: run.writeMode,
    checkpointVersion: run.checkpointVersion,
    startedAt: run.startedAt instanceof Date ? run.startedAt.toISOString() : String(run.startedAt),
    finishedAt:
      run.finishedAt instanceof Date ? run.finishedAt.toISOString() : (run.finishedAt ?? null),
    cancelRequestedAt:
      run.cancelRequestedAt instanceof Date
        ? run.cancelRequestedAt.toISOString()
        : (run.cancelRequestedAt ?? null),
    promptVersion: run.promptVersion,
    modelId: run.modelId,
    usage: run.usage,
    lastError: run.lastError,
    parentRunId: run.parentRunId,
    /** 终态提示：UI 据此不再期待新事件。 */
    isTerminal: isTerminalRunStatus(run.status),
  };
}

/** 统一的归属 + 存在性检查。未登录 401；不属于当前用户 404（不泄露存在性）。 */
async function loadOwnedRun(runId: string): Promise<
  | { ok: true; userId: string; run: DbRun }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }

  const run = await getRun(runId);
  // 不属于当前用户时返回 404 而不是 403：403 会泄露「这个 runId 存在」。
  if (!run || run.userId !== userId) {
    return { ok: false, response: NextResponse.json({ error: "找不到该任务" }, { status: 404 }) };
  }
  return { ok: true, userId, run };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const loaded = await loadOwnedRun(runId);
  if (!loaded.ok) return loaded.response;

  const url = new URL(request.url);
  const eventsParam = url.searchParams.get("events");

  // `?events=1&after=n` 返回事件分页；否则只返回状态快照。
  if (eventsParam === "1" || eventsParam === "true") {
    /*
     * 参数必须校验再入 SQL。
     *
     * 实测：`?after=abc` → `22P02 invalid input syntax for type integer: "NaN"`，
     * `?limit=-5` → `2201W LIMIT must not be negative`，两者都会从 GET 抛未捕获异常
     * 变成 500。非法输入应当是 400，而不是服务端错误。
     */
    const rawAfter = url.searchParams.get("after") ?? "0";
    const rawLimit = url.searchParams.get("limit") ?? "200";
    const after = Number(rawAfter);
    const limit = Number(rawLimit);
    if (!Number.isInteger(after) || after < 0) {
      return NextResponse.json({ error: "after 必须是非负整数" }, { status: 400 });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return NextResponse.json({ error: "limit 必须是 1..500 的整数" }, { status: 400 });
    }

    /*
     * 读取事件前先补齐遗漏的文档提交投影。
     *
     * `resume_mutation_event` 是可靠源，`ai_run_event` 是展示投影。投影失败不能
     * 反过来报告提交失败（文档已经原子落盘），所以这里**先协调**再读，
     * 保证 UI 不会因为投影滞后而永远显示「未保存」。
     */
    await reconcileMutationEvents(runId, "reconcile", () => crypto.randomUUID());

    const events = await listEvents({ runId, afterSequence: after, limit });
    return NextResponse.json({
      status: loaded.run.status,
      isTerminal: isTerminalRunStatus(loaded.run.status),
      events,
      /** 续读游标：UI 下次带 `after=lastSequence`。 */
      lastSequence: events.length > 0 ? events[events.length - 1].sequence : after,
    });
  }

  return NextResponse.json({ run: presentRun(loaded.run) });
}

/**
 * 取消一个 Run。
 *
 * 幂等：重复取消返回同样结果，不覆盖首次取消时间。
 * **已成功提交的修改不会被回滚** —— 取消只影响尚未提交的部分。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const loaded = await loadOwnedRun(runId);
  if (!loaded.ok) return loaded.response;

  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    // 空 body 视为默认动作（取消）。仍不信任其中的任何身份字段。
  }

  if (body.action && body.action !== "cancel") {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  if (isTerminalRunStatus(loaded.run.status)) {
    return NextResponse.json({
      runId,
      status: loaded.run.status,
      // 已终态：明确告知取消不生效，而不是假装取消成功。
      cancelled: false,
      reason: "任务已结束，取消不生效",
    });
  }

  const result = await requestCancel(runId);
  if (!result) {
    return NextResponse.json({
      runId,
      status: loaded.run.status,
      cancelled: false,
      reason: "任务已结束，取消不生效",
    });
  }

  /*
   * 记录取消事件。
   *
   * 事件写失败**不能**让整个请求变成 500：取消意图已经落库（`requestCancel` 成功），
   * 而「取消已生效但事件没写」与「取消根本没生效」的后续行为完全不同，
   * 调用方必须能区分。因此这里只记录，响应仍如实反映取消已生效。
   */
  let eventRecorded = true;
  try {
    await appendEvent({
      runId,
      attemptId: "cancel",
      type: "run.cancelled",
      eventId: crypto.randomUUID(),
      payload: { reason: "用户取消" },
    });
  } catch (error) {
    eventRecorded = false;
    console.error("[ai/runs] 取消事件写入失败（取消意图已落库）", error);
  }

  /*
   * 返回 `writable: false` 让调用方知道：此后该 Run 的任何提交都会被 fencing 拦下。
   * 这里**不**承诺「立刻停止模型」—— 那由 AbortSignal 负责，而数据库 fence
   * 才是阻止晚到写入的保障。
   */
  const writable = await isRunWritable(runId, loaded.run.fenceToken);
  return NextResponse.json({
    runId,
    status: result.runStatus,
    cancelled: true,
    writable,
    // 如实告知事件是否记录成功，便于排查「UI 没显示取消」这类问题。
    eventRecorded,
  });
}

/** 工具账本的只读查询（排查「某个工具到底执行过没有」）。 */
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  const loaded = await loadOwnedRun(runId);
  if (!loaded.ok) return loaded.response;

  const ledger = await listToolExecutions(runId);
  return NextResponse.json({
    runId,
    tools: ledger.map((entry) => ({
      attemptId: entry.attemptId,
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      status: entry.status,
      mutationId: entry.mutationId,
      changeSetId: entry.changeSetId,
      errorCode: entry.errorCode,
    })),
  });
}
