import type { Evaluation, ExperimentParams } from "@langfuse/client";

import {
  evaluateAgentMessageContractCase,
  type AgentMessageEvalCase,
} from "./agent-message-contract-eval.js";

type ExperimentInput = {
  caseId: string;
  description: string;
  modelOutput: string;
};

type ExperimentExpectedOutput = AgentMessageEvalCase["expectations"];
type ExperimentMetadata = { caseId: string };

export type LangfuseAgentMessageExperimentClient = {
  experiment: {
    run: (
      params: ExperimentParams<
        ExperimentInput,
        ExperimentExpectedOutput,
        ExperimentMetadata
      >,
    ) => Promise<unknown>;
  };
  flush: () => Promise<void>;
};

export function buildLangfuseAgentMessageExperimentParams({
  cases,
  runName,
}: {
  cases: AgentMessageEvalCase[];
  runName?: string;
}): ExperimentParams<ExperimentInput, ExperimentExpectedOutput, ExperimentMetadata> {
  return {
    name: "agent-message-contract",
    runName,
    description:
      "Deterministic evaluation of Intro Builder Agent Mode structured outputs.",
    metadata: {
      suite: "agent-message-contract",
      source: "apps/agent/evals/agent-message-contract-cases.json",
    },
    data: cases.map((testCase) => ({
      input: {
        caseId: testCase.id,
        description: testCase.description,
        modelOutput: testCase.modelOutput,
      },
      expectedOutput: testCase.expectations,
      metadata: { caseId: testCase.id },
    })),
    task: async ({ input }) => toExperimentInput(input).modelOutput,
    evaluators: [
      async ({ input, output, expectedOutput }): Promise<Evaluation[]> => {
        const evalInput = toExperimentInput(input);
        const result = evaluateAgentMessageContractCase({
          id: evalInput.caseId,
          description: evalInput.description,
          modelOutput: String(output),
          expectations: expectedOutput ?? {},
        });

        return result.scores.map((score) => ({
          name: score.name,
          value: score.value,
          comment: score.comment,
          metadata: { passed: score.passed },
        }));
      },
    ],
    runEvaluators: [
      async ({ itemResults }) => {
        const totalScores = itemResults.flatMap((item) => item.evaluations);
        const passedScores = totalScores.filter(
          (score) => readPassedMetadata(score.metadata) === true,
        );
        return {
          name: "score_pass_rate",
          value: totalScores.length === 0 ? 0 : passedScores.length / totalScores.length,
          comment: `${passedScores.length}/${totalScores.length} individual scores passed.`,
        };
      },
    ],
    maxConcurrency: 1,
  };
}

function toExperimentInput(value: unknown): ExperimentInput {
  if (!value || typeof value !== "object") {
    return { caseId: "unknown", description: "Unknown eval case", modelOutput: "" };
  }
  const input = value as Partial<ExperimentInput>;
  return {
    caseId: typeof input.caseId === "string" ? input.caseId : "unknown",
    description:
      typeof input.description === "string"
        ? input.description
        : "Unknown eval case",
    modelOutput: typeof input.modelOutput === "string" ? input.modelOutput : "",
  };
}

function readPassedMetadata(metadata: unknown): boolean | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const value = (metadata as { passed?: unknown }).passed;
  return typeof value === "boolean" ? value : undefined;
}

export async function runLangfuseAgentMessageExperiment({
  client,
  cases,
  runName,
}: {
  client: LangfuseAgentMessageExperimentClient;
  cases: AgentMessageEvalCase[];
  runName?: string;
}): Promise<unknown> {
  const result = await client.experiment.run(
    buildLangfuseAgentMessageExperimentParams({ cases, runName }),
  );
  await client.flush();
  return result;
}
