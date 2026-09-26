/**
 * 简历 Helper 的纯逻辑（P05 任务 4：从微服务迁到 Web）。
 *
 * 逐字移植自 `apps/agent/src/resume-helpers.ts` 的纯函数部分 —— 校验、
 * 提示词构造、provider 响应解析。**不**移植 provider 调用、鉴权与缓存：
 * 那些在 Web 侧由 `polish-runner` 同款的方式负责。
 *
 * ## 两个 helper 的差别（容易搞混，写在这里免得每次回去翻）
 *
 * | helper | target | intent.mode | 用途 |
 * |---|---|---|---|
 * | `resume-diagnose` | `kind: "resume"`，section/fieldPath 必须为 null | `diagnose` | 全份诊断 |
 * | `section-next-steps` | `kind: "section"`，section 必填 | `next_steps` | 单区块下一步 |
 *
 * `validateTarget` 会按 helperId 严格区分两者 —— 用错 kind 直接拒绝，
 * 因为「全份诊断」与「单区块建议」的提示词与产出结构完全不同。
 *
 * ## 为什么逐字移植
 *
 * `parseSuggestion` 要求 **7 个必填字符串字段 + severity 枚举 + riskFlags 数组**
 * 全部合规，任一不符整体拒绝。这种严格性是有意的：建议会直接展示给用户，
 * 部分解析（例如缺 `rationale` 就用空串顶上）会掩盖模型没按 schema 输出这件事，
 * 而那种输出往往同时意味着内容不可靠。
 */

// ─── 类型 ────────────────────────────────────────────────────

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

export type ResumeHelperPrompt = { system: string; developer: string; user: string };

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

export type ResumeHelperValidationResult =
  | { ok: true; request: ResumeHelperRequest }
  | { ok: false; statusCode: 400 | 413; error: "bad_request" | "payload_too_large"; message: string };

export type ResumeHelperParseResult =
  | { ok: true; result: ResumeHelperResult }
  | { ok: false; message: string };

type ResumeHelperValidationFailure = Extract<ResumeHelperValidationResult, { ok: false }>;
type RequiredStringResult = { ok: true; value: string } | ResumeHelperValidationFailure;

const SECTIONS = new Set<ResumeHelperSection>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);
const SEVERITIES = new Set<ResumeHelperSeverity>(["high", "medium", "low"]);
const RISK_FLAG_TYPES = new Set<ResumeHelperRiskFlagType>([
  "needs_user_fact",
  "possible_fabrication",
  "too_little_context",
  "formatting_risk",
]);

const MAX_CONTEXT_PLAIN_TEXT_LENGTH = 12_000;
const MAX_SUGGESTIONS = 5;

// ─── 辅助 ────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function badRequest(message: string): ResumeHelperValidationFailure {
  return { ok: false, statusCode: 400, error: "bad_request", message };
}

function requiredString(value: unknown, field: string): RequiredStringResult {
  if (typeof value !== "string" || value.trim() === "") {
    return badRequest(`${field} is required`);
  }
  return { ok: true, value: value.trim() };
}

// ─── 请求校验 ────────────────────────────────────────────────

/**
 * 校验 helper 请求。
 *
 * 注意「12 000 字」这条是**跨区块累加**的（不是单块），因为模型要看到全貌
 * 才能给整体建议。单块 4 000 字的限制在 polish 那条路径上。
 */
