import { jwtVerify } from "jose";

import type { AgentConfig } from "./config.js";
import type { AgentErrorCode } from "./errors.js";

export type AgentReplayStore = {
  set: (
    key: string,
    value: string,
    options: { NX: true; EX: number },
  ) => Promise<"OK" | null>;
};

export type AuthenticatedAgentSession = {
  userId: string;
  resumeId?: string;
  scope: string;
  jti: string;
  expiresAt: Date;
};

export type AgentAuthResult =
  | { ok: true; session: AuthenticatedAgentSession }
  | {
      ok: false;
      statusCode: 401 | 403 | 503;
      error: AgentErrorCode;
      message: string;
      dependency?: string;
      diagnosticReason?: string;
    };

type AgentAuthFailure = Extract<AgentAuthResult, { ok: false }>;

export type AuthenticateAgentRequestOptions = {
  authorizationHeader: string | undefined;
  expectedScope: string;
  config: AgentConfig;
  replayStore: AgentReplayStore | undefined;
  now?: Date;
};

type AgentJwtPayload = {
  scope?: unknown;
  resumeId?: unknown;
};

const textEncoder = new TextEncoder();

export async function authenticateAgentRequest({
  authorizationHeader,
  expectedScope,
  config,
  replayStore,
  now = new Date(),
}: AuthenticateAgentRequestOptions): Promise<AgentAuthResult> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    return authFailure(401, "unauthorized", "Missing bearer token");
  }

  if (!config.jwtSecret) {
    return authFailure(
      503,
      "dependency_unavailable",
      "JWT secret is not configured",
      "config",
    );
  }

  if (!replayStore) {
    return authFailure(
      503,
      "dependency_unavailable",
      "JWT replay guard is unavailable",
      "redis",
    );
  }

  const jwtSecrets = createJwtSecretCandidates(config.jwtSecret);
  if (jwtSecrets.length === 0) {
    return authFailure(
      503,
      "dependency_unavailable",
      "JWT secret is not configured",
      "config",
    );
  }

  const verified = await verifyJwtWithSecrets(token, config, jwtSecrets, now);
  if (!verified.ok) return verified;

  const { payload } = verified;
  const scope = payload.scope;
  if (scope !== expectedScope) {
    return authFailure(
      403,
      "forbidden",
      "Token scope is not allowed for this route",
    );
  }

  const replayResult = await reserveJwtId(
    replayStore,
    payload.jti,
    config.jwtReplayTtlSeconds,
  );
  if (!replayResult.ok) return replayResult;

  return {
    ok: true,
    session: {
      userId: payload.sub,
      ...(payload.resumeId ? { resumeId: payload.resumeId } : {}),
      scope,
      jti: payload.jti,
      expiresAt: new Date(payload.exp * 1_000),
    },
  };
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token) return null;

  return token;
}

async function verifyJwt(
  token: string,
  config: AgentConfig,
  jwtSecret: string,
  now: Date,
): Promise<
  | {
      ok: true;
      payload: {
        sub: string;
        scope: string;
        jti: string;
        exp: number;
        resumeId?: string;
      };
    }
  | AgentAuthFailure
> {
  try {
    const { payload } = await jwtVerify<AgentJwtPayload>(
      token,
      textEncoder.encode(jwtSecret),
      {
        issuer: config.jwtIssuer,
        audience: config.jwtAudience,
        currentDate: now,
      },
    );

    if (
      typeof payload.sub !== "string" ||
      typeof payload.jti !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.scope !== "string" ||
      (payload.resumeId !== undefined && typeof payload.resumeId !== "string")
    ) {
      return authFailure(401, "unauthorized", "Invalid bearer token claims");
    }

    return {
      ok: true,
      payload: {
        sub: payload.sub,
        scope: payload.scope,
        jti: payload.jti,
        exp: payload.exp,
        ...(payload.resumeId ? { resumeId: payload.resumeId } : {}),
      },
    };
  } catch (error) {
    return authFailure(
      401,
      "unauthorized",
      "Invalid or expired bearer token",
      undefined,
      classifyJwtVerifyFailure(error),
    );
  }
}

async function verifyJwtWithSecrets(
  token: string,
  config: AgentConfig,
  jwtSecrets: string[],
  now: Date,
): ReturnType<typeof verifyJwt> {
  let signatureFailure: AgentAuthFailure | null = null;

  for (const jwtSecret of jwtSecrets) {
    const verified = await verifyJwt(token, config, jwtSecret, now);
    if (verified.ok) return verified;

    if (verified.diagnosticReason !== "signature_verification_failed") {
      return verified;
    }

    signatureFailure = verified;
  }

  return (
    signatureFailure ??
    authFailure(
      401,
      "unauthorized",
      "Invalid or expired bearer token",
      undefined,
      "signature_verification_failed",
    )
  );
}

function createJwtSecretCandidates(secret: string | undefined): string[] {
  const candidates = [
    normalizeAgentJwtSecret(secret),
    normalizeLegacyWebJwtSecret(secret),
    secret?.trim() ?? "",
  ];

  return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
}

function normalizeAgentJwtSecret(secret: string | undefined): string {
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

function normalizeLegacyWebJwtSecret(secret: string | undefined): string {
  const trimmed = secret?.trim() ?? "";
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function classifyJwtVerifyFailure(error: unknown): string {
  if (!isRecord(error)) return "jwt_verify_failed";

  const code = typeof error.code === "string" ? error.code : "";
  const claim = typeof error.claim === "string" ? error.claim : "";
  const name = error.constructor?.name ?? "";

  if (code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    return "signature_verification_failed";
  }
  if (code === "ERR_JWT_EXPIRED") return "token_expired";
  if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && claim) {
    return `claim_validation_failed:${claim}`;
  }
  if (name) return `jwt_verify_failed:${name}`;

  return "jwt_verify_failed";
}

async function reserveJwtId(
  replayStore: AgentReplayStore,
  jti: string,
  ttlSeconds: number,
): Promise<{ ok: true } | AgentAuthFailure> {
  try {
    const result = await replayStore.set(`auth:jti:${jti}`, "1", {
      NX: true,
      EX: ttlSeconds,
    });

    if (result !== "OK") {
      return authFailure(
        401,
        "unauthorized",
        "Bearer token has already been used",
      );
    }

    return { ok: true };
  } catch {
    return authFailure(
      503,
      "dependency_unavailable",
      "JWT replay guard is unavailable",
      "redis",
    );
  }
}

function authFailure(
  statusCode: 401 | 403 | 503,
  error: AgentErrorCode,
  message: string,
  dependency?: string,
  diagnosticReason?: string,
): AgentAuthFailure {
  return {
    ok: false,
    statusCode,
    error,
    message,
    ...(dependency ? { dependency } : {}),
    ...(diagnosticReason ? { diagnosticReason } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
