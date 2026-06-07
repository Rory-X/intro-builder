export type AgentErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large"
  | "rate_limited"
  | "dependency_unavailable"
  | "provider_timeout"
  | "internal_error";

export type AgentErrorEnvelope = {
  error: AgentErrorCode;
  message: string;
  requestId: string;
  retryAfterSeconds?: number;
  dependency?: string;
};

export function createErrorEnvelope(
  envelope: AgentErrorEnvelope,
): AgentErrorEnvelope {
  return envelope;
}