export function validateResumeHelperRequest(
  body: unknown,
  helperId: ResumeHelperId,
): ResumeHelperValidationResult {
  if (!isRecord(body)) return badRequest("Request body must be a JSON object");

  const resumeId = requiredString(body.resumeId, "resumeId");
  if (!resumeId.ok) return resumeId;

  const locale = body.locale ?? "zh-CN";
  if (locale !== "zh-CN") return badRequest("locale must be zh-CN");

  /*
   * 三个校验都写成**类型谓词**（`value is ...`）而不是返回 boolean。
   *
   * 这不仅是风格问题：返回 boolean 时 TS 无法收窄 `body.target`，
   * 下面访问 `body.target.section` 会报 TS18046（`'body.target' is of type
   * 'unknown'`）。写成谓词后，校验通过即收窄，后续访问天然安全 ——
   * 也不需要 `as` 强转掩盖问题。
   */
  if (!isValidTarget(helperId, body.target)) return badRequest("target is not valid");
  if (!isValidContext(body.context)) return badRequest("context is not valid");
  if (!isValidIntent(helperId, body.intent)) return badRequest("intent is not valid");

  if (helperId === "section-next-steps" && body.target.section === null) {
    return badRequest("section-next-steps requires target.section");
  }

  const context = body.context;
  if (context.sections.length === 0) return badRequest("context.sections must not be empty");

  const totalPlainTextLength = context.sections.reduce(
    (sum, section) => sum + section.plainText.length,
    0,
  );
  if (totalPlainTextLength > MAX_CONTEXT_PLAIN_TEXT_LENGTH) {
    return {
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: `context plainText must be at most ${MAX_CONTEXT_PLAIN_TEXT_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    request: {
      resumeId: resumeId.value,
      helperId,
      locale,
      target: body.target,
      context,
      intent: body.intent,
    },
  };
}

function isValidTarget(
  helperId: ResumeHelperId,
  value: unknown,
): value is ResumeHelperRequest["target"] {
  if (!isRecord(value)) return false;
  if (helperId === "resume-diagnose") {
    return value.kind === "resume" && value.section === null && value.fieldPath === null;
  }
  return (
    value.kind === "section" &&
    typeof value.section === "string" &&
    SECTIONS.has(value.section as ResumeHelperSection) &&
    (value.fieldPath === null || typeof value.fieldPath === "string")
  );
}

function isValidContext(value: unknown): value is ResumeHelperRequest["context"] {
  if (!isRecord(value)) return false;
  if (typeof value.resumeTitle !== "string") return false;
  if (!isRecord(value.completeness)) return false;
  if (typeof value.completeness.overall !== "number") return false;
  if (!Array.isArray(value.completeness.sections)) return false;
  if (!Array.isArray(value.sections)) return false;

  return (
    (value.completeness.sections as unknown[]).every(isCompletenessSection) &&
    (value.sections as unknown[]).every(isContextSection)
  );
}

function isCompletenessSection(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    typeof value.score === "number" &&
    typeof value.max === "number"
  );
}

function isContextSection(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    typeof value.plainText === "string"
  );
}

/** intent.mode 必须与 helperId 匹配（用错会产出结构不符的结果）。 */
function isValidIntent(helperId: ResumeHelperId, value: unknown): value is ResumeHelperRequest["intent"] {
  if (!isRecord(value)) return false;
  const expectedMode = helperId === "resume-diagnose" ? "diagnose" : "next_steps";
  const maxSuggestions = value.maxSuggestions;
  return (
    value.mode === expectedMode &&
    typeof maxSuggestions === "number" &&
    Number.isInteger(maxSuggestions) &&
    maxSuggestions >= 1 &&
    maxSuggestions <= MAX_SUGGESTIONS &&
    (value.strategy === "plain" || value.strategy === "star")
  );
}

// ─── 提示词 ──────────────────────────────────────────────────

/**
 * 构造 helper 提示词。
 *
 * `system` 与 polish 一样采用「新 core + 领域规则」的组合：core 由调用方注入
 * （便于评测时对照旧稿），这里保留 helper 特有的 4 条严格规则。
 *
 * `user` 段把简历拆成「完成度」与「文本片段」两块分别呈现 —— 完成度是**估算**，
 * 与真实内容分开，避免模型把评分当成事实依据。
 */
export function buildResumeHelperPrompt(
  request: ResumeHelperRequest,
  core: string,
): ResumeHelperPrompt {
  return {
    system: [
      core,
      "",
      "你是中文简历诊断助手，正在基于用户提供的当前简历内容给出可执行的改进建议。",
      "严格规则：",
      "1. 不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果。",
      "2. 不得把建议写成已经发生的事实。",
      "3. 需要用户补充事实时，必须用 riskFlags 标记 needs_user_fact。",
      "4. 输出建议必须具体到 section 或 fieldPath，但不得直接要求写入数据库。",
      "5. 输出必须是合法 JSON，不要 Markdown，不要解释过程。",
    ].join("\n"),
    developer: [
      "输出 JSON schema：",
      '{"summary":"string","suggestions":[{"id":"string","section":"string","fieldPath":"string","severity":"high|medium|low","title":"string","rationale":"string","actionLabel":"string","example":"string","riskFlags":[{"type":"needs_user_fact|possible_fabrication|too_little_context|formatting_risk","message":"string"}]}]}',
      "输出必须是合法 JSON。",
      `suggestions 数量必须小于等于 intent.maxSuggestions。`,
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
      "完成度（估算，非事实依据）：",
      `- overall: ${request.context.completeness.overall}`,
      ...request.context.completeness.sections.map(
        (section) => `- ${section.key} (${section.label}): ${section.score}/${section.max}`,
      ),
      "",
      "简历文本片段：",
      ...request.context.sections.map(
        (section) => `## ${section.key} (${section.label})\n${section.plainText}`,
      ),
    ].join("\n"),
  };
}

// ─── 响应解析 ────────────────────────────────────────────────

export function parseResumeHelperProviderResponse(content: string): ResumeHelperParseResult {
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

  return { ok: true, result: { summary: parsed.summary.trim(), suggestions } };
}

/** 逐条解析建议。任一必填字段不符即整体拒绝，不做部分填充。 */
function parseSuggestion(
  suggestion: Record<string, unknown>,
): { ok: true; suggestion: ResumeHelperSuggestion } | { ok: false; message: string } {
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
    riskFlags.push({ type: flag.type as ResumeHelperRiskFlagType, message: flag.message.trim() });
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

/**
 * 建议数量是否超出请求的 maxSuggestions。
 *
 * 单独一个函数而不是塞进 parse：数量超限**不是解析失败**（内容本身可用），
 * 而是「模型没遵守约束」。调用方可以选择截断或提示，
 * 但那是策略问题，不该由解析器替它决定。
 */
export function countSuggestionOverflow(
  result: ResumeHelperResult,
  maxSuggestions: number,
): number {
  return Math.max(0, result.suggestions.length - maxSuggestions);
}
