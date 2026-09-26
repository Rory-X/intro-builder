import type {
  RichTextPolishRequest,
  RichTextPolishStrategy,
} from "./polish";

/**
 * 润色能力的提示词（P05 任务 4 + 5）。
 *
 * 与旧微服务版本的差别只有一处，但很关键：**core 换成新候选稿**
 * （`lib/ai/prompts/core.ts`），旧的 6 条严格规则作为**领域补充**保留。
 *
 * 这样做的理由：
 *
 * - 旧 6 条规则（不得新增事实、不得把「参与」改成「主导」、不得改实体信息…）
 *   是润色场景特有的硬边界，与 core 的通用约束不重复，必须留。
 * - 但旧版本**只有**这 6 条，缺少 core 里那些「不要只说加强量化」
 *   「区分已有证据/尚未体现」的指导，因此润色结果容易变成
 *   「表达更顺但依然空泛」。
 *
 * schema 说明（developer 段）逐字保留：润色结果是机器解析的 JSON，
 * 改字段名会让解析整体失败，而失败表现为「润色按钮没反应」——
 * 用户无从判断原因。因此这段不参与提示词改版的自由度。
 */

/** 旧微服务的 6 条严格规则，逐字保留。 */
const STRICT_RULES = [
  "严格规则：",
  "1. 只基于用户提供的文本改写，不得新增事实、经历、数字、公司名、职位、技术栈、奖项或结果。",
  "2. 不得夸大成果，不得把“参与”改成“主导”，除非原文明确表达。",
  "3. 不得改变时间、地点、公司、学校、项目名称、人名、链接、邮箱、电话等实体信息。",
  "4. 保持原文语义，不要引入无法验证的信息。",
  "5. 如果原文信息过少，只做语言顺滑化，不补业务细节。",
  "6. 输出必须是合法 JSON，不要 Markdown，不要解释过程。",
].join("\n");

/** 风格说明按 tone 与 length 渲染。 */
function renderStyle(request: RichTextPolishRequest): string {
  const tone = {
    professional: "tone=professional: 稳健、正式、适合简历。",
    confident: "tone=confident: 更主动有力，但不能夸大。",
    concise: "tone=concise: 更短、更直接。",
  }[request.intent.tone];

  const length = {
    same: "length=same: 字数尽量接近原文，允许上下浮动 20%。",
    shorter: "length=shorter: 明显压缩但保留关键信息。",
    longer: "length=longer: 只能展开表达方式，不能新增事实。",
  }[request.intent.length];

  return ["风格要求：locale=zh-CN 时使用自然中文，不要中英混杂。", tone, length].join("\n");
}

/** STAR 策略的额外说明。只在 strategy=star 时注入。 */
function renderStrategy(strategy: RichTextPolishStrategy): string {
  if (strategy !== "star") return "";
  return [
    "当 strategy=star 时，优先使用 STAR 原则优化表达：",
    "Situation 只能使用原文已有背景；Task 明确职责但不得夸大；",
    "Action 强化已有动作、方法、技术手段；Result 只有原文明确提供结果、指标、收益时才能写入。",
    "如果原文缺少 Result，不要编造结果；可以更清晰地表达动作，并在 riskFlags 中加入 too_little_context。",
  ].join("\n");
}

/** TipTap 结构保持的说明。只在 format=tiptap_json 时注入。 */
function renderTipTapRule(request: RichTextPolishRequest): string {
  if (request.content.format !== "tiptap_json") return "";
  return [
    "当 content.format=tiptap_json 时，必须保持原 TipTap 富文本结构，并额外输出 polishedBlocks；",
    "polishedBlocks 必须与 textBlockCount 数量一致，并按原始文本块顺序逐项给出润色后的文本；",
    "不要自行添加 Markdown 列表符号或编号，不得合并或拆散原有段落、列表项层级。",
  ].join("\n");
}

export type PolishPrompt = { system: string; developer: string; user: string };

/**
 * 构造润色提示词。
 *
 * `core` 由调用方注入（来自 `prompts/core.ts`），而不是在这里 import：
 * 这样评测时可以把「旧 core」与「新 core」分别传进来做对照，
 * 而不需要为了对比去改这个文件的代码。
 */
export function buildPolishPrompt(
  request: RichTextPolishRequest,
  core: string,
  textBlockCount: number,
): PolishPrompt {
  const system = [
    core,
    "",
    "你是中文简历润色助手，正在润色用户提供的简历片段。",
    STRICT_RULES,
  ].join("\n");

  const developerLines = [
    "输出 JSON schema：",
    '{"polishedText":"string","polishedBlocks":["string"],"changeSummary":"string","riskFlags":[{"type":"possible_fabrication|changed_entity|too_little_context|unsafe_claim","message":"string"}]}',
    "必须输出合法 JSON，不要输出 Markdown、代码块或解释文字。",
    "字段要求：polishedText 是润色后的完整文本；changeSummary 用一句中文概括主要修改；riskFlags 无风险时为空数组。",
    renderStyle(request),
    renderStrategy(request.intent.strategy),
    renderTipTapRule(request),
    `当前 strategy=${request.intent.strategy}。`,
    `textBlockCount=${textBlockCount}。`,
  ].filter((line) => line !== "");

  return {
    system,
    developer: developerLines.join("\n"),
    user: request.content.plainText,
  };
}
