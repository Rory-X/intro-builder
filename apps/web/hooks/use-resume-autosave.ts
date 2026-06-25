"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResumeContent } from "@intro-builder/shared/schemas";

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
export const RESUME_AUTOSAVE_FLUSH_EVENT = "resume:flush-autosave";

type FlushWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export type ResumeAutosaveFlushEventDetail = FlushWaiter & {
  handled?: boolean;
};

export type ResumeAutosaveFlushEvent = CustomEvent<ResumeAutosaveFlushEventDetail>;

export function requestResumeAutosaveFlush(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const detail: ResumeAutosaveFlushEventDetail = { resolve, reject };
    window.dispatchEvent(
      new CustomEvent(RESUME_AUTOSAVE_FLUSH_EVENT, { detail }),
    );
    if (!detail.handled) {
      resolve();
    }
  });
}

function isRetriableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch failed|Failed to fetch|network|timeout|ECONNRESET|socket/i.test(msg);
}

function isFlushEvent(event: Event): event is ResumeAutosaveFlushEvent {
  if (!("detail" in event)) return false;
  const detail = (event as ResumeAutosaveFlushEvent).detail;
  return (
    detail !== null &&
    typeof detail === "object" &&
    typeof detail.resolve === "function" &&
    typeof detail.reject === "function"
  );
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
  const flushWaitersRef = useRef<FlushWaiter[]>([]);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const persistRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const clearDebounce = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const resolveFlushWaiters = useCallback(() => {
    const waiters = flushWaitersRef.current;
    flushWaitersRef.current = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }, []);

  const rejectFlushWaiters = useCallback((error: unknown) => {
    const waiters = flushWaitersRef.current;
    flushWaitersRef.current = [];
    for (const waiter of waiters) {
      waiter.reject(error);
    }
  }, []);

  const persist = useCallback(async () => {
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    let retryScheduled = false;
    let saveFailed = false;
    try {
      hasPendingSaveRef.current = false;
      await onSave(form.getValues(), titleRef.current);
      retryCountRef.current = 0;
      setStatus("idle");
    } catch (e: unknown) {
      if (isRetriableError(e) && retryCountRef.current < 1) {
        retryCountRef.current += 1;
        savingRef.current = false;
        retryScheduled = true;
        setTimeout(() => {
          void persistRef.current?.().catch(() => undefined);
        }, 2000);
        return;
      }
      retryCountRef.current = 0;
      saveFailed = true;
      setStatus("error");
      onError(e);
      rejectFlushWaiters(e);
    } finally {
      savingRef.current = false;
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        await persistRef.current?.();
      } else if (!retryScheduled && !saveFailed && !hasPendingSaveRef.current) {
        resolveFlushWaiters();
      }
    }
  }, [form, onSave, onError, rejectFlushWaiters, resolveFlushWaiters]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const schedule = useCallback(() => {
    hasPendingSaveRef.current = true;
    setStatus("pending");
    editGeneration.current += 1;
    clearDebounce();
    if (savingRef.current && flushWaitersRef.current.length > 0) {
      saveAgainRef.current = true;
      return;
    }
    const generation = editGeneration.current;
    debounceTimer.current = setTimeout(() => {
      if (generation !== editGeneration.current) return;
      void persist().catch(() => undefined);
    }, debounceMs);
  }, [clearDebounce, debounceMs, persist]);

  const flush = useCallback(() => {
    clearDebounce();
    if (!hasPendingSaveRef.current && !savingRef.current && !saveAgainRef.current) {
      return Promise.resolve();
    }
    const flushResult = new Promise<void>((resolve, reject) => {
      flushWaitersRef.current.push({ resolve, reject });
    });
    if (hasPendingSaveRef.current || saveAgainRef.current) {
      void persist().catch(() => undefined);
    }
    return flushResult;
  }, [clearDebounce, persist]);

  useEffect(() => {
    const { unsubscribe } = form.watch(schedule);
    const flushPending = (event?: Event) => {
      const flushResult = flush();
      if (event && isFlushEvent(event)) {
        event.detail.handled = true;
        flushResult.then(event.detail.resolve, event.detail.reject);
      } else {
        void flushResult.catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", flushPending);
    window.addEventListener(RESUME_AUTOSAVE_FLUSH_EVENT, flushPending);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flushPending);
      window.removeEventListener(RESUME_AUTOSAVE_FLUSH_EVENT, flushPending);
      flushPending();
    };
  }, [flush, form, schedule]);

  useEffect(() => {
    if (previousTitleRef.current === title) return;
    previousTitleRef.current = title;
    schedule();
  }, [title, schedule]);

  return { flush, schedule, status };
}
