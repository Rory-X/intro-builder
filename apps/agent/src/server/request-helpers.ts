import { createHash } from "node:crypto";

import {
  buildAiCacheKey,
  getAiCacheTtlSeconds,
  type AiCacheEntry,
  type AiCacheScope,
  type AiCacheStore,
} from "../ai-cache.js";
import type { AuthenticatedAgentSession } from "../auth.js";
import type { AgentConfig } from "../config.js";

/**
 * Shared request helpers extracted from the legacy `http.ts` so the Hono
 * handlers (rich-text polish, resume helpers, agent chat) reuse identical
 * cache-key derivation, cache read/write fail-soft semantics, and identity
 * hashing instead of duplicating them per route.
 */

export function buildScopedCacheKey({
  scope,
  session,
  resumeId,
  config,
  input,
  modelName,
}: {
  scope: AiCacheScope;
  session: AuthenticatedAgentSession;
  resumeId: string;
  config: AgentConfig;
  input: unknown;
  modelName?: string;
}): string {
  return buildAiCacheKey({
    scope,
    userId: session.userId,
    resumeId,
    modelName: modelName ?? config.modelName,
    input,
  });
}

export async function readAiCache<T>(
  store: AiCacheStore | undefined,
  key: string,
): Promise<AiCacheEntry<T> | null> {
  if (!store) return null;
  try {
    return await store.get<T>(key);
  } catch {
    return null;
  }
}

export async function writeAiCache<T>(
  store: AiCacheStore | undefined,
  key: string,
  value: T,
  scope: AiCacheScope,
  now: () => Date,
): Promise<void> {
  if (!store) return;
  try {
    await store.set(
      key,
      { createdAt: now().toISOString(), value },
      getAiCacheTtlSeconds(scope),
    );
  } catch {
    // Cache writes must never turn a successful model call into a failed request.
  }
}

export function hashIdentity(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}
