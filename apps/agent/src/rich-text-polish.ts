import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentConfig } from "./config.js";
import type { AgentErrorCode } from "./errors.js";

export type RichTextPolishSection =
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills"
  | "research"
  | "custom";

export type RichTextPolishTone = "professional" | "confident" | "concise";
export type RichTextPolishLength = "same" | "shorter" | "longer";
export type RichTextPolishStrategy = "plain" | "star";

export type RichTextPolishRequest = {
  requestId?: string;
  resumeId: string;
  section: RichTextPolishSection;
  fieldPath: string;
  locale: "zh-CN";
  content: {
    format: "plain_text" | "tiptap_json";
    plainText: string;
    tiptapJson?: unknown;
  };
  intent: {
    mode: "polish";
    tone: RichTextPolishTone;
    length: RichTextPolishLength;
    strategy: RichTextPolishStrategy;
  };
};

export type RichTextPolishPrompt = {
  system: string;
  developer: string;
  user: string;
};

export type RichTextPolishRiskFlag = {
  type:
    | "possible_fabrication"
    | "changed_entity"
    | "too_little_context"
    | "unsafe_claim";
  message: string;
};

export type RichTextPolishResult = {
  format: "plain_text";
  polishedText: string;
  changeSummary: string;
  riskFlags: RichTextPolishRiskFlag[];
};

export type RichTextPolishUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type RichTextPolishProvider = {
  polish: (options: {
    request: RichTextPolishRequest;
    prompt: RichTextPolishPrompt;
    session: AuthenticatedAgentSession;
    requestId: string;
  }) => Promise<{
    content: string;
    usage: RichTextPolishUsage;
  }>;
};

export type RichTextPolishProviderFailureCode =
  | "dependency_unavailable"
  | "provider_timeout";

export class RichTextPolishProviderError extends Error {
  code: RichTextPolishProviderFailureCode;

  constructor(message: string, code: RichTextPolishProviderFailureCode) {
    super(message);
    this.name = "RichTextPolishProviderError";
    this.code = code;
  }
}

export type RichTextPolishValidationResult =
  | { ok: true; request: RichTextPolishRequest }
  | {
      ok: false;
      statusCode: 400 | 413;
      error: Extract<AgentErrorCode, "bad_request" | "payload_too_large">;
      message: string;
    };

type RichTextPolishValidationFailure = Extract<
  RichTextPolishValidationResult,
  { ok: false }
>;

type RequiredStringResult =
  | { ok: true; value: string }
  | RichTextPolishValidationFailure;

export type RichTextPolishParseResult =
  | { ok: true; result: RichTextPolishResult }
  | { ok: false; message: string };

const SECTIONS = new Set<RichTextPolishSection>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);
const TONES = new Set<RichTextPolishTone>([
  "professional",
  "confident",
  "concise",
]);
const LENGTHS = new Set<RichTextPolishLength>([
  "same",
  "shorter",
  "longer",
]);
const STRATEGIES = new Set<RichTextPolishStrategy>(["plain", "star"]);
const RISK_FLAG_TYPES = new Set<RichTextPolishRiskFlag["type"]>([
  "possible_fabrication",
  "changed_entity",
  "too_little_context",
  "unsafe_claim",
]);

const MAX_PLAIN_TEXT_LENGTH = 4_000;

