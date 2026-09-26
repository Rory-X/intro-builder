import {
  evaluateAgentMessageContractCases,
  formatAgentMessageEvalSummary,
  loadAgentMessageEvalCases,
} from "./agent-message-contract-eval.js";

const cases = await loadAgentMessageEvalCases();
const summary = evaluateAgentMessageContractCases(cases);

console.log(formatAgentMessageEvalSummary(summary));

if (!summary.passed) {
  process.exitCode = 1;
}
