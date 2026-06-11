import { LangfuseClient } from "@langfuse/client";

import { loadConfig } from "../config.js";
import { loadAgentMessageEvalCases } from "./agent-message-contract-eval.js";
import { runLangfuseAgentMessageExperiment } from "./langfuse-agent-message-experiment.js";

const config = loadConfig();
const publicKey = config.langfuse.publicKey;
const secretKey = config.langfuse.secretKey;

if (!publicKey || !secretKey) {
  console.log(
    "Langfuse credentials are not configured; skipping Langfuse experiment.",
  );
  process.exit(0);
}

const client = new LangfuseClient({
  publicKey,
  secretKey,
  baseUrl: config.langfuse.baseUrl,
  timeout: config.langfuse.timeoutSeconds,
});
const cases = await loadAgentMessageEvalCases();
const result = await runLangfuseAgentMessageExperiment({
  client,
  cases,
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
