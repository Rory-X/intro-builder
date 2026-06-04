"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeContent } from "@/lib/resume-schema";

type ResumeFormApi = {
  watch: (callback: (data: ResumeContent) => void) => { unsubscribe: () => void };
  getValues: () => ResumeContent;
};

type Options = {
  form: ResumeFormApi;
  resumeId: string;
  title: string;
  debounceMs?: number;
  onSave: (content: ResumeContent, title: string) => Promise<void>;
  onError: (error: unknown) => void;
};

export type ResumeAutosaveStatus = "idle" | "pending" | "saving" | "error";

function isRetriableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch failed|Failed to fetch|network|timeout|ECONNRESET|socket/i.test(msg);
}

/**
 * Debounced autosave with a serial queue so an older in-flight save
 * cannot overwrite newer edits (affects every form field, not only summary).
 */
export function useResumeAutosave({
  form,
  title,
  debounceMs = 2000,
  onSave,
  onError,
}: Options) {
  const [status, setStatus] = useState<ResumeAutosaveStatus>("idle");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGeneration = useRef(0);
  const titleRef = useRef(title);
  const previousTitleRef = useRef(title);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const hasPendingSaveRef = useRef(false);
  const retryCountRef = useRef(0);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const persistRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // The serial save queue intentionally uses refs so in-flight saves never
  // overwrite newer edits when React re-renders during autosave.
  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const persist = useCallback(async () => {
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      hasPendingSaveRef.current = false;
      await onSave(form.getValues(), titleRef.current);
      retryCountRef.current = 0;
      setStatus("idle");
    } catch (e: unknown) {
      if (isRetriableError(e) && retryCountRef.current < 1) {
        retryCountRef.current += 1;
        savingRef.current = false;
        setTimeout(() => void persistRef.current?.(), 2000);
        return;
      }
      retryCountRef.current = 0;
      setStatus("error");
      onError(e);
    } finally {
      savingRef.current = false;
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        await persistRef.current?.();
      }
    }
  }, [form, onSave, onError]);

  persistRef.current = persist;

  const schedule = useCallback(() => {
    hasPendingSaveRef.current = true;
    setStatus("pending");
    editGeneration.current += 1;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const generation = editGeneration.current;
    debounceTimer.current = setTimeout(() => {
      if (generation !== editGeneration.current) return;
      void persist();
    }, debounceMs);
  }, [debounceMs, persist]);

  useEffect(() => {
    const { unsubscribe } = form.watch(schedule);
    const flushPending = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (hasPendingSaveRef.current) {
        void persist();
      }
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener("resume:flush-autosave", flushPending);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener("resume:flush-autosave", flushPending);
      flushPending();
    };
  }, [form, persist, schedule]);

  useEffect(() => {
    if (previousTitleRef.current === title) return;
    previousTitleRef.current = title;
    schedule();
  }, [title, schedule]);

  return { schedule, status };
}
