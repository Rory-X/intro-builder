import { RunAgentInputSchema } from "@ag-ui/core";

import { mapAgUiRunToAgentMessageRequest } from "@/lib/agent/ag-ui-run-adapter";
import {
  agUiErrorResponse,
  translateRunSseResponse,
} from "@/lib/ai/ag-ui-from-run";
import { createProviderStreamer } from "@/lib/ai/provider";
import { AI_REQUEST_LIMITS } from "@/lib/ai/provider-policy";
import { loadResumeSourceForRun } from "@/lib/ai/resume-source";
import { streamRunAttempt } from "@/lib/ai/run-route-support";
import { acquireLease, startRun } from "@/lib/ai/run-store";
import { currentUserId } from "@/lib/auth-helpers";

/**
 * `POST /api/agent/direct-runs`
 *
 * panel 仍然把 AG-UI 请求发到这里。响应现在是 Next.js 统一 Run
 * 翻译出的 AG-UI 事件流，不再签 JWT，也不再返回指向独立 Agent 服务的 streamUrl。
 *
 * 客户端已经会在响应是 `text/event-stream` 时直接消费，不会再发第二跳。
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEASE_TTL_MS = AI_REQUEST_LIMITS.routeDeadlineMs * 3;

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const parsed = await readAgUiRun(req);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  const mapped = mapAgUiRunToAgentMessageRequest(parsed.input);
  if (!mapped.ok) {
    return Response.json({ error: mapped.message }, { status: 400 });
  }

  const identity = {
    threadId: parsed.input.threadId,
    runId: parsed.input.runId,
  };

  const resumeId = mapped.request.resumeId;
  if (!resumeId) {
    return Response.json(
      {
        error: "请先打开一份简历，再让助手起草或修改",
        code: "resume_required",
      },
      { status: 400 },
    );
  }

  const modelConfig = mapped.request.modelConfig;
  if (!modelConfig) {
    return Response.json(
      { error: "请先连接模型", code: "missing_model_config" },
      { status: 400 },
    );
  }

  const provider = createProviderStreamer(modelConfig);
  if (!provider.ok) {
    return Response.json({ error: provider.message, code: provider.code }, { status: 400 });
  }

  const source = await loadResumeSourceForRun({ resumeId, userId });
  if (!source) {
    return Response.json({ error: "简历不存在" }, { status: 404 });
  }

  const history = mapped.request.messages.slice(0, -1).map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const message = mapped.request.messages.at(-1)?.content ?? "";
  if (!message.trim()) {
    return Response.json({ error: "消息不能为空" }, { status: 400 });
  }

  const mode =
    mapped.request.mode === "create_from_zero" ? "create_from_zero" : "optimize_existing";

  const started = await startRun({
    id: crypto.randomUUID(),
    userId,
    resumeId,
    sessionId: null,
    requestId: parsed.input.runId,
    mode,
    writeMode: "direct",
    promptVersion: "p07-panel",
    modelId: modelConfig.modelName,
    deadlineAt: new Date(Date.now() + AI_REQUEST_LIMITS.routeDeadlineMs),
  });

  if (started.status === "existing") {
    return agUiErrorResponse(identity, "这条请求已经执行过，没有重复运行");
  }

  const lease = await acquireLease({
    runId: started.runId,
    userId,
    leaseOwner: crypto.randomUUID(),
    ttlMs: LEASE_TTL_MS,
  });
  if (lease.status !== "acquired") {
    const message =
      lease.status === "held_by_other"
        ? "这份简历上已有正在执行的任务，请等它结束"
        : "这次任务不能开始";
    return agUiErrorResponse(identity, message);
  }

  const runResponse = streamRunAttempt({
    runId: started.runId,
    resumeId,
    sessionId: null,
    userId,
    actorName: "用户",
    attemptId: crypto.randomUUID(),
    writeMode: "direct",
    fenceToken: lease.fenceToken,
    source,
    history,
    message,
    streamModel: provider.streamModel,
    requestSignal: req.signal,
  });

  return translateRunSseResponse(runResponse, identity);
}

async function readAgUiRun(
  req: Request,
): Promise<
  | { ok: true; input: ReturnType<typeof RunAgentInputSchema.parse> }
  | { ok: false; message: string }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, message: "请求体必须是合法 JSON" };
  }

  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, message: "AG-UI run input 不合法" };
  }

  return { ok: true, input: parsed.data };
}