export function validateRichTextPolishRequest(
  body: unknown,
): RichTextPolishValidationResult {
  if (!isRecord(body)) return badRequest("Request body must be a JSON object");

  const resumeId = requiredString(body.resumeId, "resumeId");
  if (!resumeId.ok) return resumeId;

  const sectionValue = requiredString(body.section, "section");
  if (!sectionValue.ok) return sectionValue;
  if (!SECTIONS.has(sectionValue.value as RichTextPolishSection)) {
    return badRequest("section is not supported");
  }
  const section = sectionValue.value as RichTextPolishSection;

  const fieldPath = requiredString(body.fieldPath, "fieldPath");
  if (!fieldPath.ok) return fieldPath;

  const locale = body.locale ?? "zh-CN";
  if (locale !== "zh-CN") return badRequest("locale must be zh-CN");

  if (!isRecord(body.content)) return badRequest("content is required");
  const content = body.content;
  const format = content.format ?? "plain_text";
  if (format !== "plain_text" && format !== "tiptap_json") {
    return badRequest("content.format is not supported");
  }
  const plainText = requiredString(content.plainText, "content.plainText");
  if (!plainText.ok) return plainText;
  if (plainText.value.length > MAX_PLAIN_TEXT_LENGTH) {
    return {
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: `content.plainText must be at most ${MAX_PLAIN_TEXT_LENGTH} characters`,
    };
  }

  const intent = isRecord(body.intent) ? body.intent : {};
  const mode = intent.mode ?? "polish";
  if (mode !== "polish") return badRequest("intent.mode must be polish");
  const tone = intent.tone ?? "professional";
  if (!TONES.has(tone as RichTextPolishTone)) {
    return badRequest("intent.tone is not supported");
  }
  const length = intent.length ?? "same";
  if (!LENGTHS.has(length as RichTextPolishLength)) {
    return badRequest("intent.length is not supported");
  }
  const strategy = intent.strategy ?? defaultStrategy(section);
  if (!STRATEGIES.has(strategy as RichTextPolishStrategy)) {
    return badRequest("intent.strategy is not supported");
  }

  return {
    ok: true,
    request: {
      resumeId: resumeId.value,
      section,
      fieldPath: fieldPath.value,
      locale,
      content: {
        format,
        plainText: plainText.value,
        ...(content.tiptapJson !== undefined
          ? { tiptapJson: content.tiptapJson }
          : {}),
      },
      intent: {
        mode: "polish",
        tone: tone as RichTextPolishTone,
        length: length as RichTextPolishLength,
        strategy: strategy as RichTextPolishStrategy,
      },
    },
  };
}

export function buildRichTextPolishPrompt(
  request: RichTextPolishRequest,
): RichTextPolishPrompt {
  return {
    system: [
      "你是 intro-builder 的中文简历润色助手。",
      "你的任务是润色用户提供的简历片段，让表达更专业、清晰、可信、适合中文互联网求职场景。",
      "严格规则：",
      "1. 只基于用户提供的文本改写，不得新增事实、经历、数字、公司名、职位、技术栈、奖项或结果。",
      "2. 不得夸大成果，不得把“参与”改成“主导”，除非原文明确表达。",
      "3. 不得改变时间、地点、公司、学校、项目名称、人名、链接、邮箱、电话等实体信息。",
      "4. 保持原文语义，不要引入无法验证的信息。",
      "5. 如果原文信息过少，只做语言顺滑化，不补业务细节。",
      "6. 输出必须是合法 JSON，不要 Markdown，不要解释过程。",
    ].join("\n"),
    developer: [
      "输出 JSON schema：",
      '{"polishedText":"string","changeSummary":"string","riskFlags":[{"type":"possible_fabrication|changed_entity|too_little_context|unsafe_claim","message":"string"}]}',
      "必须输出合法 JSON，不要输出 Markdown、代码块或解释文字。",
      "字段要求：polishedText 是润色后的文本；changeSummary 用一句中文概括主要修改；riskFlags 无风险时为空数组。",
      "风格要求：locale=zh-CN 时使用自然中文，不要中英混杂。",
      "tone=professional: 稳健、正式、适合简历。tone=confident: 更主动有力，但不能夸大。tone=concise: 更短、更直接。",
      "length=same: 字数尽量接近原文，允许上下浮动 20%。length=shorter: 明显压缩但保留关键信息。length=longer: 只能展开表达方式，不能新增事实。",
      "当 strategy=star 时，优先使用 STAR 原则优化表达：Situation 只能使用原文已有背景；Task 明确职责但不得夸大；Action 强化已有动作、方法、技术手段；Result 只有原文明确提供结果、指标、收益时才能写入。",
      "如果原文缺少 Result，不要编造结果；可以更清晰地表达动作，并在 riskFlags 中加入 too_little_context。",
      `当前 strategy=${request.intent.strategy}。`,
    ].join("\n"),
    user: [
      "请润色以下简历片段。",
      "上下文：",
      `- section: ${request.section}`,
      `- fieldPath: ${request.fieldPath}`,
      `- locale: ${request.locale}`,
      `- tone: ${request.intent.tone}`,
      `- length: ${request.intent.length}`,
      `- strategy: ${request.intent.strategy}`,
      "",
      "原文：",
      request.content.plainText,
    ].join("\n"),
  };
}

