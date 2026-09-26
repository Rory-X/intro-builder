import { describe, expect, it } from "vitest";

import {
  EVAL_CASES,
  REQUIRED_CASE_COUNT,
  findFabricationHints,
  runOfflineEval,
  validateEvalCases,
  type EvalCase,
} from "@/lib/ai/evals/offline-eval";

/**
 * 离线评测的契约（P05 任务 6 的离线部分）。
 *
 * 这一层要防两类问题：
 *
 * 1. **评测集本身有缺漏**。某例的 `forbidden` 或 `hardFailure` 为空时，
 *    它永远不会失败 —— 通过率的分母被虚增，数字变得无意义。
 * 2. **把机械筛查当成质量判据**。spec §8 明确写着「不能用禁词扫描代表
 *    『无编造』」。因此禁词扫描只作为提示，且必须**先排除输入里已有的数字**，
 *    否则 Q14（要求保留用户给的数字）会被误报成编造。
 */

describe("评测集自洽性", () => {
  it("至少 16 例（spec §7 的硬要求）", () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(REQUIRED_CASE_COUNT);
  });

  it("自检无问题", () => {
    expect(validateEvalCases()).toEqual([]);
  });

  it("覆盖 spec §7 列出的全部 16 个 ID", () => {
    const ids = EVAL_CASES.map((item) => item.id).sort();
    const expected = Array.from({ length: 16 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`).sort();
    expect(ids).toEqual(expected);
  });

  it("每例都有 hardFailure 与 forbidden（否则该例永远不会失败，虚增通过率）", () => {
    for (const item of EVAL_CASES) {
      expect(item.hardFailure.trim(), item.id).not.toBe("");
      expect(item.forbidden.length, item.id).toBeGreaterThan(0);
    }
  });

  it("每例都有事实清单（否则无法判断是否编造）", () => {
    for (const item of EVAL_CASES) {
      expect(item.facts.length, item.id).toBeGreaterThan(0);
    }
  });

  it("ID 每个用例都不同", () => {
    const ids = EVAL_CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("自检能发现缺 hardFailure 的用例", () => {
    const broken: EvalCase[] = [
      { ...EVAL_CASES[0], hardFailure: "", forbidden: [] },
    ];
    const issues = validateEvalCases(broken);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.issue.includes("hardFailure"))).toBe(true);
  });

  it("自检能发现 ID 重复", () => {
    const duplicated: EvalCase[] = [EVAL_CASES[0], EVAL_CASES[0]];
    const issues = validateEvalCases(duplicated);
    expect(issues.some((issue) => issue.issue.includes("重复"))).toBe(true);
  });

  it("自检能发现用例数不足", () => {
    const issues = validateEvalCases(EVAL_CASES.slice(0, 5));
    expect(issues.some((issue) => issue.issue.includes("至少"))).toBe(true);
  });

  it("Q11（注入防护）的硬失败是权限/泄密", () => {
    const q11 = EVAL_CASES.find((item) => item.id === "Q11");
    expect(q11).toBeDefined();
    expect(q11?.hardFailure).toContain("泄密");
    expect(q11?.forbidden.join(" ")).toContain("系统提示词");
  });
});

describe("机械编造筛查（提示性质，不是通过判据）", () => {
  it("找出输出里新出现的百分比", () => {
    const hints = findFabricationHints("负责接口优化。", "优化后提升 40% 响应速度。");
    expect(hints).toHaveLength(1);
    expect(hints[0].pattern).toBe("百分比提升");
  });

  it("**先排除输入里已有的数字**（Q14 要求保留用户给的数字）", () => {
    // 输入里有 2.4s / 1.1s，输出保留它们是正确行为，不该报成编造。
    const hints = findFabricationHints(
      "把首页加载时间从 2.4s 降到 1.1s。",
      "把首页加载时间从 2.4s 降到 1.1s。",
    );
    expect(hints).toEqual([]);
  });

  it("找出『提升 N 倍』与『降低 N%』", () => {
    expect(findFabricationHints("x", "效率提升 3 倍").length).toBeGreaterThan(0);
    expect(findFabricationHints("x", "错误率降低 60%").length).toBeGreaterThan(0);
  });

  it("同一表述不重复报", () => {
    const hints = findFabricationHints("x", "提升 10% 与提升 10%");
    expect(hints).toHaveLength(1);
  });

  it("没有量化表述时不报", () => {
    expect(findFabricationHints("x", "负责订单查询接口开发，通过缓存改善响应。")).toEqual([]);
  });
});

describe("离线报告", () => {
  it("报告用例数、自检问题与真实对照状态", () => {
    const report = runOfflineEval();
    expect(report.caseCount).toBeGreaterThanOrEqual(REQUIRED_CASE_COUNT);
    expect(report.issues).toEqual([]);
    expect(report.fabricationHints).toEqual([]);
  });

  /*
   * spec §8 的硬要求：「真实评测未跑时标 not_run，不可提交假定分数」。
   * 这条断言把那个要求钉在代码里 —— 谁想让离线 runner 返回分数，
   * 必须先改这里并解释为什么。
   */
  it("真实对照状态永远是 not_run（没有评测配置就不填假定分数）", () => {
    expect(runOfflineEval().liveComparison).toBe("not_run");
    expect(runOfflineEval({ cases: EVAL_CASES }).liveComparison).toBe("not_run");
  });

  it("接受模拟回复时只产出提示，不产出分数", () => {
    const report = runOfflineEval({
      simulatedOutputs: { Q01: "优化后提升 40%。" },
    });
    expect(report.fabricationHints).toHaveLength(1);
    expect(report.fabricationHints[0].caseId).toBe("Q01");
    // 依然没有分数字段 —— 机械筛查不构成质量结论。
    expect(report).not.toHaveProperty("score");
    expect(report.liveComparison).toBe("not_run");
  });

  it("模拟回复对应不存在的用例时被忽略（不抛异常）", () => {
    const report = runOfflineEval({ simulatedOutputs: { "Q-unknown": "提升 99%" } });
    expect(report.fabricationHints).toEqual([]);
  });
});
