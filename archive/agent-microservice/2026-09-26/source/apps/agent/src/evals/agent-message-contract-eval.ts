import { readFile } from "node:fs/promises";

import { parseAgentMessageProviderResponse } from "../agent-messages.js";

export type AgentMessageEvalCase = {
  id: string;
  description: string;
  modelOutput: string;
  expectations: {
    expectValidJson?: boolean;
    expectContractValid?: boolean;
    expectedOperationCount?: number;
    requiredRiskFlags?: string[];
    requiredFieldPaths?: string[];
    forbiddenTokens?: string[];
  };
};

export type AgentMessageEvalScore = {
  name:
    | "valid_json"
    | "contract_valid"
    | "operation_count"
    | "required_risk_flags"
    | "required_field_paths"
    | "forbidden_tokens_absent";
  value: 0 | 1;
  passed: boolean;
  comment: string;
};

export type AgentMessageEvalResult = {
  caseId: string;
  description: string;
  passed: boolean;
  scores: AgentMessageEvalScore[];
};

export type AgentMessageEvalSummary = {
  passed: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  results: AgentMessageEvalResult[];
};

export function evaluateAgentMessageContractCase(
  testCase: AgentMessageEvalCase,
): AgentMessageEvalResult {
  const expectValidJson = testCase.expectations.expectValidJson ?? true;
  const expectContractValid =
    testCase.expectations.expectContractValid ?? expectValidJson;
  const scores: AgentMessageEvalScore[] = [];
  const jsonValid = isValidJson(testCase.modelOutput);

  scores.push({
    name: "valid_json",
    value: jsonValid ? 1 : 0,
    passed: jsonValid === expectValidJson,
    comment: jsonValid
      ? "Provider output is valid JSON."
      : expectValidJson
        ? "Provider output is not valid JSON."
        : "Expected invalid JSON and evaluator detected it.",
  });

  const parsed = parseAgentMessageProviderResponse(testCase.modelOutput);
  const contractValid = parsed.ok;
  scores.push({
    name: "contract_valid",
    value: contractValid ? 1 : 0,
    passed: contractValid === expectContractValid,
    comment: contractValid
      ? "Provider output satisfies the Agent message contract."
      : expectContractValid
        ? parsed.message
        : `Expected contract failure and evaluator detected it: ${parsed.message}`,
  });

  if (testCase.expectations.expectedOperationCount !== undefined) {
    const actualCount = parsed.ok ? parsed.result.proposedOperations.length : 0;
    const expectedCount = testCase.expectations.expectedOperationCount;
    scores.push({
      name: "operation_count",
      value: actualCount === expectedCount ? 1 : 0,
      passed: actualCount === expectedCount,
      comment: `Expected ${expectedCount} operations, got ${actualCount}.`,
    });
  }

  if (testCase.expectations.requiredRiskFlags?.length) {
    const presentRiskFlags = new Set<string>(
      parsed.ok
        ? parsed.result.proposedOperations.flatMap((operation) =>
            operation.riskFlags.map((flag) => flag.type),
          )
        : [],
    );
    const missingRiskFlags = testCase.expectations.requiredRiskFlags.filter(
      (riskFlag) => !presentRiskFlags.has(riskFlag),
    );
    scores.push({
      name: "required_risk_flags",
      value: missingRiskFlags.length === 0 ? 1 : 0,
      passed: missingRiskFlags.length === 0,
      comment:
        missingRiskFlags.length === 0
          ? "All required risk flags are present."
          : `Missing risk flags: ${missingRiskFlags.join(", ")}`,
    });
  }

  if (testCase.expectations.requiredFieldPaths?.length) {
    const presentFieldPaths = new Set(
      parsed.ok
        ? parsed.result.proposedOperations.map((operation) => operation.fieldPath)
        : [],
    );
    const missingFieldPaths = testCase.expectations.requiredFieldPaths.filter(
      (fieldPath) => !presentFieldPaths.has(fieldPath),
    );
    scores.push({
      name: "required_field_paths",
      value: missingFieldPaths.length === 0 ? 1 : 0,
      passed: missingFieldPaths.length === 0,
      comment:
        missingFieldPaths.length === 0
          ? "All required field paths are present."
          : `Missing field paths: ${missingFieldPaths.join(", ")}`,
    });
  }

  if (testCase.expectations.forbiddenTokens?.length) {
    const presentForbiddenTokens = testCase.expectations.forbiddenTokens.filter(
      (token) => testCase.modelOutput.includes(token),
    );
    scores.push({
      name: "forbidden_tokens_absent",
      value: presentForbiddenTokens.length === 0 ? 1 : 0,
      passed: presentForbiddenTokens.length === 0,
      comment:
        presentForbiddenTokens.length === 0
          ? "No forbidden fabrication tokens are present."
          : `Forbidden tokens present: ${presentForbiddenTokens.join(", ")}`,
    });
  }

  return {
    caseId: testCase.id,
    description: testCase.description,
    passed: scores.every((score) => score.passed),
    scores,
  };
}

export function evaluateAgentMessageContractCases(
  cases: AgentMessageEvalCase[],
): AgentMessageEvalSummary {
  const results = cases.map(evaluateAgentMessageContractCase);
  const passedCases = results.filter((result) => result.passed).length;
  return {
    passed: passedCases === results.length,
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    results,
  };
}

export async function loadAgentMessageEvalCases(
  fileUrl = new URL("../../evals/agent-message-contract-cases.json", import.meta.url),
): Promise<AgentMessageEvalCase[]> {
  const content = await readFile(fileUrl, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Agent message eval cases file must contain a JSON array");
  }
  return parsed.map(parseEvalCase);
}

export function formatAgentMessageEvalSummary(
  summary: AgentMessageEvalSummary,
): string {
  const lines = [
    `Agent message contract eval: ${summary.passedCases}/${summary.totalCases} cases passed`,
  ];

  for (const result of summary.results) {
    const marker = result.passed ? "PASS" : "FAIL";
    lines.push(`${marker} ${result.caseId}: ${result.description}`);
    for (const score of result.scores) {
      lines.push(
        `  - ${score.name}: ${score.value} (${score.passed ? "pass" : "fail"}) ${score.comment}`,
      );
    }
  }

  return lines.join("\n");
}

function isValidJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parseEvalCase(value: unknown): AgentMessageEvalCase {
  if (!isRecord(value)) throw new Error("Eval case must be an object");
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error("Eval case id must be a non-empty string");
  }
  if (typeof value.description !== "string" || value.description.trim() === "") {
    throw new Error(`Eval case ${value.id} description must be a non-empty string`);
  }
  const modelOutput =
    typeof value.modelOutput === "string"
      ? value.modelOutput
      : JSON.stringify(value.modelOutput);
  if (!isRecord(value.expectations)) {
    throw new Error(`Eval case ${value.id} expectations must be an object`);
  }

  return {
    id: value.id,
    description: value.description,
    modelOutput,
    expectations: {
      expectValidJson: optionalBoolean(value.expectations.expectValidJson),
      expectContractValid: optionalBoolean(value.expectations.expectContractValid),
      expectedOperationCount: optionalNumber(
        value.expectations.expectedOperationCount,
      ),
      requiredRiskFlags: optionalStringArray(
        value.expectations.requiredRiskFlags,
      ),
      requiredFieldPaths: optionalStringArray(
        value.expectations.requiredFieldPaths,
      ),
      forbiddenTokens: optionalStringArray(value.expectations.forbiddenTokens),
    },
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error("Expected optional boolean");
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new Error("Expected optional number");
  }
  return value;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Expected optional string array");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
