/**
 * 意图附加约束（P05 任务 2）。
 *
 * 文本逐字取自 plan §4 的表格。每条意图带三样东西：补充指令、有效输出、
 * **禁止行为**。第三列是这份表的核心价值 —— 它把「这类意图下最容易发生的
 * 越界」写成了明确禁令，而不是指望模型自己推断边界。
 *
 * 意图由**程序**从用户任务与 UI 上下文识别（见 `resolveIntent`），
 * 模型不能自选 intent，也不能修改 writeMode 或授权范围。
 */

export type PromptIntent =
  | "diagnose"
  | "rewrite"
  | "role_match"
  | "fact_intake"
  | "pre_export"
  | "create";

export type IntentConstraint = {
  /** 附在 core 之后的本轮约束。 */
  instruction: string;
  /** 本意图下**有效**的工具输出形态。 */
  validOutput: string;
  /** 明确禁止的行为。写进 prompt 让模型不必猜边界。 */
  forbidden: string;
};

export const INTENT_CONSTRAINTS: Readonly<Record<PromptIntent, IntentConstraint>> = {
  diagnose: {
    instruction: "找出当前最影响理解/岗位相关性的 2–3 项；每项有位置和动作。",
    validOutput: "advice artifacts，不改正文",
    forbidden: "顺手重写整份简历",
  },
  rewrite: {
    instruction: "保留事实、术语和结构，优先生成可用替换内容。",
    validOutput: "proposed 或 committed，附 evidenceRefs",
    forbidden: "只回复泛化建议却声称已优化",
  },
  role_match: {
    instruction: "把 JD 要求与简历证据一一对应，区分有/缺/不确定。",
    validOutput: "requirement-evidence-gap",
    forbidden: "从 JD 复制技术进入用户技能",
  },
  fact_intake: {
    instruction: "只追问影响当前任务的关键事实，已有事实不重复问。",
    validOutput: "question + target",
    forbidden: "一次抛十几项表单",
  },
  pre_export: {
    instruction: "分开核对内容风险与真实版式测量。",
    validOutput: "content checks + measured layout / estimate",
    forbidden: "字符数估算后保证一页",
  },
  create: {
    instruction: "在真实空简历草稿上逐步完善；未知事实保留为空。",
    validOutput: "按稳定 ID 的增量提案",
    forbidden: "虚构工作经历把完整度凑到 100",
  },
};

/**
 * 把意图约束渲染为注入文本。
 *
 * 把「禁止」单独成行并加粗前缀，而不是混在一段话里：这些是硬边界，
 * 与「建议这样做」的指令混在一起时容易被当成同一优先级。
 */
export function renderIntentConstraint(intent: PromptIntent): string {
  const constraint = INTENT_CONSTRAINTS[intent];
  return [
    `本轮意图：${intent}`,
    `要求：${constraint.instruction}`,
    `有效输出：${constraint.validOutput}`,
    `禁止：${constraint.forbidden}`,
  ].join("\n");
}

/**
 * 判断整条消息是否**只是一个回答**（用户在回答上一轮的追问）。
 *
 * 严格到「整句匹配」：
 *
 * - 用 `^(...)$` 而不是前缀匹配 —— 前缀匹配会把「是否……」「有没有……」
 *   这类**提问**也判成回答。
 * - 允许结尾的句读符号，但不允许省略号：`嗯……` 是犹豫，不是确认；
 *   把它当成事实回答会让模型基于一个并不存在的答案继续。
 * - 长度上限只是兜底（防止有人把一段长文以「是」开头就被判成回答），
 *   真正的判据是整句匹配。
 *
 * 只有命中这些「明确表态」才返回 true。任一不满足就交给后续关键词判断，
 * 无法判定时返回 null —— 不猜。
 */
function isBareAnswer(message: string): boolean {
  if (message.length > 30) return false;
  if (message.includes("…") || message.includes("...")) return false;
  return /^(是|是的|不是|对|对的|不对|嗯|好的?|有|没有|大概|约|应该|差不多|可以|不行)[，,。！!]?$/.test(
    message,
  );
}

/**
 * 从用户消息与 UI 上下文识别意图（P05 任务 2）。
 *
 * 由**程序**决定，不由模型自选：模型若能自选 intent，就等于能自己放宽
 * 本轮约束（例如把「只诊断」改成「可直接改写」）。
 *
 * 判据刻意是确定性的关键词 + 显式传入的上下文，不做语义猜测：
 * 误判的代价是模型做了用户没要求的事，而用户无法解释为什么。
 * 无法判定时返回 `null`，由装配层按「先给提案」的保守路径处理（spec §2）。
 */
export function resolveIntent(input: {
  message: string;
  /** UI 上下文：例如来自「导出前检查」按钮或空简历创建流。 */
  surface?: "export_check" | "create_from_zero" | "polish" | null;
}): PromptIntent | null {
  // 显式上下文优先：它比消息里的词更可靠。
  if (input.surface === "export_check") return "pre_export";
  if (input.surface === "create_from_zero") return "create";

  const message = input.message.trim();
  if (!message) return null;

  /*
   * 顺序：**先识别用户明确要求的动作，再判断「是否只是一个回答」**。
   *
   * 这个顺序是关键。此前的实现把「回答上一轮追问」放在最前面并用前缀匹配，
   * 于是「是的，帮我改一下」被判成 fact_intake —— 用户明确要求改写，
   * 却被套上「只追问、不改正文」的约束，表现得像它没听见。
   *
   * 「只是一个回答」必须用**整句匹配**而不是前缀匹配：`/^(是)/` 会命中
   * 「是否……」。同时排除省略号（「嗯……」是犹豫，不是确认），
   * 把它交给下面的关键词或 null。
   */
  if (isBareAnswer(message)) return "fact_intake";

  // 岗位匹配：提到岗位/JD/要求与匹配。
  if (/(岗位|JD|jd|招聘要求|匹配|符合要求)/.test(message)) return "role_match";

  // 诊断：明确不要改，或要求看问题。
  if (/(诊断|看看有什么问题|哪里不好|有哪些问题|评估|审阅|帮我看看)/.test(message)) {
    return "diagnose";
  }

  // 缩短/精简/改写类都归 rewrite（保留事实、优先给可用替换内容）。
  if (/(改|润色|优化|精简|缩短|扩写|重写|换个说法|写得更)/.test(message)) return "rewrite";

  // 无法判定：不猜。
  return null;
}
