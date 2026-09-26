import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";

import { assertServerRuntime } from "../server-guard";
import { validateProviderUrl } from "../provider-policy";
import { CORE_V1 } from "../prompts/core";
import {
  extractTipTapTextBlocks,
  parsePolishProviderResponse,
  validateRichTextPolishRequest,
  type RichTextPolishRequest,
  type RichTextPolishResult,
} from "./polish";
import { buildPolishPrompt } from "./polish-prompt";

/**
 * 润色能力的 Web 端执行器（P05 任务 4）。
 *
 * 取代旧微服务的 `polishRichText` + HTTP 转发。三件必须与旧实现**逐条对齐**的事，
 * 每件错了都会表现为「润色按钮不好用」而不会有明确报错：
 *
 * 1. **校验前置**：请求不合法直接返回 400/413，不发模型请求（省额度，也让错误
 *    更快到达用户）。
 * 2. **文本块数量必须传给 prompt**：TipTap 模式下模型要按块返回
 *    `polishedBlocks`，数量不符会被解析整体拒绝。不告诉它数量，它只能猜。
 * 3. **解析失败不等于调用失败**：模型可能返回了合法 JSON 但缺字段。
 *    两者都归为 `provider_error`，但错误消息必须保留**原因**
 *    （`invalid JSON` vs `missing polishedText`），否则排查时只能看到
 *    「润色失败」而不知道是模型行为问题还是网络问题。
 *
 * ## 为什么不复用 `lib/ai/provider.ts` 的 `createProviderStreamer`
 *
 * 那个函数返回的是**流式** `streamModel`（对话用）。润色需要一次性拿到完整
 * JSON 文本，用 `generateText` 更直接，也避免了「自己拼流再解析」的中间层。
 * 两者共享同一个 BYOK 契约与出站策略（都调 `validateProviderUrl`），
 * 因此没有「两条路径各有各的安全策略」的问题。
 */

assertServerRuntime("lib/ai/capabilities/polish-runner.ts");

export type PolishModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export type PolishRunOutcome =
  | { ok: true; result: RichTextPolishResult; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; status: 400 | 413; code: string; message: string };

export type PolishDeps = {
  /** 注入点：测试可替换，不需要真实模型。 */
  callModel?: (input: {
    system: string;
    prompt: string;
    config: PolishModelConfig;
  }) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;
};

/** 默认的模型调用。脱敏与出站校验与对话路径一致。 */
async function defaultCallModel(input: {
  system: string;
  prompt: string;
  config: PolishModelConfig;
}): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const provider = createOpenAICompatible({
    name: "intro-ai-polish-openai-compatible",
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

/**
 * 执行一次润色。
 *
 * 返回结构化结果而不抛异常：调用方（路由）需要把不同失败映射成不同 HTTP 状态，
 * 而异常只能给出一个笼统的 500。
 */
export async function runPolish(
  body: unknown,
  modelConfig: PolishModelConfig,
  deps: PolishDeps = {},
): Promise<PolishRunOutcome> {
  // 1. 请求校验前置。
  const validated = validateRichTextPolishRequest(body);
  if (!validated.ok) {
    return {
      ok: false,
      status: validated.statusCode,
      code: validated.error,
      message: validated.message,
    };
  }
  const request: RichTextPolishRequest = validated.request;

  // 2. 模型配置的地址策略。与对话路径同一套判据。
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

  /*
   * 3. 文本块数量：TipTap 模式下模型必须按块返回 polishedBlocks。
   *
   * 不传数量会让模型只能猜（猜错的后果是解析整体拒绝，用户看到「润色失败」
   * 但原因是「块数对不上」）。plain_text 模式下数量为 0，prompt 里会说明。
   */
  const textBlockCount =
    request.content.format === "tiptap_json" && request.content.tiptapJson !== undefined
      ? extractTipTapTextBlocks(request.content.tiptapJson).length
      : 0;

  const prompt = buildPolishPrompt(request, CORE_V1, textBlockCount);
  const user = [prompt.developer, "", prompt.user].join("\n");

  let called: { content: string; inputTokens: number; outputTokens: number };
  try {
    called = await (deps.callModel ?? defaultCallModel)({
      system: prompt.system,
      prompt: user,
      config: modelConfig,
    });
  } catch (error) {
    /*
     * provider 调用失败。消息里**可能**带 baseUrl 与 key（SDK 与 fetch 的错误
     * 常把目标 URL 拼进去），因此这里不回传原始消息，只给一个可操作的说明。
     */
    const detail = error instanceof Error ? error.message : "未知错误";
    return {
      ok: false,
      status: 400,
      code: "provider_unavailable",
      message: `模型服务调用失败：${redact(detail, modelConfig)}`,
    };
  }

  // 4. 解析。失败要保留**原因**，否则排查时只能看到笼统的「润色失败」。
  const parsed = parsePolishProviderResponse(called.content, request);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 400,
      code: "provider_response_invalid",
      message: `模型返回的内容不符合约定（${parsed.message}）`,
    };
  }

  return {
    ok: true,
    result: parsed.result,
    usage: { inputTokens: called.inputTokens, outputTokens: called.outputTokens },
  };
}

/** 错误脱敏：把 apiKey 与完整 baseUrl 从消息里去掉。与对话路径同一策略。 */
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
