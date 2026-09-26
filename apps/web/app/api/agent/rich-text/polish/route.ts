import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import { currentUserId } from "@/lib/auth-helpers";
import { runPolish, type PolishModelConfig } from "@/lib/ai/capabilities/polish-runner";
import { readModelConfigFromRequest } from "@/lib/ai/model-config-from-request";

/**
 * 富文本润色路由（P05 任务 4：从微服务迁到 Web）。
 *
 * 变更要点：**不再 HTTP 转发到旧 Agent 服务**。校验、提示词、TipTap 结构保持、
 * 响应解析全部在 Web 侧（`lib/ai/capabilities/*`），模型调用走 BYOK 配置。
 *
 * 旧实现里的 `signAgentToken` / `createAgentClient` 已完全移除 —— 保留它们会让
 * 这条路径继续依赖待退役的微服务，而「预览环境不配置 Agent URL 仍可用」是
 * 本切片要达成的目标。
 *
 * 对客户端**保持响应形状不变**（`status: "ok"` + `result` + `usage`），
 * 因此前端不需要改动。
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是合法 JSON" }, { status: 400 });
  }

  /*
   * 先取 resumeId 做归属校验。完整形状校验交给 runner（它持有契约），
   * 这里只做「能拿到 resumeId 才去查库」这一最小前置，避免为畸形请求白查一次库。
   */
  const resumeId = isRecord(body) && typeof body.resumeId === "string" ? body.resumeId : "";
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
   * 模型配置来自请求（BYOK）：浏览器从 session 取当前 key 随请求传，
   * 服务端不落库（P05 任务 5）。缺少配置时明确提示，**不回退已退役的服务**。
   */
  const config: PolishModelConfig | null = readModelConfigFromRequest(body);
  if (!config) {
    return Response.json(
      {
        error: "尚未配置模型，请先在设置中连接模型服务",
        code: "model_not_configured",
      },
      { status: 400 },
    );
  }

  const outcome = await runPolish(body, config);
  if (!outcome.ok) {
    /*
     * 失败按来源分流：
     * - `provider_response_invalid` / `provider_unavailable` 是**上游**问题，
     *   对客户端一律 502 —— 把「模型没按约定输出」说成用户参数错误会误导排查方向。
     * - 其余（校验失败、地址策略）本来就是 4xx，原样透出。
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
    result: outcome.result,
    usage: outcome.usage,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
