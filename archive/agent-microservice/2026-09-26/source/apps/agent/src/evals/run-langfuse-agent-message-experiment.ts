import { LangfuseClient } from "@langfuse/client";

import { loadConfig } from "../config.js";
import { runLangfuseAgentMessageDatasetExperiment } from "./langfuse-agent-message-experiment.js";

const config = loadConfig();
const publicKey = config.langfuse.publicKey;
const secretKey = config.langfuse.secretKey;

if (!publicKey || !secretKey) {
  console.log(
    "Langfuse credentials are not configured; skipping Langfuse experiment.",
  );
  process.exit(0);
}

if (!config.langfuse.agentMessageDatasetName) {
  console.error(
    "LANGFUSE_AGENT_MESSAGE_DATASET_NAME is required for dataset-backed Agent evals.",
  );
  process.exit(1);
}

const client = new LangfuseClient({
  publicKey,
  secretKey,
  baseUrl: config.langfuse.baseUrl,
  timeout: config.langfuse.timeoutSeconds,
});
const result = await runLangfuseAgentMessageDatasetExperiment({
  client,
  datasetName: config.langfuse.agentMessageDatasetName,
  fetchItemsPageSize: config.langfuse.datasetFetchItemsPageSize,
  runName:
    process.env.LANGFUSE_EXPERIMENT_RUN_NAME ??
    `agent-message-contract-${new Date().toISOString()}`,
});

if (isFormattableExperimentResult(result)) {
  console.log(await result.format({ includeItemResults: true }));
} else {
  console.log(JSON.stringify(result, null, 2));
}

function isFormattableExperimentResult(
  value: unknown,
): value is { format: (options?: { includeItemResults?: boolean }) => Promise<string> } {
  return Boolean(value) && typeof (value as { format?: unknown }).format === "function";
}
