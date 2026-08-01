"use client";

export const EDITOR_ONBOARDING_VERSION = 1;

export type EditorOnboardingOutcome = "completed" | "dismissed";

type StoredEditorOnboardingOutcome = {
  version: number;
  outcome: EditorOnboardingOutcome;
};

export function editorOnboardingStorageKey(userId: string): string {
  return `intro-builder.editor-onboarding.v${EDITOR_ONBOARDING_VERSION}:${encodeURIComponent(userId)}`;
}

export function readEditorOnboardingOutcome(
  userId: string,
): EditorOnboardingOutcome | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(editorOnboardingStorageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!isStoredOutcome(parsed)) return null;
    return parsed.outcome;
  } catch {
    return null;
  }
}

export function storeEditorOnboardingOutcome(
  userId: string,
  outcome: EditorOnboardingOutcome,
) {
  if (typeof window === "undefined") return;
  const value: StoredEditorOnboardingOutcome = {
    version: EDITOR_ONBOARDING_VERSION,
    outcome,
  };
  window.localStorage.setItem(
    editorOnboardingStorageKey(userId),
    JSON.stringify(value),
  );
}

function isStoredOutcome(value: unknown): value is StoredEditorOnboardingOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === EDITOR_ONBOARDING_VERSION &&
    (record.outcome === "completed" || record.outcome === "dismissed")
  );
}
