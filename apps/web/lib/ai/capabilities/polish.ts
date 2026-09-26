/**
 * 富文本润色的纯逻辑（P05 任务 4：从微服务迁到 Web）。
 *
 * 逐字移植自 `apps/agent/src/rich-text-polish.ts` 的纯函数部分 ——
 * 校验、TipTap 提取与重建、provider 响应解析。**不**移植 provider 调用、
 * 鉴权与 Redis 缓存：那些在 Web 侧由 `lib/ai/provider.ts` 与路由各自负责。
 *
 * ## 为什么逐字移植而不是重写
 *
 * 这些函数里有若干**经验性细节**，重写时极易丢失，而丢失后不会报错、
 * 只会让润色结果默默变差：
 *
 * - `collectReplaceableTextBlocks` 只收**非空** paragraph，因此 `polishedBlocks`
 *   的数量必须与它一致 —— 数量不符时宁可整体拒绝（返回 `ok: false`），
 *   也不能按下标硬套，否则会把 B 段的内容写进 A 段。
 * - `createInlineContentForBlock` 专门处理「短标签 + 冒号 + 粗体」这种简历常见结构
 *   （`负责：xxx`）。它把粗体标签原样保留、只替换其后正文，否则润色一次就会
 *   把整个段落的加粗格式抹掉。
 * - `truncateStructureText` 只用于**给模型看的结构摘要**（120 字符截断），
 *   不影响实际写入的内容。
 *
 * 因此本文件保留原实现的函数结构与注释，只去掉微服务特有的依赖。
 */

// ─── 类型 ────────────────────────────────────────────────────

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

export type RichTextPolishRiskFlag = {
  type: "possible_fabrication" | "changed_entity" | "too_little_context" | "unsafe_claim";
  message: string;
};

type RichTextPolishBaseResult = {
  polishedText: string;
  changeSummary: string;
  riskFlags: RichTextPolishRiskFlag[];
};

export type RichTextPolishResult = RichTextPolishBaseResult &
  ({ format: "plain_text" } | { format: "tiptap_json"; replacementTiptapJson: unknown });

export type RichTextPolishValidationResult =
  | { ok: true; request: RichTextPolishRequest }
  | {
      ok: false;
      statusCode: 400 | 413;
      error: "bad_request" | "payload_too_large";
      message: string;
    };

type RichTextPolishValidationFailure = Extract<RichTextPolishValidationResult, { ok: false }>;
type RequiredStringResult = { ok: true; value: string } | RichTextPolishValidationFailure;

export type RichTextPolishParseResult =
  | { ok: true; result: RichTextPolishResult }
  | { ok: false; message: string };

type TipTapNode = {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: TipTapNode[];
  [key: string]: unknown;
};

// ─── 常量（与微服务版本一致） ─────────────────────────────────

const SECTIONS = new Set<RichTextPolishSection>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);
const TONES = new Set<RichTextPolishTone>(["professional", "confident", "concise"]);
const LENGTHS = new Set<RichTextPolishLength>(["same", "shorter", "longer"]);
const STRATEGIES = new Set<RichTextPolishStrategy>(["plain", "star"]);
const RISK_FLAG_TYPES = new Set<RichTextPolishRiskFlag["type"]>([
  "possible_fabrication",
  "changed_entity",
  "too_little_context",
  "unsafe_claim",
]);

