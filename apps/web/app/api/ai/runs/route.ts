import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { AI_REQUEST_LIMITS, validateAiRequestInput, validateProviderUrl } from "@/lib/ai/provider-policy";
import { createProviderStreamer } from "@/lib/ai/provider";
import { assertServerRuntime } from "@/lib/ai/server-guard";
import { streamRunAttempt } from "@/lib/ai/run-route-support";
import { loadResumeSourceForRun } from "@/lib/ai/resume-source";
import { acquireLease, getRun, startRun } from "@/lib/ai/run-store";

/**
 * `POST /api/ai/runs` —— 新链路的唯一执行入口（P04 任务 2 + 6）。
 *
 * 顺序是**刻意**的，每一步都对应一类「看起来成功了」的错误：
 *
 * 1. **鉴权 → 输入校验 → provider 校验 → 归属校验，全部在创建 Run 之前**。
 *    若顺序反过来（先建 Run 再校验），一次非法请求会在库里留下一个永远不会
 *    被执行的 Run，而它的租约还会挡住后续对同一份简历的合法请求。
 * 2. **重复 requestId 复用已有 Run，不二次调用模型**。客户端超时重试与用户
 *    连点都会发同一个 requestId；再跑一次既烧额度，又让两个 Run 抢同一份简历。
 * 3. **拿不到租约就 409，不并行执行**。同一简历同时只允许一个写 Run。
 * 4. **先申请租约再开始执行**，执行结束（无论成功/失败/中断）必须释放租约 ——
 *    否则会出现「Run 已经结束但租约还没到期」的空窗，期间合法请求都被 409。
 *
 * 返回的是 **SSE 流**：业务事件由 `orchestrateRun` 产生并逐条落库（数据库分配
 * sequence），同时推给客户端。客户端用 `lib/ai-client/reducer.ts` 做唯一投影。
 * 这里**不做**任何协议解释 —— 那是编排层与适配器的职责。
 */

assertServerRuntime("api/ai/runs/route.ts");

/** 运行模式白名单。请求体里任何其它字符串都收敛到默认值。 */
const VALID_MODES = ["optimize_existing", "create_from_zero"] as const;

/** 租约时长。必须显著大于单次执行的 deadline，否则执行中途就会被别人抢走。 */
const LEASE_TTL_MS = AI_REQUEST_LIMITS.routeDeadlineMs * 3;

type StartBody = {
  requestId: string;
  sessionId: string | null;
  resumeId: string;
  revision: number;
  message: string;
  mode: string;
  writeMode: "direct" | "approval";
  modelConfig: { baseUrl: string; apiKey: string; modelName: string };
};

/**
 * 解析并校验请求体。
 *
 * 刻意**不**信任任何身份字段（`userId`）：归属只来自会话。`writeMode` 与
 * `mode` 都按白名单收敛 —— 那是授权语义，不能由客户端自选（客户端自称
 * `approval` 就绕过了直接写入的约束）。
 */
