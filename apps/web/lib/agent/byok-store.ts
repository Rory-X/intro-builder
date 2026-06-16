"use client";

import { useSyncExternalStore } from "react";

/**
 * BYOK (bring-your-own-key) model config, stored ONLY in the browser's
 * localStorage and sent per chat request as `modelConfig`. The key is never
 * persisted on our servers — the web BFF forwards it transiently to the agent,
 * which uses it for that request and discards it.
 */

export type ByokModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

const STORAGE_KEY = "intro-builder.agent.byok.v1";

function parse(raw: string | null): ByokModelConfig | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ByokModelConfig>;
    if (
      typeof value.baseUrl === "string" &&
      typeof value.apiKey === "string" &&
      typeof value.modelName === "string" &&
      value.baseUrl.trim() &&
      value.apiKey.trim() &&
      value.modelName.trim()
    ) {
      return {
        baseUrl: value.baseUrl.trim(),
        apiKey: value.apiKey.trim(),
        modelName: value.modelName.trim(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Cache by the raw string so useSyncExternalStore gets a stable reference
// (re-parsing on every render would return a new object and loop).
let cache: { raw: string | null; value: ByokModelConfig | null } = {
  raw: null,
  value: null,
};

export function readByokConfig(): ByokModelConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cache.raw) return cache.value;
  cache = { raw, value: parse(raw) };
  return cache.value;
}

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function saveByokConfig(config: ByokModelConfig): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: config.baseUrl.trim(),
      apiKey: config.apiKey.trim(),
      modelName: config.modelName.trim(),
    }),
  );
  emit();
}

export function clearByokConfig(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  emit();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** React hook: the current BYOK config (or null), reactive to saves/clears. */
export function useByokConfig(): ByokModelConfig | null {
  return useSyncExternalStore(subscribe, readByokConfig, () => null);
}
