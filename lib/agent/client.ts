import { randomUUID } from "node:crypto";

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
  | "internal_error"
  | "agent_timeout"
  | "agent_unavailable";

export type AgentSessionResponse = {
  status: "ok";
  subject: string;
  resumeId: string | null;
  scope: string;
  expiresAt: string;
  requestId: string;
};

export type RichTextPolishRequest = {
  resumeId: string;
  section:
    | "summary"
    | "experience"
    | "projects"
    | "education"
    | "skills"
    | "research"
    | "custom";
  fieldPath: string;
  locale: "zh-CN";
  content: {
    format: "plain_text" | "tiptap_json";
    plainText: string;
    tiptapJson?: unknown;
  };
  intent: {
    mode: "polish";
    tone: "professional" | "confident" | "concise";
    length: "same" | "shorter" | "longer";
    strategy?: "plain" | "star";
  };
};

export type RichTextPolishResponse = {
  status: "ok";
  requestId: string;
  result: {
    format: "plain_text";
    polishedText: string;
    changeSummary: string;
    riskFlags: Array<{
      type:
        | "possible_fabrication"
        | "changed_entity"
        | "too_little_context"
        | "unsafe_claim";
      message: string;
    }>;
  } | {
    format: "tiptap_json";
    polishedText: string;
    replacementTiptapJson: unknown;
    changeSummary: string;
    riskFlags: Array<{
      type:
        | "possible_fabrication"
        | "changed_entity"
        | "too_little_context"
        | "unsafe_claim";
      message: string;
    }>;
  };
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};

export type ResumeHelperId = "resume-diagnose" | "section-next-steps";

export type ResumeHelperRequest = {
  resumeId: string;
  locale: "zh-CN";
  target:
    | { kind: "resume"; section: null; fieldPath: null }
    | {
        kind: "section";
        section:
          | "summary"
          | "experience"
          | "projects"
          | "education"
          | "skills"
          | "research"
          | "custom";
        fieldPath: string | null;
      };
  context: {
    resumeTitle: string;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{ key: string; label: string; plainText: string }>;
  };
  intent: {
    mode: "diagnose" | "next_steps";
    maxSuggestions: number;
    strategy: "plain" | "star";
  };
};

export type ResumeHelperResponse = {
  status: "ok";
  requestId: string;
  helperId: ResumeHelperId;
  result: {
    summary: string;
    suggestions: Array<{
      id: string;
      section: string;
      fieldPath: string;
      severity: "high" | "medium" | "low";
      title: string;
      rationale: string;
      actionLabel: string;
      example: string;
      riskFlags: Array<{
        type:
          | "needs_user_fact"
          | "possible_fabrication"
          | "too_little_context"
          | "formatting_risk";
        message: string;
      }>;
    }>;
  };
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};

export type AgentClientResult<T> = {
  data: T;
  requestId: string;
};

export type CreateAgentClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  createRequestId?: () => string;
};

export class AgentClientError extends Error {
  statusCode: number;
  error: AgentErrorCode;
  requestId: string;
  retryAfterSeconds?: number;
  dependency?: string;

  constructor(
    message: string,
    options: {
      statusCode: number;
      error: AgentErrorCode;
      requestId: string;
      retryAfterSeconds?: number;
      dependency?: string;
    },
  ) {
    super(message);
    this.name = "AgentClientError";
    this.statusCode = options.statusCode;
    this.error = options.error;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.dependency = options.dependency;
  }
}

export type AgentClient = {
  getSession: (options: {
    token: string;
    requestId?: string;
  }) => Promise<AgentClientResult<AgentSessionResponse>>;
  polishRichText: (options: {
    token: string;
    request: RichTextPolishRequest;
    requestId?: string;
  }) => Promise<AgentClientResult<RichTextPolishResponse>>;
  runResumeHelper: (options: {
    token: string;
    helperId: ResumeHelperId;
    request: ResumeHelperRequest;
    requestId?: string;
  }) => Promise<AgentClientResult<ResumeHelperResponse>>;
};

const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = 10_000;

export function createAgentClient({
  baseUrl = process.env.AGENT_BASE_URL ?? DEFAULT_AGENT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = fetch,
  createRequestId = () => `req_${randomUUID()}`,
}: CreateAgentClientOptions = {}): AgentClient {
  return {
    getSession({ token, requestId = createRequestId() }) {
      return requestJson<AgentSessionResponse>({
        baseUrl,
        path: "/v1/session",
        method: "GET",
        token,
        requestId,
        timeoutMs,
        fetchFn,
      });
    },
    polishRichText({ token, request, requestId = createRequestId() }) {
      return requestJson<RichTextPolishResponse>({
        baseUrl,
        path: "/v1/rich-text/polish",
        method: "POST",
        token,
        requestId,
        body: request,
        timeoutMs,
        fetchFn,
      });
    },
    runResumeHelper({ token, helperId, request, requestId = createRequestId() }) {
      return requestJson<ResumeHelperResponse>({
        baseUrl,
        path: `/v1/resume/helpers/${encodeURIComponent(helperId)}`,
        method: "POST",
        token,
        requestId,
        body: request,
        timeoutMs,
        fetchFn,
      });
    },
  };
}

async function requestJson<T>({
  baseUrl,
  path,
  method,
  token,
  requestId,
  body,
  timeoutMs,
  fetchFn,
}: {
  baseUrl: string;
  path: string;
  method: "GET" | "POST";
  token: string;
  requestId: string;
  body?: unknown;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<AgentClientResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(joinUrl(baseUrl, path), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-Id": requestId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const responseRequestId = response.headers.get("x-request-id") ?? requestId;
    const responseBody = await readJson(response);

    if (!response.ok) {
      throw errorFromEnvelope(response.status, responseRequestId, responseBody);
    }

    return {
      data: responseBody as T,
      requestId: responseRequestId,
    };
  } catch (error) {
    if (error instanceof AgentClientError) throw error;

    if (isAbortError(error)) {
      throw new AgentClientError("Agent request timed out", {
        statusCode: 504,
        error: "agent_timeout",
        requestId,
      });
    }

    throw new AgentClientError("Agent request failed", {
      statusCode: 503,
      error: "agent_unavailable",
      requestId,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFromEnvelope(
  statusCode: number,
  fallbackRequestId: string,
  body: unknown,
): AgentClientError {
  if (isAgentErrorEnvelope(body)) {
    return new AgentClientError(body.message, {
      statusCode,
      error: body.error,
      requestId: body.requestId || fallbackRequestId,
      retryAfterSeconds: body.retryAfterSeconds,
      dependency: body.dependency,
    });
  }

  return new AgentClientError("Agent request failed", {
    statusCode,
    error: "agent_unavailable",
    requestId: fallbackRequestId,
  });
}

function isAgentErrorEnvelope(body: unknown): body is {
  error: AgentErrorCode;
  message: string;
  requestId: string;
  retryAfterSeconds?: number;
  dependency?: string;
} {
  if (!body || typeof body !== "object") return false;

  const value = body as Record<string, unknown>;
  return (
    typeof value.error === "string" &&
    typeof value.message === "string" &&
    typeof value.requestId === "string"
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
