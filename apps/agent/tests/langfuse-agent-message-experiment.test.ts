import { describe, expect, it, vi } from "vitest";

import type { AgentMessageEvalCase } from "../src/evals/agent-message-contract-eval";
import {
  buildLangfuseAgentMessageExperimentParams,
  runLangfuseAgentMessageExperiment,
} from "../src/evals/langfuse-agent-message-experiment";

describe("Langfuse agent message experiment", () => {
  it("builds Langfuse experiment params from deterministic eval cases", async () => {
    const params = buildLangfuseAgentMessageExperimentParams({
      cases: [validCase()],
      runName: "ci-run",
    });

    expect(params.name).toBe("agent-message-contract");
    expect(params.runName).toBe("ci-run");
    expect(params.data).toHaveLength(1);
    expect(params.data[0]).toMatchObject({
      input: {
        caseId: "valid-case",
        description: "Valid output.",
        modelOutput: validCase().modelOutput,
      },
      expectedOutput: validCase().expectations,
      metadata: { caseId: "valid-case" },
    });

    const firstItem = params.data[0] as {
      input: {
        caseId: string;
        description: string;
        modelOutput: string;
      };
      expectedOutput: AgentMessageEvalCase["expectations"];
      metadata: { caseId: string };
    };
    const output = await params.task(firstItem);
    expect(output).toBe(validCase().modelOutput);
    const evaluations = await params.evaluators?.[0]?.({
      input: firstItem.input,
      output,
      expectedOutput: firstItem.expectedOutput,
      metadata: firstItem.metadata,
    });

    expect(evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "valid_json",
          value: 1,
          comment: "Provider output is valid JSON.",
          metadata: { passed: true },
        }),
        expect.objectContaining({
          name: "contract_valid",
          value: 1,
          metadata: { passed: true },
        }),
      ]),
    );
  });

  it("runs the built params through a Langfuse-compatible client", async () => {
    const experimentRun = vi.fn(async () => ({
      experimentId: "exp_test",
      runName: "ci-run",
      itemResults: [],
      runEvaluations: [],
      format: async () => "formatted result",
    }));
    const client = {
      experiment: { run: experimentRun },
      flush: vi.fn(async () => {}),
    };

    const result = await runLangfuseAgentMessageExperiment({
      client,
      cases: [validCase()],
      runName: "ci-run",
    });

    expect(experimentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "agent-message-contract",
        runName: "ci-run",
      }),
    );
    expect(client.flush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      experimentId: "exp_test",
      runName: "ci-run",
    });
  });
});

function validCase(): AgentMessageEvalCase {
  return {
    id: "valid-case",
    description: "Valid output.",
    modelOutput: JSON.stringify({
      message: {
        id: "msg_eval",
        role: "assistant",
        content: "建议补充真实结果。",
      },
      toolCalls: [],
      proposedOperations: [],
    }),
    expectations: {
      expectValidJson: true,
      expectContractValid: true,
      expectedOperationCount: 0,
    },
  };
}
