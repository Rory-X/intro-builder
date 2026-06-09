import { randomUUID } from "node:crypto";

import { SignJWT } from "jose";

import { normalizeAgentJwtSecret } from "./secret";

export type AgentTokenScope =
  | "agent:session"
  | "rich_text:polish"
  | "resume:helper"
  | "agent:chat";

export type SignAgentTokenOptions = {
  userId: string;
  scope: AgentTokenScope;
  resumeId?: string;
  ttlSeconds?: number;
  jwtSecret?: string;
  issuer?: string;
  audience?: string;
  now?: Date;
  createJti?: () => string;
};

export type SignedAgentToken = {
  token: string;
  jti: string;
  scope: AgentTokenScope;
  expiresAt: Date;
};

const DEFAULT_ISSUER = "intro-builder-web";
const DEFAULT_AUDIENCE = "intro-builder-agent";
const DEFAULT_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 180;

export async function signAgentToken({
  userId,
  scope,
  resumeId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  jwtSecret = process.env.AGENT_JWT_SECRET,
  issuer = process.env.AGENT_JWT_ISSUER ?? DEFAULT_ISSUER,
  audience = process.env.AGENT_JWT_AUDIENCE ?? DEFAULT_AUDIENCE,
  now = new Date(),
  createJti = randomUUID,
}: SignAgentTokenOptions): Promise<SignedAgentToken> {
  const normalizedJwtSecret = normalizeAgentJwtSecret(jwtSecret);
  if (!normalizedJwtSecret) {
    throw new Error("AGENT_JWT_SECRET is required to sign Agent JWTs");
  }

  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("Agent JWT ttl must be between 1 and 180 seconds");
  }

  const jti = createJti();
  const issuedAtSeconds = Math.floor(now.getTime() / 1_000);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1_000);

  const token = await new SignJWT({
    scope,
    ...(resumeId ? { resumeId } : {}),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(new TextEncoder().encode(normalizedJwtSecret));

  return {
    token,
    jti,
    scope,
    expiresAt,
  };
}
