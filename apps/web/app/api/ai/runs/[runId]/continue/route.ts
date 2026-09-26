import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { AI_REQUEST_LIMITS, validateAiRequestInput, validateProviderUrl } from "@/lib/ai/provider-policy";
import { createProviderStreamer } from "@/lib/ai/provider";
import { assertServerRuntime } from "@/lib/ai/server-guard";
import { streamRunAttempt } from "@/lib/ai/run-route-support";
import { loadResumeSourceForRun } from "@/lib/ai/resume-source";
import { acquireLease, getRun, listEvents } from "@/lib/ai/run-store";
import { isTerminalRunStatus } from "@/lib/ai/events";
import { resolveRunRouteDecision, runRouteDisabledPayload } from "@/lib/ai/run-route-flag";

/**
 * `POST /api/ai/runs/[runId]/continue` —— 恢复一个等待中或中断的 Run（P04 任务 6）。
 *
 * 「继续」比「启动」多三类危险，因为它是在**已有 Run 上再跑一次**：
 *
 * 1. **接管仍然有效的租约**。若另一个请求正在执行时被接管，同一个 Run 会出现
 *    两个 attempt 并发写同一份文档 —— 两份事件交错、sequence 混乱、
 *    同一个 toolCallId 可能被提交两次。因此拿不到租约一律 409，
 *    不做「尽力而为」的接管。租约**已过期**的情形会被 SQL 条件放行，
 *    这正是平台硬杀后能恢复的路径。
 * 2. **对终态 Run 继续**。终态只出现一次；继续一个已完成的 Run 会让这个不变量失效。
 * 3. **基于过期检查点继续**。客户端带着旧的 `checkpointVersion` 提交回答时，
 *    它引用的问题可能已经不存在（期间 Run 已推进）。必须比对版本并拒绝，
 *    否则会把回答挂到错误的位置上。
 *
 * 归属校验基于会话 userId；他人的 Run 返回 404 而不是 403（不泄露存在性）。
 */

assertServerRuntime("api/ai/runs/[runId]/continue/route.ts");

/** 租约时长。必须显著大于单次执行的 deadline，否则执行中途就会被别人抢走。 */
const LEASE_TTL_MS = AI_REQUEST_LIMITS.routeDeadlineMs * 3;

/** 重建历史时读取的最大事件数。足以覆盖一次对话，且不会把内存吃满。 */
const HISTORY_EVENT_LIMIT = 500;

type ContinueBody = {
  requestId: string;
  checkpointVersion: number;
  message: string;
  modelConfig: { baseUrl: string; apiKey: string; modelName: string };
};

function parseBody(raw: unknown):
  | { ok: true; body: ContinueBody }
  | { ok: false; status: number; code: string; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, code: "invalid_body", message: "请求体必须是 JSON 对象" };
  }
  const record = raw as Record<string, unknown>;

  const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
  if (!requestId) {
    return { ok: false, status: 400, code: "missing_request_id", message: "缺少 requestId（幂等键）" };
  }

  const checkpointVersion = record.checkpointVersion;
  if (
    typeof checkpointVersion !== "number" ||
    !Number.isInteger(checkpointVersion) ||
    checkpointVersion < 0
  ) {
    return {
      ok: false,
      status: 400,
      code: "invalid_checkpoint_version",
      message: "checkpointVersion 必须是非负整数",
    };
  }

  const message = typeof record.message === "string" ? record.message : "";
  if (!message.trim()) {
    return { ok: false, status: 400, code: "empty_message", message: "回答内容不能为空" };
  }

  const sizeCheck = validateAiRequestInput({ message, historyLength: 0 });
  if (!sizeCheck.ok) {
    return { ok: false, status: 400, code: sizeCheck.code, message: sizeCheck.message };
  }

  const config = record.modelConfig;
  if (!config || typeof config !== "object") {
    return { ok: false, status: 400, code: "missing_model_config", message: "缺少模型配置" };
  }
  const cfg = config as Record<string, unknown>;
  const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl.trim() : "";
  const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  const modelName = typeof cfg.modelName === "string" ? cfg.modelName.trim() : "";

  const policy = validateProviderUrl(baseUrl);
  if (!policy.ok) {
    return { ok: false, status: 400, code: policy.code, message: policy.message };
  }
  if (!apiKey) {
    return { ok: false, status: 400, code: "missing_api_key", message: "缺少模型服务密钥" };
  }
  if (!modelName) {
    return { ok: false, status: 400, code: "missing_model_name", message: "缺少模型名称" };
  }

  return {
    ok: true,
    body: { requestId, checkpointVersion, message, modelConfig: { baseUrl, apiKey, modelName } },
  };
}

/**
 * 从已持久化的事件重建最小对话历史。
 *
 * 刻意做得很薄：只取用户可见的问答对（`text.delta` 累积的助手文本 +
 * 提问记录）。**不**重放工具调用 —— 已提交的操作应按回执查询，
 * 而不是再执行一遍（那会让「继续」变成第二次修改）。
 */
