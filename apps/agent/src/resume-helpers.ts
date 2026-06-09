import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentConfig } from "./config.js";
import type { AgentErrorCode } from "./errors.js";
import { RichTextPolishProviderError } from "./rich-text-polish.js";

export type ResumeHelperId = "resume-diagnose" | "section-next-steps";
export type ResumeHelperSection =
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills"
  | "research"
  | "custom";
export type ResumeHelperSeverity = "high" | "medium" | "low";
export type ResumeHelperRiskFlagType =
  | "needs_user_fact"
  | "possible_fabrication"
  | "too_little_context"
  | "formatting_risk";

export type ResumeHelperRequest = {
  requestId?: string;
  helperId: ResumeHelperId;
  resumeId: string;
  locale: "zh-CN";
  target:
    | { kind: "resume"; section: null; fieldPath: null }
    | { kind: "section"; section: ResumeHelperSection; fieldPath: string | null };
  context: {
    resumeTitle: string;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{ key: string; label: string; plainText: string }>;
  };
  intent: {
    mode: "diagnose" | "next_steps";
    maxSuggestions: number;
    strategy: "plain" | "star";
  };
};

export type ResumeHelperPrompt = {
  system: string;
  developer: string;
  user: string;
};

export type ResumeHelperSuggestion = {
  id: string;
  section: string;
  fieldPath: string;
  severity: ResumeHelperSeverity;
  title: string;
  rationale: string;
  actionLabel: string;
  example: string;
  riskFlags: Array<{ type: ResumeHelperRiskFlagType; message: string }>;
};

export type ResumeHelperResult = {
  summary: string;
  suggestions: ResumeHelperSuggestion[];
};

export type ResumeHelperUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type ResumeHelperProvider = {
  run: (options: {
    request: ResumeHelperRequest;
    prompt: ResumeHelperPrompt;
    session: AuthenticatedAgentSession;
    requestId: string;
  }) => Promise<{ content: string; usage: ResumeHelperUsage }>;
};

export type ResumeHelperValidationResult =
  | { ok: true; request: ResumeHelperRequest }
  | {
      ok: false;
      statusCode: 400 | 413;
      error: Extract<AgentErrorCode, "bad_request" | "payload_too_large">;
      message: string;
    };

export type ResumeHelperParseResult =
  | { ok: true; result: ResumeHelperResult }
  | { ok: false; message: string };

type ResumeHelperValidationFailure = Extract<
  ResumeHelperValidationResult,
  { ok: false }
>;

type RequiredStringResult =
  | { ok: true; value: string }
  | ResumeHelperValidationFailure;

const HELPER_IDS = new Set<ResumeHelperId>([
  "resume-diagnose",
  "section-next-steps",
]);
const SECTIONS = new Set<ResumeHelperSection>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);
const STRATEGIES = new Set<ResumeHelperRequest["intent"]["strategy"]>([
  "plain",
  "star",
]);
const SEVERITIES = new Set<ResumeHelperSeverity>(["high", "medium", "low"]);
const RISK_FLAG_TYPES = new Set<ResumeHelperRiskFlagType>([
  "needs_user_fact",
  "possible_fabrication",
  "too_little_context",
  "formatting_risk",
]);

const MAX_CONTEXT_PLAIN_TEXT_LENGTH = 12_000;
const MAX_SECTION_TEXT_LENGTH = 4_000;
const MAX_SUGGESTIONS = 5;

export function validateResumeHelperRequest(
  helperIdValue: string,
  body: unknown,
): ResumeHelperValidationResult {
  if (!HELPER_IDS.has(helperIdValue as ResumeHelperId)) {
    return badRequest("helperId is not supported");
  }
  const helperId = helperIdValue as ResumeHelperId;

  if (!isRecord(body)) return badRequest("Request body must be a JSON object");

  const resumeId = requiredString(body.resumeId, "resumeId");
  if (!resumeId.ok) return resumeId;

  const locale = body.locale ?? "zh-CN";
  if (locale !== "zh-CN") return badRequest("locale must be zh-CN");

  if (!isRecord(body.target)) return badRequest("target is required");
  const target = validateTarget(helperId, body.target);
  if (!target.ok) return target;

  if (!isRecord(body.context)) return badRequest("context is required");
  const context = validateContext(body.context);
  if (!context.ok) return context;

  const intent = validateIntent(helperId, isRecord(body.intent) ? body.intent : {});
  if (!intent.ok) return intent;

  return {
    ok: true,
    request: {
      helperId,
      resumeId: resumeId.value,
      locale,
      target: target.value,
      context: context.value,
      intent: intent.value,
    },
  };
}

