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
      "redis",
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

  const verified = await verifyJwt(token, config, now);
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
      textEncoder.encode(config.jwtSecret),
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
  } catch {
    return authFailure(401, "unauthorized", "Invalid or expired bearer token");
  }
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
): AgentAuthFailure {
  return {
    ok: false,
    statusCode,
    error,
    message,
    ...(dependency ? { dependency } : {}),
  };
}
