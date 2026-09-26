/**
 * 少量示例（P05 任务 2）。
 *
 * spec §2 明确要求「每轮只注入相关的 **1–2 个**示例」，并且
 * 「示例中的名字与技术必须明确为**演示**，不得进入工具写入」。
 *
 * 两条对应的机械保障：
 *
 * 1. `selectExamples(intent)` 最多返回 2 条，按意图挑选 ——
 *    全部注入会让 core 的注意力被示例挤占，且示例越多，模型越倾向于
 *    照抄示例里的技术名与数字。
 * 2. 每条示例的正文里显式标注「演示」，`assertExamplesAreSafe` 在加载期
 *    检查这个标注存在。缺标注的示例会被拒绝注册 ——
 *    历史教训是「示例里的名字被当成用户事实写进简历」。
 *
 * 示例文本取自 plan §5 的对照表，逐字保留其「无效 vs 有效」结构：
 * 只说「有效应当怎样」不如同时给出反例，后者能显著减少泛化建议。
 */

export type PromptExample = {
  id: string;
  /** 适用的意图。一个示例只服务一个意图，避免交叉诱导。 */
  intent: string;
  /** 场景一句话，帮助模型判断是否与本轮相似。 */
  scenario: string;
  /** 常见但无效的做法。 */
  ineffective: string;
  /** 可用的做法。 */
  effective: string;
};

export const EXAMPLES: readonly PromptExample[] = [
  {
    id: "ex-a-specific",
    intent: "rewrite",
    scenario: "有事实但缺少具体表达（演示场景，人名与技术名均为演示用）",
    ineffective: "建议使用 STAR 法则，补充量化成果，突出技术亮点。",
    effective:
      "这句话没有让读者看见你处理的对象和方法。可改为：「负责订单查询接口开发，通过缓存与慢查询排查改善接口响应。」目前没有耗时数据，先保留定性结果即可。",
  },
  {
    id: "ex-b-scope",
    intent: "diagnose",
    scenario: "职责范围不能被拔高（演示场景）",
    ineffective: "主导支付系统架构设计，支撑百万交易。",
    effective:
      "「参与接口联调」无法判断你的工作深度。你主要负责协议对齐、失败排查，还是异常处理？补充其中实际做过的一项，就能写得更具体。",
  },
  {
    id: "ex-c-role-match",
    intent: "role_match",
    scenario: "岗位要求与简历证据的缺口（演示场景）",
    ineffective: "把 JD 里提到的缓存技术直接补进技能区。",
    effective:
      "岗位要求缓存经验，当前简历还没有对应证据。若你实际使用过，可以补充场景和取舍；没有使用过就保留现有数据库经验，优先说明查询优化。",
  },
  {
    id: "ex-d-concise",
    intent: "rewrite",
    scenario: "用户只要缩短，且已给足事实（演示场景）",
    ineffective: "先长篇诊断，再加 STAR 标题，并追问目标岗位。",
    effective: "直接给出两条保留技术名的精简版本，不再追问，也不加标题结构。",
  },
  {
    id: "ex-e-conflict",
    intent: "diagnose",
    scenario: "用户拒绝某项改动，以及手改造成冲突（演示场景）",
    ineffective: "换个说法重新提出被拒绝的改动，或把旧内容覆盖回去。",
    effective:
      "尊重拒绝，后续保留原岗位名、只优化其他句子。发生冲突时说明建议尚未保存，展示当前内容与提案，不用旧内容覆盖。",
  },
];

/**
 * 加载期自检：每条示例必须标注为演示。
 *
 * 缺标注的示例有很大概率被模型当成真实事实来源 —— 具体来说，
 * 示例里的技术名会被写进用户的技能区。这是真实发生过的失败模式，
 * 因此用机械检查而不是注释约定来防。
 */
export function assertExamplesAreSafe(examples: readonly PromptExample[] = EXAMPLES): void {
  const unsafe = examples.filter((example) => !example.scenario.includes("演示"));
  if (unsafe.length > 0) {
    throw new Error(
      `[prompts] 以下示例未标注「演示」，可能被当成用户事实写入简历：` +
        unsafe.map((example) => example.id).join("、"),
    );
  }
}

// 模块加载即自检。
assertExamplesAreSafe();

/**
 * 按意图挑选示例，**最多两条**。
 *
 * 上限是机械的，不靠调用方自觉：spec §2 要求「每轮只注入相关的 1–2 个示例」，
 * 而「相关」的判定容易越放越宽。这里改为「匹配意图的前两条」，
 * 顺序稳定（与 `EXAMPLES` 声明顺序一致），因此同一输入的注入内容是确定的 ——
 * 这既让评测可复现，也避免了「每次注入不同示例导致结论漂移」。
 */
export function selectExamples(intent: string | null, limit = 2): PromptExample[] {
  if (!intent) return [];
  const cap = Math.min(Math.max(limit, 0), 2);
  return EXAMPLES.filter((example) => example.intent === intent).slice(0, cap);
}

/** 把示例渲染为注入文本。 */
export function renderExamples(examples: readonly PromptExample[]): string {
  if (examples.length === 0) return "";
  const lines = ["以下为演示示例，其中的姓名、公司和技术均为演示，不得作为用户事实写入简历："];
  for (const example of examples) {
    lines.push(`场景：${example.scenario}`);
    lines.push(`无效做法：${example.ineffective}`);
    lines.push(`有效做法：${example.effective}`);
  }
  return lines.join("\n");
}
