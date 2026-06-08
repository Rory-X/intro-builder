import { createHash } from "node:crypto";

export type AgentJwtSecretDiagnostics = {
  isSet: boolean;
  rawLength: number;
  normalizedLength: number;
  normalizedSha256_12: string | null;
};

export function normalizeAgentJwtSecret(secret: string | undefined): string {
  let value = secret?.trim() ?? "";
  value = value.replace(/^export\s+/, "").trim();

  const assignment = value.match(/^AGENT_JWT_SECRET\s*=\s*([\s\S]*)$/);
  if (assignment) value = assignment[1]?.trim() ?? "";

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function getAgentJwtSecretDiagnostics(
  secret = process.env.AGENT_JWT_SECRET,
): AgentJwtSecretDiagnostics {
  const normalized = normalizeAgentJwtSecret(secret);

  return {
    isSet: Boolean(secret),
    rawLength: secret?.length ?? 0,
    normalizedLength: normalized.length,
    normalizedSha256_12:
      normalized.length > 0
        ? createHash("sha256").update(normalized).digest("hex").slice(0, 12)
        : null,
  };
}
