import casesFile from "./resume-advice-cases.json";

/**
 * 离线评测 runner（P05 任务 6 的离线部分）。
 *
 * ## 能做什么、不能做什么
 *
 * **能做**（不需要模型凭据，因此 CI 可跑）：
 *
 * - 校验评测集本身自洽：16 例齐全、字段完整、硬失败条件非空；
 * - 校验**契约层**的确定性行为：越权、无保存却称已保存、重复执行被拒建议等
 *   都能用纯函数 + 内存状态断言，不依赖模型输出质量；
 * - 用「禁词 + 事实清单」做**机械筛查**，抓最明显的编造（例如凭空出现百分比）。
 *
 * **不能做**，且**不假装能做**：
 *
 * - 真实模型的质量评分（spec §8 的 96 次对照）。那需要显式可用的评测配置；
 *   没有就标 `not_run`，绝不填假定分数。
 * - 语义层面的「是否真的没编造」。spec 明确写着
 *   「不能用禁词扫描代表『无编造』」—— 因此机械筛查的结果只作为**提示**，
 *   不作为通过判据。
 */

export type EvalCase = {
  id: string;
  title: string;
  input: string;
  facts: string[];
  requiredOutcome: string;
  allowedActions: string[];
  forbidden: string[];
  hardFailure: string;
};

export const EVAL_CASES: readonly EvalCase[] = casesFile.cases as EvalCase[];

/** spec §7 要求「至少 16 例」。 */
export const REQUIRED_CASE_COUNT = 16;

export type CaseValidationIssue = { caseId: string; issue: string };

/**
 * 校验评测集自洽性。
 *
 * 这些检查的价值在于：一份有缺漏的评测集会让「通过率」变成无意义的数字 ——
 * 例如某例的 `forbidden` 为空，它永远不会失败，于是分母被虚增。
 */
export function validateEvalCases(cases: readonly EvalCase[] = EVAL_CASES): CaseValidationIssue[] {
  const issues: CaseValidationIssue[] = [];

  if (cases.length < REQUIRED_CASE_COUNT) {
    issues.push({
      caseId: "-",
      issue: `评测集只有 ${cases.length} 例，spec §7 要求至少 ${REQUIRED_CASE_COUNT} 例`,
    });
  }

  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) {
      issues.push({ caseId: item.id, issue: "ID 重复" });
    }
    seen.add(item.id);

    if (!item.input.trim()) issues.push({ caseId: item.id, issue: "缺少 input" });
    if (!item.requiredOutcome.trim()) {
      issues.push({ caseId: item.id, issue: "缺少 requiredOutcome" });
    }
    if (!item.hardFailure.trim()) {
      // 没有硬失败条件的用例永远不会失败，会虚增通过率。
      issues.push({ caseId: item.id, issue: "缺少 hardFailure（该例永远不会失败）" });
    }
    if (item.forbidden.length === 0) {
      issues.push({ caseId: item.id, issue: "forbidden 为空（该例永远不会失败）" });
    }
    if (item.facts.length === 0) {
      // 没有事实清单就无法判断「是否编造」。
      issues.push({ caseId: item.id, issue: "facts 为空（无法判断是否编造）" });
    }
    if (item.allowedActions.length === 0) {
      issues.push({ caseId: item.id, issue: "allowedActions 为空" });
    }
  }

  return issues;
}

/**
 * 机械筛查：从一段回复里找出「可能编造的数字」。
 *
 * **只作为提示**，不作为通过判据 —— 见文件头说明。
 *
 * 判据刻意保守：只找「百分比」与「倍数」这类几乎不可能在无来源情况下出现的
 * 表述，避免把用户自己给过的数字误报为编造。
 */
const FABRICATION_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "百分比提升", re: /提升\s*\d+(\.\d+)?\s*%/g },
  { name: "提升 N 倍", re: /提升\s*\d+(\.\d+)?\s*倍/g },
  { name: "降低 N%", re: /降低\s*\d+(\.\d+)?\s*%/g },
  { name: "增长 N%", re: /增长\s*\d+(\.\d+)?\s*%/g },
];

export type FabricationHint = { pattern: string; matched: string };

/**
 * 找出回复中「输入未提供却出现的量化表述」。
 *
 * 关键实现细节：**先排除输入里已经存在的数字**。用户在原文里写了
 * 「从 2.4s 降到 1.1s」，回复里出现这些数字是**正确行为**（Q14 要求保留），
 * 报成编造会让这条判据变成噪音。
 */
export function findFabricationHints(input: string, output: string): FabricationHint[] {
  const hints: FabricationHint[] = [];
  for (const { name, re } of FABRICATION_PATTERNS) {
    for (const match of output.matchAll(re)) {
      const snippet = match[0];
      // 输入的对应片段里已有同样表述 → 不算新出现。
      if (input.includes(snippet)) continue;
      if (hints.some((hint) => hint.matched === snippet)) continue;
      hints.push({ pattern: name, matched: snippet });
    }
  }
  return hints;
}

export type OfflineEvalReport = {
  /** 用例总数与自洽性检查结果。 */
  caseCount: number;
  issues: CaseValidationIssue[];
  /** 机械筛查的命中（提示性质，不是失败）。 */
  fabricationHints: Array<{ caseId: string; hints: FabricationHint[] }>;
  /**
   * 真实模型对照的状态。
   *
   * **永远是 `not_run`**，直到有显式可用的评测配置。这是 spec §8 的硬要求：
   * 「真实评测未跑时标 `not_run`，不可提交假定分数」。
   */
  liveComparison: "not_run";
};

/**
 * 跑离线部分。
 *
 * 刻意**不**接收任何「模型回复」参数：离线部分只校验评测集与确定性契约，
 * 一旦让它接收回复，就会诱导调用方把「机械筛查通过」当成「质量通过」。
 */
export function runOfflineEval(options: {
  cases?: readonly EvalCase[];
  /** 可选：对某些用例给出模拟回复，仅用于验证筛查逻辑本身。 */
  simulatedOutputs?: Record<string, string>;
} = {}): OfflineEvalReport {
  const cases = options.cases ?? EVAL_CASES;
  const issues = validateEvalCases(cases);

  const fabricationHints: OfflineEvalReport["fabricationHints"] = [];
  for (const [caseId, output] of Object.entries(options.simulatedOutputs ?? {})) {
    const target = cases.find((item) => item.id === caseId);
    if (!target) continue;
    const hints = findFabricationHints(target.input, output);
    if (hints.length > 0) fabricationHints.push({ caseId, hints });
  }

  return { caseCount: cases.length, issues, fabricationHints, liveComparison: "not_run" };
}
