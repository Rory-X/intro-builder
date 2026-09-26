import { describe, expect, it } from "vitest";

import {
  evaluateAgentMessageContractCase,
  evaluateAgentMessageContractCases,
  formatAgentMessageEvalSummary,
  type AgentMessageEvalCase,
} from "../src/evals/agent-message-contract-eval";

describe("agent message contract eval", () => {
  it("passes a valid operation output that matches expectations", () => {
    const result = evaluateAgentMessageContractCase(validOperationCase());

    expect(result.passed).toBe(true);
    expect(result.scores.map((score) => [score.name, score.value, score.passed])).toEqual([
      ["valid_json", 1, true],
      ["contract_valid", 1, true],
      ["operation_count", 1, true],
      ["required_risk_flags", 1, true],
      ["required_field_paths", 1, true],
      ["forbidden_tokens_absent", 1, true],
    ]);
  });

  it("passes an expected invalid JSON case by proving the evaluator catches it", () => {
    const result = evaluateAgentMessageContractCase({
      id: "invalid-json",
      description: "Evaluator should detect invalid provider JSON.",
      modelOutput: "not-json",
      expectations: {
        expectValidJson: false,
        expectContractValid: false,
      },
    });

    expect(result.passed).toBe(true);
    expect(result.scores).toContainEqual({
      name: "valid_json",
      value: 0,
      passed: true,
      comment: "Expected invalid JSON and evaluator detected it.",
    });
  });

  it("fails when a forbidden fabrication token appears in otherwise valid output", () => {
    const result = evaluateAgentMessageContractCase({
      ...validOperationCase(),
      id: "fabricated-output",
      modelOutput: JSON.stringify({
        ...validOperationPayload(),
        proposedOperations: [
          {
            ...validOperationPayload().proposedOperations[0],
            afterPlainText: "推动性能优化，页面加载速度提升 300%。",
          },
        ],
      }),
      expectations: {
        ...validOperationCase().expectations,
        forbiddenTokens: ["提升 300%"],
      },
    });

    expect(result.passed).toBe(false);
    expect(result.scores).toContainEqual({
      name: "forbidden_tokens_absent",
      value: 0,
      passed: false,
      comment: "Forbidden tokens present: 提升 300%",
    });
  });

  it("summarizes case results for CI output", () => {
    const summary = evaluateAgentMessageContractCases([
      validOperationCase(),
      {
        id: "invalid-json",
        description: "Evaluator should detect invalid provider JSON.",
        modelOutput: "not-json",
        expectations: {
          expectValidJson: false,
          expectContractValid: false,
        },
      },
    ]);

    expect(summary.passed).toBe(true);
    expect(summary.totalCases).toBe(2);
    expect(summary.passedCases).toBe(2);
    expect(formatAgentMessageEvalSummary(summary)).toContain(
      "Agent message contract eval: 2/2 cases passed",
    );
  });
});

function validOperationCase(): AgentMessageEvalCase {
  return {
    id: "valid-operation",
    description: "A safe resume update operation with missing-fact risk flag.",
    modelOutput: JSON.stringify(validOperationPayload()),
    expectations: {
      expectValidJson: true,
      expectContractValid: true,
      expectedOperationCount: 1,
      requiredRiskFlags: ["needs_user_fact"],
      requiredFieldPaths: ["experience.0.content"],
      forbiddenTokens: ["提升 300%"],
    },
  };
}

function validOperationPayload() {
  return {
    message: {
      id: "msg_eval_safe",
      role: "assistant",
      content: "建议改写第一段经历，但结果指标需要你补充。",
    },
    toolCalls: [
      {
        id: "tool_eval_1",
        name: "resume_update_section",
        status: "completed",
        title: "改写工作经历",
        summary: "按 STAR 补足任务与行动。",
        input: { fieldPath: "experience.0.content" },
        result: { operationIds: ["op_eval_1"] },
      },
    ],
    proposedOperations: [
      {
        id: "op_eval_1",
        toolCallId: "tool_eval_1",
        label: "优化工作经历",
        section: "experience",
        fieldPath: "experience.0.content",
        operation: "update_section",
        beforePlainText: "负责前端开发。",
        afterPlainText: "围绕页面性能问题推进前端优化，结果指标待补充。",
        changeSummary: "补足任务和行动，不编造结果。",
        riskFlags: [
          {
            type: "needs_user_fact",
            message: "请补充真实性能提升指标。",
          },
        ],
      },
    ],
  };
}