export function buildResumeHelperPrompt(
  request: ResumeHelperRequest,
): ResumeHelperPrompt {
  return {
    system: [
      "你是 intro-builder 的中文简历诊断助手。",
      "你的任务是基于用户提供的当前简历内容，给出可执行的简历改进建议。",
      "严格规则：",
      "1. 不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果。",
      "2. 不得把建议写成已经发生的事实。",
      "3. 需要用户补充事实时，必须用 riskFlags 标记 needs_user_fact。",
      "4. 输出建议必须具体到 section 或 fieldPath，但不得直接要求 Agent 写入数据库。",
      "5. 输出必须是合法 JSON，不要 Markdown，不要解释过程。",
    ].join("\n"),
    developer: [
      "输出 JSON schema：",
      '{"summary":"string","suggestions":[{"id":"string","section":"string","fieldPath":"string","severity":"high|medium|low","title":"string","rationale":"string","actionLabel":"string","example":"string","riskFlags":[{"type":"needs_user_fact|possible_fabrication|too_little_context|formatting_risk","message":"string"}]}]}',
      "输出必须是合法 JSON。",
      "suggestions 数量必须小于等于 intent.maxSuggestions。",
      "当 strategy=star 时，按 STAR 原则提出建议，只能建议用户补充 Situation、Task、Action、Result 中缺失的信息；Result 必须由用户提供事实或数据。",
      "example 可以给写作方向，但不能伪造可量化结果。",
      `当前 helperId=${request.helperId}。`,
      `当前 strategy=${request.intent.strategy}。`,
      `当前 maxSuggestions=${request.intent.maxSuggestions}。`,
    ].join("\n"),
    user: [
      "请基于以下简历上下文给出改进建议。",
      "请求信息：",
      `- requestId: ${request.requestId ?? ""}`,
      `- helperId: ${request.helperId}`,
      `- target.kind: ${request.target.kind}`,
      `- target.section: ${request.target.kind === "section" ? request.target.section : ""}`,
      `- target.fieldPath: ${request.target.fieldPath ?? ""}`,
      `- locale: ${request.locale}`,
      `- resumeTitle: ${request.context.resumeTitle}`,
      "",
      "完成度：",
      `- overall: ${request.context.completeness.overall}`,
      ...request.context.completeness.sections.map(
        (section) =>
          `- ${section.key} (${section.label}): ${section.score}/${section.max}`,
      ),
      "",
      "简历文本片段：",
      ...request.context.sections.map(
        (section) =>
          `## ${section.key} (${section.label})\n${section.plainText}`,
      ),
    ].join("\n"),
  };
}

export function parseResumeHelperProviderResponse(
  content: string,
): ResumeHelperParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, message: "Provider returned invalid JSON" };
  }

  if (!isRecord(parsed)) {
    return { ok: false, message: "Provider response must be a JSON object" };
  }
  if (typeof parsed.summary !== "string" || parsed.summary.trim() === "") {
    return { ok: false, message: "Provider response missing summary" };
  }
  if (!Array.isArray(parsed.suggestions)) {
    return { ok: false, message: "Provider response missing suggestions" };
  }

  const suggestions: ResumeHelperSuggestion[] = [];
  for (const suggestion of parsed.suggestions) {
    if (!isRecord(suggestion)) {
      return { ok: false, message: "Provider suggestions must be objects" };
    }
    const normalized = parseSuggestion(suggestion);
    if (!normalized.ok) return normalized;
    suggestions.push(normalized.suggestion);
  }

  return {
    ok: true,
    result: {
      summary: parsed.summary.trim(),
      suggestions,
    },
  };
}

