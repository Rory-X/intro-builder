import { describe, expect, it, vi } from "vitest";

import type { AgentMessageEvalCase } from "../src/evals/agent-message-contract-eval";
import {
  buildLangfuseAgentMessageExperimentParams,
  buildLangfuseAgentMessageDatasetExperimentParams,
  runLangfuseAgentMessageDatasetExperiment,
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

  it("runs deterministic evaluators through a Langfuse-hosted dataset", async () => {
    const runExperiment = vi.fn(async () => ({
      datasetRunId: "dataset_run_test",
      datasetRunUrl: "https://langfuse.test/project/abc/datasets/def/runs/ghi",
      format: async () => "dataset result",
    }));
    const datasetGet = vi.fn(async () => ({
      name: "intro-builder/agent-message-contract",
      items: [],
      runExperiment,
    }));
    const client = {
      dataset: { get: datasetGet },
      flush: vi.fn(async () => {}),
    };

    const result = await runLangfuseAgentMessageDatasetExperiment({
      client,
      datasetName: "intro-builder/agent-message-contract",
      runName: "dataset-ci-run",
      fetchItemsPageSize: 25,
    });

    expect(datasetGet).toHaveBeenCalledWith(
      "intro-builder/agent-message-contract",
      { fetchItemsPageSize: 25 },
    );
    expect(runExperiment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "agent-message-contract",
        runName: "dataset-ci-run",
      }),
    );
    expect(client.flush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      datasetRunId: "dataset_run_test",
    });
  });

  it("builds dataset experiment params without local data", async () => {
    const params = buildLangfuseAgentMessageDatasetExperimentParams({
      runName: "dataset-ci-run",
    });

    expect(params).not.toHaveProperty("data");
    expect(params.name).toBe("agent-message-contract");
    expect(params.runName).toBe("dataset-ci-run");

    const evaluations = await params.evaluators?.[0]?.({
      input: {
        caseId: "valid-case",
        description: "Valid output.",
        modelOutput: validCase().modelOutput,
      },
      output: validCase().modelOutput,
      expectedOutput: validCase().expectations,
      metadata: { caseId: "valid-case" },
    });

    expect(evaluations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "valid_json", value: 1 }),
      ]),
    );
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