export function parsePolishProviderResponse(
  content: string,
): RichTextPolishParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, message: "Provider returned invalid JSON" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, message: "Provider response must be a JSON object" };
  }
  const polishedText = parsed.polishedText;
  const changeSummary = parsed.changeSummary;
  const riskFlags = parsed.riskFlags;
  if (typeof polishedText !== "string" || polishedText.trim() === "") {
    return { ok: false, message: "Provider response missing polishedText" };
  }
  if (typeof changeSummary !== "string" || changeSummary.trim() === "") {
    return { ok: false, message: "Provider response missing changeSummary" };
  }
  if (!Array.isArray(riskFlags)) {
    return { ok: false, message: "Provider response missing riskFlags" };
  }

  const normalizedFlags: RichTextPolishRiskFlag[] = [];
  for (const flag of riskFlags) {
    if (!isRecord(flag)) {
      return { ok: false, message: "Provider riskFlags must be objects" };
    }
    if (
      typeof flag.type !== "string" ||
      !RISK_FLAG_TYPES.has(flag.type as RichTextPolishRiskFlag["type"]) ||
      typeof flag.message !== "string" ||
      flag.message.trim() === ""
    ) {
      return { ok: false, message: "Provider riskFlags are invalid" };
    }
    normalizedFlags.push({
      type: flag.type as RichTextPolishRiskFlag["type"],
      message: flag.message.trim(),
    });
  }

  return {
    ok: true,
    result: {
      format: "plain_text",
      polishedText: polishedText.trim(),
      changeSummary: changeSummary.trim(),
      riskFlags: normalizedFlags,
    },
  };
}

export function createOpenAICompatibleRichTextPolishProvider(
  config: AgentConfig,
  fetchFn: typeof fetch = fetch,
): RichTextPolishProvider | undefined {
  if (!config.modelBaseUrl || !config.modelApiKey || !config.modelName) {
    return undefined;
  }

  return {
    async polish({ prompt }) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.modelTimeoutMs,
      );
      try {
        const response = await fetchFn(
          joinUrl(config.modelBaseUrl!, "/chat/completions"),
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.modelApiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: config.modelName,
              response_format: { type: "json_object" },
              thinking: { type: "disabled" },
              messages: [
                { role: "system", content: combineSystemAndDeveloperPrompt(prompt) },
                { role: "user", content: prompt.user },
              ],
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new RichTextPolishProviderError(
            `Provider request failed with ${response.status}`,
            "dependency_unavailable",
          );
        }
        const body = await response.json();
        const content = extractOpenAICompatibleContent(body);
        if (!content) {
          throw new RichTextPolishProviderError(
            "Provider response missing message content",
            "dependency_unavailable",
          );
        }
        const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
        return {
          content,
          usage: {
            provider: "openai-compatible",
            model: config.modelName!,
            inputTokens: numberOrZero(usage.prompt_tokens),
            outputTokens: numberOrZero(usage.completion_tokens),
          },
        };
      } catch (error) {
        if (error instanceof RichTextPolishProviderError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new RichTextPolishProviderError(
            "Provider request timed out",
            "provider_timeout",
          );
        }
        throw new RichTextPolishProviderError(
          error instanceof Error ? error.message : "Provider request failed",
          "dependency_unavailable",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function combineSystemAndDeveloperPrompt(
  prompt: RichTextPolishPrompt,
): string {
  return `${prompt.system}\n\n开发者指令：\n${prompt.developer}`;
}

function defaultStrategy(section: RichTextPolishSection): RichTextPolishStrategy {
  return section === "experience" || section === "projects" ? "star" : "plain";
}

function requiredString(
  value: unknown,
  field: string,
): RequiredStringResult {
  if (typeof value !== "string" || value.trim() === "") {
    return badRequest(`${field} is required`);
  }
  return { ok: true, value: value.trim() };
}

function badRequest(message: string): RichTextPolishValidationFailure {
  return {
    ok: false,
    statusCode: 400,
    error: "bad_request",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractOpenAICompatibleContent(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.choices)) return null;
  const [choice] = body.choices;
  if (!isRecord(choice) || !isRecord(choice.message)) return null;
  return typeof choice.message.content === "string" ? choice.message.content : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
