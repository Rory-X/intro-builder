import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { currentUserId } from "@/lib/auth-helpers";
import { readModelConfigFromRequest } from "@/lib/ai/model-config-from-request";
import { runResumeHelper } from "@/lib/ai/capabilities/resume-helper-runner";
import type { ResumeHelperId } from "@/lib/ai/capabilities/resume-helpers";

/**
 * 简历 Helper 路由（P05 任务 4：从微服务迁到 Web）。
 *
 * 与润色路由同款改造：**不再 HTTP 转发到旧 Agent 服务**。
 * `signAgentToken` / `createAgentClient` 已完全移除 —— 保留它们会让这条路径
 * 继续依赖待退役的微服务，而「预览环境不配置 Agent URL 仍可用」是本切片的目标。
 *
 * 两个 helper（`resume-diagnose` 全份诊断 / `section-next-steps` 单区块下一步）
 * 共用同一路由与同一套校验，差别在 `helperId` 决定的 target 形状与 intent.mode
 * （由 `validateResumeHelperRequest` 严格区分 —— 用错 kind 直接拒绝）。
 *
 * 对客户端**保持响应形状不变**（`status: "ok"` + `helperId` + `result` + `usage`），
 * 前端无需改动。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ helperId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { helperId: rawHelperId } = await context.params;
  if (!isSupportedHelperId(rawHelperId)) {
    return Response.json({ error: "helperId 不支持" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  /*
   * 先取 resumeId 做归属校验，完整形状校验交给 runner（它持有契约）。
   * 只做「能拿到 resumeId 才去查库」这一最小前置，避免为畸形请求白查一次库。
   */
  const resumeId =
    body && typeof body === "object" && typeof (body as { resumeId?: unknown }).resumeId === "string"
      ? (body as { resumeId: string }).resumeId
      : "";
  if (!resumeId) {
    return Response.json({ error: "缺少 resumeId" }, { status: 400 });
  }

  const resume = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, resumeId), eq(resumes.userId, userId)),
    columns: { id: true },
  });
  if (!resume) {
    return Response.json({ error: "简历不存在" }, { status: 404 });
  }

  /*
   * 模型配置随请求传（BYOK），服务端不落库（P05 任务 5）。
   * 缺少配置时明确提示用户连接模型，**不回退已退役的服务**。
   */
  const config = readModelConfigFromRequest(body);
  if (!config) {
    return Response.json(
      {
        error: "尚未配置模型，请先在设置中连接模型服务",
        code: "model_not_configured",
      },
      { status: 400 },
    );
  }

  const outcome = await runResumeHelper(body, rawHelperId, config);
  if (!outcome.ok) {
    /*
     * 失败按来源分流（与润色路由同一策略）：
     * - 上游问题（模型返回不符约定 / 调用失败）报 502 —— 把「模型没按约定输出」
     *   说成用户参数错误会误导排查方向。
     * - 校验与地址策略保持 4xx。
     */
    const isUpstream =
      outcome.code === "provider_response_invalid" || outcome.code === "provider_unavailable";
    return Response.json(
      { error: outcome.message, code: outcome.code },
      { status: isUpstream ? 502 : outcome.status },
    );
  }

  return Response.json({
    status: "ok",
    helperId: rawHelperId,
    result: outcome.result,
    usage: outcome.usage,
    // 如实回报被截断的建议数（模型超出 maxSuggestions 时 > 0），
    // 让前端可提示「已展示前 N 条」而不是假装全部满足。
    ...(outcome.truncated > 0 ? { truncated: outcome.truncated } : {}),
  });
}

function isSupportedHelperId(value: string): value is ResumeHelperId {
  return value === "resume-diagnose" || value === "section-next-steps";
}