export function createOpenAICompatibleResumeHelperProvider(
  config: AgentConfig,
  fetchFn: typeof fetch = fetch,
): ResumeHelperProvider | undefined {
  if (!config.modelBaseUrl || !config.modelApiKey || !config.modelName) {
    return undefined;
  }

  return {
    async run({ prompt }) {
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
                {
                  role: "system",
                  content: `${prompt.system}\n\n开发者指令：\n${prompt.developer}`,
                },
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
        const providerContent = extractOpenAICompatibleContent(body);
        if (!providerContent) {
          throw new RichTextPolishProviderError(
            "Provider response missing message content",
            "dependency_unavailable",
          );
        }
        const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
        return {
          content: providerContent,
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

function validateTarget(
  helperId: ResumeHelperId,
  target: Record<string, unknown>,
):
  | { ok: true; value: ResumeHelperRequest["target"] }
  | ResumeHelperValidationFailure {
  if (helperId === "resume-diagnose") {
    if (target.kind !== "resume") {
      return badRequest("target.kind must be resume for resume-diagnose");
    }
    return {
      ok: true,
      value: { kind: "resume", section: null, fieldPath: null },
    };
  }

  if (target.kind !== "section") {
    return badRequest("target.section is required for section-next-steps");
  }
  if (typeof target.section !== "string" || !SECTIONS.has(target.section as ResumeHelperSection)) {
    return badRequest("target.section is required for section-next-steps");
  }
  return {
    ok: true,
    value: {
      kind: "section",
      section: target.section as ResumeHelperSection,
      fieldPath: typeof target.fieldPath === "string" && target.fieldPath.trim() !== ""
        ? target.fieldPath.trim()
        : null,
    },
  };
}

function validateContext(
  context: Record<string, unknown>,
):
  | { ok: true; value: ResumeHelperRequest["context"] }
  | ResumeHelperValidationFailure {
  const resumeTitle =
    typeof context.resumeTitle === "string" && context.resumeTitle.trim() !== ""
      ? context.resumeTitle.trim()
      : "未填写目标岗位";

  if (!isRecord(context.completeness)) return badRequest("context.completeness is required");
  const completeness = parseCompleteness(context.completeness);
  if (!completeness.ok) return completeness;

  if (!Array.isArray(context.sections) || context.sections.length === 0) {
    return badRequest("context.sections must not be empty");
  }

  const sections: ResumeHelperRequest["context"]["sections"] = [];
  let totalPlainTextLength = 0;
  for (const section of context.sections) {
    if (!isRecord(section)) return badRequest("context.sections must be valid");
    const key = requiredString(section.key, "context.sections.key");
    if (!key.ok) return key;
    const label = requiredString(section.label, "context.sections.label");
    if (!label.ok) return label;
    const plainText = requiredString(section.plainText, "context.sections.plainText");
    if (!plainText.ok) return plainText;
    totalPlainTextLength += plainText.value.length;
    if (totalPlainTextLength > MAX_CONTEXT_PLAIN_TEXT_LENGTH) {
      return {
        ok: false,
        statusCode: 413,
        error: "payload_too_large",
        message: `context plain text must be at most ${MAX_CONTEXT_PLAIN_TEXT_LENGTH} characters`,
      };
    }
    if (plainText.value.length > MAX_SECTION_TEXT_LENGTH) {
      return {
        ok: false,
        statusCode: 413,
        error: "payload_too_large",
        message: `context.sections.plainText must be at most ${MAX_SECTION_TEXT_LENGTH} characters`,
      };
    }
    sections.push({
      key: key.value,
      label: label.value,
      plainText: plainText.value,
    });
  }

  return {
    ok: true,
    value: {
      resumeTitle,
      completeness: completeness.value,
      sections,
    },
  };
}

function parseCompleteness(
  completeness: Record<string, unknown>,
):
  | { ok: true; value: ResumeHelperRequest["context"]["completeness"] }
  | ResumeHelperValidationFailure {
  if (!isFiniteNumber(completeness.overall)) {
    return badRequest("context.completeness.overall is required");
  }
  if (!Array.isArray(completeness.sections)) {
    return badRequest("context.completeness.sections is required");
  }

  const sections: ResumeHelperRequest["context"]["completeness"]["sections"] = [];
  for (const section of completeness.sections) {
    if (!isRecord(section)) return badRequest("context.completeness.sections must be valid");
    const key = requiredString(section.key, "context.completeness.sections.key");
    if (!key.ok) return key;
    const label = requiredString(section.label, "context.completeness.sections.label");
    if (!label.ok) return label;
    if (!isFiniteNumber(section.score) || !isFiniteNumber(section.max)) {
      return badRequest("context.completeness.sections score and max are required");
    }
    sections.push({
      key: key.value,
      label: label.value,
      score: section.score,
      max: section.max,
    });
  }

  return {
    ok: true,
    value: {
      overall: completeness.overall,
      sections,
    },
  };
}

function validateIntent(
  helperId: ResumeHelperId,
  intent: Record<string, unknown>,
):
  | { ok: true; value: ResumeHelperRequest["intent"] }
  | ResumeHelperValidationFailure {
  const expectedMode = helperId === "resume-diagnose" ? "diagnose" : "next_steps";
  const mode = intent.mode ?? expectedMode;
  if (mode !== expectedMode) {
    return badRequest(`intent.mode must be ${expectedMode}`);
  }

  const defaultMaxSuggestions = helperId === "resume-diagnose" ? 5 : 3;
  const maxSuggestions = intent.maxSuggestions ?? defaultMaxSuggestions;
  if (
    typeof maxSuggestions !== "number" ||
    !Number.isInteger(maxSuggestions) ||
    maxSuggestions < 1 ||
    maxSuggestions > MAX_SUGGESTIONS
  ) {
    return badRequest(`intent.maxSuggestions must be between 1 and ${MAX_SUGGESTIONS}`);
  }

  const strategy = intent.strategy ?? "star";
  if (!STRATEGIES.has(strategy as ResumeHelperRequest["intent"]["strategy"])) {
    return badRequest("intent.strategy is not supported");
  }

  return {
    ok: true,
    value: {
      mode: expectedMode,
      maxSuggestions,
      strategy: strategy as ResumeHelperRequest["intent"]["strategy"],
    },
  };
}

function parseSuggestion(
  suggestion: Record<string, unknown>,
):
  | { ok: true; suggestion: ResumeHelperSuggestion }
  | { ok: false; message: string } {
  const requiredFields = [
    "id",
    "section",
    "fieldPath",
    "title",
    "rationale",
    "actionLabel",
  ] as const;
  for (const field of requiredFields) {
    if (typeof suggestion[field] !== "string" || suggestion[field].trim() === "") {
      return { ok: false, message: `Provider suggestion missing ${field}` };
    }
  }
  if (
    typeof suggestion.severity !== "string" ||
    !SEVERITIES.has(suggestion.severity as ResumeHelperSeverity)
  ) {
    return { ok: false, message: "Provider suggestion severity is invalid" };
  }
  if (typeof suggestion.example !== "string") {
    return { ok: false, message: "Provider suggestion missing example" };
  }
  if (!Array.isArray(suggestion.riskFlags)) {
    return { ok: false, message: "Provider suggestion missing riskFlags" };
  }

  const riskFlags: ResumeHelperSuggestion["riskFlags"] = [];
  for (const flag of suggestion.riskFlags) {
    if (!isRecord(flag)) {
      return { ok: false, message: "Provider riskFlags must be objects" };
    }
    if (
      typeof flag.type !== "string" ||
      !RISK_FLAG_TYPES.has(flag.type as ResumeHelperRiskFlagType) ||
      typeof flag.message !== "string" ||
      flag.message.trim() === ""
    ) {
      return { ok: false, message: "Provider riskFlags are invalid" };
    }
    riskFlags.push({
      type: flag.type as ResumeHelperRiskFlagType,
      message: flag.message.trim(),
    });
  }

  return {
    ok: true,
    suggestion: {
      id: String(suggestion.id).trim(),
      section: String(suggestion.section).trim(),
      fieldPath: String(suggestion.fieldPath).trim(),
      severity: suggestion.severity as ResumeHelperSeverity,
      title: String(suggestion.title).trim(),
      rationale: String(suggestion.rationale).trim(),
      actionLabel: String(suggestion.actionLabel).trim(),
      example: suggestion.example.trim(),
      riskFlags,
    },
  };
}

function requiredString(value: unknown, field: string): RequiredStringResult {
  if (typeof value !== "string" || value.trim() === "") {
    return badRequest(`${field} is required`);
  }
  return { ok: true, value: value.trim() };
}

function badRequest(message: string): ResumeHelperValidationFailure {
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
