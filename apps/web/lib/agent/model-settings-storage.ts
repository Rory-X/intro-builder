"use client";

import type { AgentModelConfig } from "@intro-builder/shared/types";

export type AgentModelSettingsForm = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export const AGENT_MODEL_SETTINGS_STORAGE_KEY =
  "intro-builder.agent.model-settings.v1";
export const AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY =
  "intro-builder.agent.model-api-key.v1";

export function readStoredAgentModelSettings(): AgentModelSettingsForm {
  if (typeof window === "undefined") return emptyAgentModelSettings();
  try {
    const raw = window.localStorage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const storedApiKey = readSessionAgentModelApiKey();
    if (!isRecord(parsed)) {
      return { ...emptyAgentModelSettings(), apiKey: storedApiKey };
    }
    const legacyApiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : "";
    const apiKey = storedApiKey || legacyApiKey;
    if (legacyApiKey) {
      storeAgentModelSettings({
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        modelName: typeof parsed.modelName === "string" ? parsed.modelName : "",
        apiKey,
      });
    }
    return normalizeAgentModelSettings({
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      apiKey,
      modelName: typeof parsed.modelName === "string" ? parsed.modelName : "",
    });
  } catch {
    return emptyAgentModelSettings();
  }
}

export function storeAgentModelSettings(settings: AgentModelSettingsForm) {
  if (typeof window === "undefined") return;
  const normalized = normalizeAgentModelSettings(settings);
  window.localStorage.setItem(
    AGENT_MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      baseUrl: normalized.baseUrl,
      modelName: normalized.modelName,
    }),
  );
  if (normalized.apiKey) {
    window.sessionStorage.setItem(
      AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY,
      normalized.apiKey,
    );
  } else {
    window.sessionStorage.removeItem(AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY);
  }
}

export function readSessionAgentModelApiKey(): string {
  if (typeof window === "undefined") return "";
  return (
    window.sessionStorage.getItem(AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY) ?? ""
  );
}

export function emptyAgentModelSettings(): AgentModelSettingsForm {
  return { baseUrl: "", apiKey: "", modelName: "" };
}

export function normalizeAgentModelSettings(
  settings: AgentModelSettingsForm,
): AgentModelSettingsForm {
  return {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    modelName: settings.modelName.trim(),
  };
}

export function toAgentModelConfig(
  settings: AgentModelSettingsForm,
): AgentModelConfig | null {
  const normalized = normalizeAgentModelSettings(settings);
  if (!normalized.baseUrl || !normalized.apiKey || !normalized.modelName) {
    return null;
  }
  return normalized;
}

export function isAgentModelConfigured(settings: AgentModelSettingsForm): boolean {
  return toAgentModelConfig(settings) !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