function parseBody(raw: unknown):
  | { ok: true; body: StartBody }
  | { ok: false; status: number; code: string; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, code: "invalid_body", message: "请求体必须是 JSON 对象" };
  }
  const record = raw as Record<string, unknown>;

  const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
  if (!requestId) {
    return { ok: false, status: 400, code: "missing_request_id", message: "缺少 requestId（幂等键）" };
  }

  const resumeId = typeof record.resumeId === "string" ? record.resumeId.trim() : "";
  if (!resumeId) {
    return { ok: false, status: 400, code: "missing_resume_id", message: "缺少 resumeId" };
  }

  const revision = record.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return { ok: false, status: 400, code: "invalid_revision", message: "revision 必须是非负整数" };
  }

  const message = typeof record.message === "string" ? record.message : "";
  if (!message.trim()) {
    return { ok: false, status: 400, code: "empty_message", message: "消息不能为空" };
  }

  const sizeCheck = validateAiRequestInput({
    message,
    historyLength: Array.isArray(record.history) ? record.history.length : 0,
  });
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

  /*
   * 地址策略在这里先过一遍，为的是**在创建 Run 之前**拒绝非法配置。
   * `createProviderStreamer` 内部还会再校验一次（那是它的职责），
   * 这次重复是有意的：这里决定 HTTP 状态码，那里决定能不能构造客户端。
   */
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

  const rawMode = typeof record.mode === "string" ? record.mode : "";
  const mode = (VALID_MODES as readonly string[]).includes(rawMode) ? rawMode : "optimize_existing";

  // 只有显式 "approval" 才是请求批准模式；其它一切值都按直接模式处理（更保守）。
  const writeMode = record.writeMode === "approval" ? "approval" : "direct";

  return {
    ok: true,
    body: {
      requestId,
      sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
      resumeId,
      revision,
      message,
      mode,
      writeMode,
      modelConfig: { baseUrl, apiKey, modelName },
    },
  };
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
   * 顺序很重要：**provider 构造必须在创建 Run 之前**。
   *
   * 若先建 Run 再构造 provider，一次配置非法的请求会在库里留下一个永远不会
   * 被执行的 Run —— 而它已经拿到了租约，会挡住后续对同一份简历的**合法**请求，
   * 直到租约自然过期。用户看到的是「什么都没发生，但之后一段时间全都报
   * 已在执行中」，且无从排查。
   *
   * 放在最前面还让「非法地址绝不会存在一个可用的 streamModel」成为结构性事实：
   * 校验不通过在 `createProviderStreamer` 内部就返回，不会构造 SDK 客户端。
   */
  const provider = createProviderStreamer(body.modelConfig);
  if (!provider.ok) {
    return NextResponse.json({ error: provider.message, code: provider.code }, { status: 400 });
  }

  // 简历归属：不存在与无权访问都返回 404（403 会泄露存在性）。
  const source = await loadResumeSourceForRun({ resumeId: body.resumeId, userId });
  if (!source) {
    return NextResponse.json({ error: "找不到该简历" }, { status: 404 });
  }

  /*
   * 幂等创建。重复 requestId 返回**同一个 Run**，此时不重新执行 ——
   * 客户端的重试与用户的连点都不应该让模型跑第二遍。
   */
  const started = await startRun({
    id: crypto.randomUUID(),
    userId,
    resumeId: body.resumeId,
    sessionId: body.sessionId,
    requestId: body.requestId,
    mode: body.mode,
    writeMode: body.writeMode,
    promptVersion: "p04",
    modelId: body.modelConfig.modelName,
    deadlineAt: new Date(Date.now() + AI_REQUEST_LIMITS.routeDeadlineMs),
  });

  if (started.status === "existing") {
    const existing = await getRun(started.runId);
    return NextResponse.json({
      runId: started.runId,
      reused: true,
      status: existing?.status ?? started.runStatus,
      // 明确告知复用：客户端应去读事件流（GET），而不是期待这里再推一次。
      message: "该请求已创建过任务，已复用既有任务，未重复执行",
    });
  }

  const runId = started.runId;

  // 申请写租约。同一简历同时只允许一个写 Run。
  const lease = await acquireLease({
    runId,
    userId,
    leaseOwner: crypto.randomUUID(),
    ttlMs: LEASE_TTL_MS,
  });
  if (lease.status !== "acquired") {
    const status = lease.status === "held_by_other" ? 409 : lease.status === "terminal" ? 409 : 404;
    const message =
      lease.status === "held_by_other"
        ? "该简历上已有正在执行的任务，请等待它结束"
        : lease.status === "terminal"
          ? "该任务已结束，不能重新执行"
          : "找不到该任务";
    return NextResponse.json({ error: message, code: lease.status }, { status });
  }

  /*
   * 交给共享模块执行。
   *
   * 这里刻意只保留「校验 + 建 Run + 拿租约」，剩下的推流、fence 透传、
   * 终态落库、租约释放全部在 `lib/ai/run-route-support.ts` ——
   * Continue 路由复用同一份实现，避免两条路由各写一遍而出现
   * 「一条修了、另一条没修」的漂移（每条都涉及取消与租约这类难排查的故障）。
   */
  return streamRunAttempt({
    runId,
    resumeId: body.resumeId,
    userId,
    actorName: session.user?.name ?? "用户",
    attemptId: crypto.randomUUID(),
    // 授权模式来自**已落库的 Run 行**（服务端白名单收敛），不取自请求体。
    writeMode: body.writeMode,
    fenceToken: lease.fenceToken,
    source,
    history: [],
    message: body.message,
    streamModel: provider.streamModel,
    requestSignal: request.signal,
  });
}