function buildHistoryFromEvents(
  events: Array<{ type: string; payload: Record<string, unknown> }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let buffer = "";

  for (const event of events) {
    if (event.type === "text.delta") {
      const text = event.payload.text;
      if (typeof text === "string") buffer += text;
      continue;
    }
    // 结束类事件把累积的文本收成一条助手消息。
    if (event.type.startsWith("run.") && buffer.trim()) {
      history.push({ role: "assistant", content: buffer });
      buffer = "";
    }
  }
  if (buffer.trim()) history.push({ role: "assistant", content: buffer });
  return history;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;

  /*
   * 与启动路由同一道灰度开关（P04 任务 8）。
   *
   * 两条路由必须共用同一个判定：若只关住启动而放开 continue，
   * 调用方仍能对已存在的 Run 继续执行 —— 那等于开关形同虚设。
   */
  const flag = resolveRunRouteDecision();
  if (flag.mode !== "enabled") {
    return NextResponse.json(
      { ...runRouteDisabledPayload(), reason: flag.reason },
      { status: 503 },
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const run = await getRun(runId);
  // 不存在与不属于当前用户都返回 404：403 会泄露存在性。
  if (!run || run.userId !== userId) {
    return NextResponse.json({ error: "找不到该任务" }, { status: 404 });
  }

  /*
   * 终态不可复活。
   *
   * 注意 `waiting_user` 与 `interrupted` **不是**终态：前者等用户回答，
   * 后者是平台硬杀后的可恢复状态 —— 这两者正是本路由存在的理由。
   */
  if (isTerminalRunStatus(run.status)) {
    return NextResponse.json(
      { error: `任务已结束（${run.status}），不能继续`, code: "terminal_run" },
      { status: 409 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message, code: parsed.code }, { status: parsed.status });
  }
  const body = parsed.body;

  /*
   * 检查点版本必须匹配。
   *
   * 客户端带着旧版本提交回答时，它引用的问题可能已经不存在（期间 Run 已推进）。
   * 这一步刻意放在**申请租约之前**：版本不符是客户端可恢复的状态，
   * 没必要为它白占一次租约（那会短暂阻塞其它合法请求）。
   */
  if (body.checkpointVersion !== run.checkpointVersion) {
    return NextResponse.json(
      {
        error: `任务已推进到检查点 ${run.checkpointVersion}（你基于第 ${body.checkpointVersion} 版），请刷新后重试`,
        code: "stale_checkpoint",
        currentCheckpointVersion: run.checkpointVersion,
      },
      { status: 409 },
    );
  }

  // provider 校验同样在所有副作用之前：非法配置不该占租约。
  const provider = createProviderStreamer(body.modelConfig);
  if (!provider.ok) {
    return NextResponse.json({ error: provider.message, code: provider.code }, { status: 400 });
  }

  const source = await loadResumeSourceForRun({ resumeId: run.resumeId, userId });
  if (!source) {
    return NextResponse.json({ error: "找不到该简历" }, { status: 404 });
  }

  /*
   * 申请租约。
   *
   * `acquireLease` 的条件 UPDATE 只在「Run 非终态、且当前无有效租约
   * （或已过期）」时成功。因此：
   * - 有人正在执行 → `held_by_other` → 409（不接管，避免两个 attempt 并发写）；
   * - 上一个持有者已被平台硬杀、租约过期 → 成功 → 这正是可恢复路径。
   */
  const lease = await acquireLease({
    runId,
    userId,
    leaseOwner: crypto.randomUUID(),
    ttlMs: LEASE_TTL_MS,
  });
  if (lease.status !== "acquired") {
    const message =
      lease.status === "held_by_other"
        ? "该任务正在执行中，请等待它结束再继续"
        : lease.status === "terminal"
          ? "该任务已结束，不能继续"
          : "找不到该任务";
    return NextResponse.json({ error: message, code: lease.status }, { status: 409 });
  }

  /*
   * 重建历史。读取已有事件而不是重新执行工具 ——
   * 已提交的操作应按回执查询，重放会让「继续」变成第二次修改。
   */
  const priorEvents = await listEvents({ runId, afterSequence: 0, limit: HISTORY_EVENT_LIMIT });
  const history = buildHistoryFromEvents(priorEvents);

  return streamRunAttempt({
    runId,
    resumeId: run.resumeId,
    /*
     * 会话 id 取自**已落库的 Run 行**（它创建时就记下了），
     * 而不是请求体 —— 客户端换一个 sessionId 就能把这一轮
     * 挂到别的会话历史上，那是越权写入。
     */
    sessionId: run.sessionId,
    userId,
    actorName: session.user?.name ?? "用户",
    attemptId: crypto.randomUUID(),
    /*
     * 授权模式取自已落库的 Run 行，**不**取自请求体。
     * 客户端若能自选 writeMode，就等于可以单方面把审批模式降级成直接写入。
     */
    writeMode: run.writeMode,
    fenceToken: lease.fenceToken,
    source,
    history,
    message: body.message,
    streamModel: provider.streamModel,
    requestSignal: request.signal,
  });
}