const MAX_PLAIN_TEXT_LENGTH = 4_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function badRequest(message: string): RichTextPolishValidationFailure {
  return { ok: false, statusCode: 400, error: "bad_request", message };
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

function defaultStrategy(section: RichTextPolishSection): RichTextPolishStrategy {
  return section === "experience" || section === "projects" ? "star" : "plain";
}

// ─── 请求校验 ────────────────────────────────────────────────

/**
 * 校验润色请求。
 *
 * 长度上限（4000 字符）返回 **413** 而不是 400：请求形状是对的，只是太大。
 * 客户端据此可以提示「内容过长，请分段润色」而不是「参数错误」。
 */
export function validateRichTextPolishRequest(body: unknown): RichTextPolishValidationResult {
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
        ...(content.tiptapJson !== undefined ? { tiptapJson: content.tiptapJson } : {}),
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

// ─── TipTap 结构提取（供 prompt 使用） ───────────────────────

export function extractTipTapTextBlocks(tiptapJson: unknown): Array<{
  type: string;
  text: string;
}> {
  if (!isRecord(tiptapJson)) return [];

  const blocks: Array<{ type: string; text: string }> = [];
  visitTipTapNode(tiptapJson, blocks);
  return blocks;
}

function visitTipTapNode(
  node: Record<string, unknown>,
  blocks: Array<{ type: string; text: string }>,
): void {
  const type = typeof node.type === "string" ? node.type : "unknown";
  if (type === "paragraph") {
    const text = extractTipTapNodeText(node).trim();
    if (text) blocks.push({ type, text: truncateStructureText(text) });
    return;
  }

  if (!Array.isArray(node.content)) return;
  for (const child of node.content) {
    if (isRecord(child)) visitTipTapNode(child, blocks);
  }
}

function extractTipTapNodeText(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";

  return node.content.map((child) => (isRecord(child) ? extractTipTapNodeText(child) : "")).join("");
}

/**
 * 结构摘要里的文本截断。
 *
 * **只用于给模型看的结构摘要**，不影响任何写入内容。120 字符是经验值：
 * 足够模型判断这段在讲什么，又不会让整份简历的结构摘要撑爆上下文。
 */
function truncateStructureText(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

// ─── provider 响应解析 ───────────────────────────────────────

/**
 * 解析模型返回的 JSON。
 *
 * 严格到「任何一处不符就整体拒绝」：润色结果会直接被用户看到并可能落盘，
 * 部分解析（例如缺 `riskFlags` 就用空数组顶上）会掩盖模型没按 schema 输出这件事，
 * 而那种输出往往同时意味着内容不可靠。
 */
export function parsePolishProviderResponse(
  content: string,
  request?: RichTextPolishRequest,
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

  const result = createPolishResult({
    parsed,
    polishedText: polishedText.trim(),
    changeSummary: changeSummary.trim(),
    riskFlags: normalizedFlags,
    request,
  });
  if (!result.ok) return result;

  return { ok: true, result: result.value };
}

function createPolishResult({
  parsed,
  polishedText,
  changeSummary,
  riskFlags,
  request,
}: {
  parsed: Record<string, unknown>;
  polishedText: string;
  changeSummary: string;
  riskFlags: RichTextPolishRiskFlag[];
  request: RichTextPolishRequest | undefined;
}): { ok: true; value: RichTextPolishResult } | { ok: false; message: string } {
  const fallback: RichTextPolishResult = {
    format: "plain_text",
    polishedText,
    changeSummary,
    riskFlags,
  };
  if (
    request?.content.format !== "tiptap_json" ||
    request.content.tiptapJson === undefined ||
    parsed.polishedBlocks === undefined
  ) {
    return { ok: true, value: fallback };
  }

  const replacement = createReplacementTipTapJson(request.content.tiptapJson, parsed.polishedBlocks);
  if (!replacement.ok) {
    return {
      ok: false,
      message: "Provider polishedBlocks do not match TipTap text blocks",
    };
  }

  return {
    ok: true,
    value: {
      ...fallback,
      format: "tiptap_json",
      replacementTiptapJson: replacement.value,
    },
  };
}

/**
 * 用 `polishedBlocks` 重建 TipTap 文档。
 *
 * **数量必须严格一致**，否则整体拒绝（`ok: false`）。
 * 按下标硬套会在段落被合并/拆分时把内容写错位置 —— 这种错误不会报错，
 * 只会让用户看到「我这段怎么变成别的内容了」。
 */
function createReplacementTipTapJson(
  original: unknown,
  polishedBlocks: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (!Array.isArray(polishedBlocks)) return { ok: false };
  const blockTexts = polishedBlocks.map((block) => (typeof block === "string" ? block.trim() : ""));
  if (blockTexts.some((block) => block === "")) return { ok: false };

  const nextDoc = cloneJson(original);
  if (!isRecord(nextDoc)) return { ok: false };

  const textBlocks = collectReplaceableTextBlocks(nextDoc as TipTapNode);
  if (textBlocks.length === 0 || textBlocks.length !== blockTexts.length) {
    return { ok: false };
  }

  textBlocks.forEach((block, index) => {
    block.content = createInlineContentForBlock(block, blockTexts[index]);
  });

  return { ok: true, value: nextDoc };
}

function cloneJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** 只收非空 paragraph —— 与 `extractTipTapTextBlocks` 的口径必须一致。 */
function collectReplaceableTextBlocks(node: TipTapNode): TipTapNode[] {
  if (node.type === "paragraph") {
    return extractTipTapNodeText(node).trim() ? [node] : [];
  }
  return Array.isArray(node.content)
    ? node.content.flatMap((child) => collectReplaceableTextBlocks(child))
    : [];
}

/**
 * 为一个段落生成新的 inline content。
 *
 * 特例处理「短标签 + 冒号 + 加粗」这种简历常见结构（`负责：xxx`）：
 * 保留原标签节点与其 marks，只替换其后正文。不做这件事的话，
 * 润色一次就会把整段的加粗格式抹掉 —— 用户看到的是「格式丢了」。
 */
function createInlineContentForBlock(block: TipTapNode, nextText: string): TipTapNode[] {
  const textNodes = Array.isArray(block.content) ? block.content.filter(isTextNode) : [];
  const labelNode = textNodes[0];
  const labelText = typeof labelNode?.text === "string" ? labelNode.text : "";

  if (labelNode && hasMarks(labelNode) && isShortLabel(labelText) && nextText.startsWith(labelText)) {
    const rest = nextText.slice(labelText.length).trimStart();
    return [
      createTextNode(labelText, labelNode),
      ...(rest ? [createTextNode(rest, findNonBoldTextNode(textNodes) ?? labelNode)] : []),
    ];
  }

  return [createTextNode(nextText, textNodes[0])];
}

function isTextNode(node: TipTapNode): node is TipTapNode & { text: string } {
  return node.type === "text" && typeof node.text === "string";
}

function hasMarks(node: TipTapNode): boolean {
  return Array.isArray(node.marks) && node.marks.length > 0;
}

function isShortLabel(text: string): boolean {
  return text.length > 0 && text.length <= 24 && /[：:]$/.test(text);
}

function findNonBoldTextNode(nodes: TipTapNode[]): TipTapNode | undefined {
  return nodes.find((node) => {
    if (!Array.isArray(node.marks)) return true;
    return !node.marks.some((mark) => isRecord(mark) && mark.type === "bold");
  });
}

function createTextNode(text: string, template: TipTapNode | undefined): TipTapNode {
  return {
    type: "text",
    ...(template?.marks === undefined ? {} : { marks: cloneJson(template.marks) }),
    text,
  };
}
