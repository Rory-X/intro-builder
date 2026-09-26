import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { assertServerRuntime } from "../server-guard";
import { validateProviderUrl } from "../provider-policy";
import { CORE_V1 } from "../prompts/core";
import {
  buildResumeHelperPrompt,
  countSuggestionOverflow,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
  type ResumeHelperId,
  type ResumeHelperResult,
} from "./resume-helpers";
import type { PolishModelConfig } from "./polish-runner";

/**
 * 简历 Helper 的 Web 端执行器（P05 任务 4）。
 *
 * 结构刻意与 `polish-runner.ts` 保持一致 —— 两个能力取代的是同一套
 * 微服务转发，若它们各写一套校验顺序与错误分类，就会出现
 * 「一个能力正确处理了上游失败、另一个没有」这类漂移。
 *
 * 保留三条与 polish 一致的约束：
 * 1. **校验前置**（不合法不发模型请求）；
 * 2. **地址策略同一套判据**（`validateProviderUrl`）；
 * 3. **失败保留原因**（「模型返回缺 summary」与「网络失败」排查方向不同）。
 *
 * 另有一条 helper 特有的：**建议数量超限不算解析失败**。
 * 内容本身可用，只是模型没遵守 `maxSuggestions`；把它当解析失败会让用户
 * 看到「AI 建议失败」而实际已有可用建议。因此超限时**截断并如实记录**，
 * 由调用方决定是否提示。
 */

assertServerRuntime("lib/ai/capabilities/resume-helper-runner.ts");

export type ResumeHelperRunOutcome =
  | {
      ok: true;
      result: ResumeHelperResult;
      usage: { inputTokens: number; outputTokens: number };
      /** 被截断的建议数（模型超出 maxSuggestions 时 > 0）。 */
      truncated: number;
    }
  | { ok: false; status: 400 | 413; code: string; message: string };

export type ResumeHelperDeps = {
  callModel?: (input: {
    system: string;
    prompt: string;
    config: PolishModelConfig;
  }) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
};

async function defaultCallModel(input: {
  system: string;
  prompt: string;
  config: PolishModelConfig;
}): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const provider = createOpenAICompatible({
    name: "intro-ai-helper-openai-compatible",
    baseURL: input.config.baseUrl,
    apiKey: input.config.apiKey,
    includeUsage: true,
  });

  const result = await generateText({
    model: provider(input.config.modelName),
    temperature: 0.2,
    system: input.system,
    prompt: input.prompt,
  });

  return {
    content: result.text,
    inputTokens: result.usage?.inputTokens ?? 0,
    outputTokens: result.usage?.outputTokens ?? 0,
  };
}

export async function runResumeHelper(
  body: unknown,
  helperId: ResumeHelperId,
  modelConfig: PolishModelConfig,
  deps: ResumeHelperDeps = {},
): Promise<ResumeHelperRunOutcome> {
  // 1. 请求校验前置。
  const validated = validateResumeHelperRequest(body, helperId);
  if (!validated.ok) {
    return {
      ok: false,
      status: validated.statusCode,
      code: validated.error,
      message: validated.message,
    };
  }
  const request = validated.request;

  // 2. 出站地址策略。与对话、润色路径同一套判据。
  const policy = validateProviderUrl(modelConfig.baseUrl);
  if (!policy.ok) {
    return { ok: false, status: 400, code: policy.code, message: policy.message };
  }
  if (!modelConfig.apiKey.trim()) {
    return { ok: false, status: 400, code: "missing_api_key", message: "缺少模型服务密钥" };
  }
  if (!modelConfig.modelName.trim()) {
    return { ok: false, status: 400, code: "missing_model_name", message: "缺少模型名称" };
  }

  const prompt = buildResumeHelperPrompt(request, CORE_V1);
  const user = [prompt.developer, "", prompt.user].join("\n");

  let called: { content: string; inputTokens: number; outputTokens: number };
  try {
    called = await (deps.callModel ?? defaultCallModel)({
      system: prompt.system,
      prompt: user,
      config: modelConfig,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    return {
      ok: false,
      status: 400,
      code: "provider_unavailable",
      message: `模型服务调用失败：${redact(detail, modelConfig)}`,
    };
  }

  // 3. 解析。
  const parsed = parseResumeHelperProviderResponse(called.content);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "provider_response_invalid",
      message: `模型返回的内容不符合约定（${parsed.message}）`,
    };
  }

  /*
   * 4. 超限截断（不当作失败）。
   *
   * 截断而不是整体拒绝：内容可用，只是数量超了。整体拒绝会让用户
   * 「什么都没得到」，而截断至少给出前几条 —— 并如实回报被截掉的数量。
   */
  const overflow = countSuggestionOverflow(parsed.result, request.intent.maxSuggestions);
  const result: ResumeHelperResult =
    overflow > 0
      ? { ...parsed.result, suggestions: parsed.result.suggestions.slice(0, request.intent.maxSuggestions) }
      : parsed.result;

  return {
    ok: true,
    result,
    usage: { inputTokens: called.inputTokens, outputTokens: called.outputTokens },
    truncated: overflow,
  };
}

/** 错误脱敏：与 polish-runner 同一策略（密钥与完整地址不入日志）。 */
function redact(message: string, config: PolishModelConfig): string {
  let out = message;
  if (config.apiKey.trim()) out = out.split(config.apiKey.trim()).join("[已脱敏]");
  if (config.baseUrl.trim()) {
    try {
      const url = new URL(config.baseUrl);
      out = out.split(config.baseUrl.trim()).join(`${url.protocol}//${url.host}`);
    } catch {
      out = out.split(config.baseUrl.trim()).join("[已脱敏的地址]");
    }
  }
  return out;
}
