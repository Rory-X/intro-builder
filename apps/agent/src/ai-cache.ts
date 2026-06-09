import { createHash } from "node:crypto";

export type AiCacheScope =
  | "rich_text:polish"
  | "resume:helper"
  | "agent:chat";

export type AiCacheEntry<T = unknown> = {
  createdAt: string;
  value: T;
};

export type AiCacheRedis = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    options: { EX: number },
  ) => Promise<"OK" | null>;
};

export type AiCacheStore = {
  get: <T = unknown>(key: string) => Promise<AiCacheEntry<T> | null>;
  set: <T = unknown>(
    key: string,
    entry: AiCacheEntry<T>,
    ttlSeconds: number,
  ) => Promise<void>;
};

export type BuildAiCacheKeyOptions = {
  scope: AiCacheScope;
  userId: string;
  resumeId: string;
  modelName?: string;
  input: unknown;
};

const CACHE_CONTRACT_VERSION = "agent-ai-cache:v1";
const PROMPT_VERSION_BY_SCOPE: Record<AiCacheScope, string> = {
  "rich_text:polish": "rich-text-polish:2026-06-08",
  "resume:helper": "resume-helper:2026-06-08",
  "agent:chat": "agent-chat:2026-06-09",
};

const TTL_SECONDS_BY_SCOPE: Record<AiCacheScope, number> = {
  "rich_text:polish": 7 * 24 * 60 * 60,
  "resume:helper": 24 * 60 * 60,
  "agent:chat": 10 * 60,
};

export function getAiCacheTtlSeconds(scope: AiCacheScope): number {
  return TTL_SECONDS_BY_SCOPE[scope];
}

export function buildAiCacheKey({
  scope,
  userId,
  resumeId,
  modelName,
  input,
}: BuildAiCacheKeyOptions): string {
  const userHash = hashText(userId, 24);
  const resumeHash = hashText(resumeId, 24);
  const inputHash = hashText(
    stableStringify({
      version: CACHE_CONTRACT_VERSION,
      promptVersion: PROMPT_VERSION_BY_SCOPE[scope],
      scope,
      modelName: modelName ?? "unconfigured",
      input,
    }),
    32,
  );

  return `ai_cache:${scope}:${userHash}:${resumeHash}:${inputHash}`;
}

export function createRedisAiCacheStore(redis: AiCacheRedis): AiCacheStore {
  return {
    async get<T = unknown>(key: string): Promise<AiCacheEntry<T> | null> {
      const raw = await redis.get(key);
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw);
        if (!isCacheEntry(parsed)) return null;
        return parsed as AiCacheEntry<T>;
      } catch {
        return null;
      }
    },

    async set<T = unknown>(
      key: string,
      entry: AiCacheEntry<T>,
      ttlSeconds: number,
    ): Promise<void> {
      await redis.set(key, JSON.stringify(entry), { EX: ttlSeconds });
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const child = record[key];
    if (child !== undefined) {
      normalized[key] = normalizeForHash(child);
    }
  }
  return normalized;
}

function hashText(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function isCacheEntry(value: unknown): value is AiCacheEntry {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).createdAt === "string" &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}
