"use client";

import { useCallback, useEffect, useRef } from "react";
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

/**
 * Debounced autosave with a serial queue so an older in-flight save
 * cannot overwrite newer edits (affects every form field, not only summary).
 */
export function useResumeAutosave({
  form,
  resumeId,
  title,
  debounceMs = 2000,
  onSave,
  onError,
}: Options) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editGeneration = useRef(0);
  const titleRef = useRef(title);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  titleRef.current = title;

  const persist = useCallback(async () => {
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    savingRef.current = true;
    try {
      await onSave(form.getValues(), titleRef.current);
    } catch (e: unknown) {
      onError(e);
    } finally {
      savingRef.current = false;
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        await persist();
      }
    }
  }, [form, onSave, onError]);

  const schedule = useCallback(() => {
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
    return () => {
      unsubscribe();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [form, schedule]);

  useEffect(() => {
    schedule();
  }, [title, schedule]);

  return { schedule };
}
