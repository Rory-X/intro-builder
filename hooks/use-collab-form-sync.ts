"use client";

/**
 * Bidirectional sync between a React Hook Form instance and a Y.js Map.
 *
 * - Owner seeds Y.Map with current form state on connect.
 * - Mentor initializes form from Y.Map on connect.
 * - Both sides: local edits → Y.Map (debounced, field-level diff).
 * - Both sides: remote Y.Map changes → form.setValue().
 * - Anti-echo: uses Y.Transaction origin to distinguish local vs remote.
 */

import { useEffect, useRef, useCallback } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { Doc as YDoc } from "yjs";

const LOCAL_ORIGIN = "local-form-edit";
const SYNC_DEBOUNCE_MS = 300;

type UseCollabFormSyncOptions = {
  ydoc: YDoc | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  role: "owner" | "mentor";
  enabled: boolean;
};

/**
 * Deep-compare two values using JSON serialization.
 * Fast enough for field-level comparisons.
 */
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Get all top-level keys that differ between two ResumeContent objects.
 * Returns the list of keys whose values changed.
 */
function getChangedKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!jsonEqual(prev[key], next[key])) {
      changed.push(key);
    }
  }
  return changed;
}

export function useCollabFormSync({
  ydoc,
  form,
  role,
  enabled,
}: UseCollabFormSyncOptions) {
  const suppressWatchRef = useRef(false);
  const lastSyncedRef = useRef<Record<string, unknown>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // Stable reference to form methods
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; });

  // Write local form changes to Y.Map
  const writeToYMap = useCallback(() => {
    if (!ydoc || !enabled) return;
    const ymap = ydoc.getMap("formState");
    const current = formRef.current.getValues() as unknown as Record<string, unknown>;
    const changed = getChangedKeys(lastSyncedRef.current, current);

    if (changed.length === 0) return;

    ydoc.transact(() => {
      for (const key of changed) {
        // Store as JSON string to preserve nested structure in Y.Map
        ymap.set(key, JSON.stringify(current[key]));
      }
    }, LOCAL_ORIGIN);

    lastSyncedRef.current = { ...current };
  }, [ydoc, enabled]);

  // Initialize: Owner seeds Y.Map, Mentor reads from Y.Map
  useEffect(() => {
    if (!ydoc || !enabled || initializedRef.current) return;

    const ymap = ydoc.getMap("formState");

    if (role === "owner") {
      // Owner seeds Y.Map with current form state
      const values = formRef.current.getValues() as unknown as Record<string, unknown>;
      ydoc.transact(() => {
        for (const [key, value] of Object.entries(values)) {
          ymap.set(key, JSON.stringify(value));
        }
      }, LOCAL_ORIGIN);
      lastSyncedRef.current = { ...values };
      initializedRef.current = true;
    } else {
      // Mentor: read from Y.Map if it already has data
      if (ymap.size > 0) {
        const content: Record<string, unknown> = {};
        ymap.forEach((value, key) => {
          try {
            content[key] = JSON.parse(value as string);
          } catch {
            content[key] = value;
          }
        });
        suppressWatchRef.current = true;
        formRef.current.reset(content);
        lastSyncedRef.current = { ...content };
        // Reset suppress flag after React processes the update
        setTimeout(() => { suppressWatchRef.current = false; }, 50);
        initializedRef.current = true;
      }
      // If Y.Map is empty, wait for observe to fire (owner hasn't connected yet)
    }
  }, [ydoc, enabled, role]);

  // Subscribe to local form changes → write to Y.Map (debounced)
  useEffect(() => {
    if (!ydoc || !enabled) return;

    const { unsubscribe } = formRef.current.watch(() => {
      // Skip if this change was triggered by a remote Y.Map update
      if (suppressWatchRef.current) return;

      // Debounce writes to Y.Map
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        writeToYMap();
      }, SYNC_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [ydoc, enabled, writeToYMap]);

  // Subscribe to remote Y.Map changes → apply to form
  useEffect(() => {
    if (!ydoc || !enabled) return;

    const ymap = ydoc.getMap("formState");

    const handleObserve = (events: unknown[], transaction: { origin: unknown }) => {
      // Skip our own local edits
      if (transaction.origin === LOCAL_ORIGIN) return;

      // Build the updated content from Y.Map
      const content: Record<string, unknown> = {};
      ymap.forEach((value, key) => {
        try {
          content[key] = JSON.parse(value as string);
        } catch {
          content[key] = value;
        }
      });

      // If mentor hasn't initialized yet, do a full reset
      if (!initializedRef.current && role === "mentor") {
        suppressWatchRef.current = true;
        formRef.current.reset(content);
        lastSyncedRef.current = { ...content };
        setTimeout(() => { suppressWatchRef.current = false; }, 50);
        initializedRef.current = true;
        return;
      }

      // Apply only changed fields
      const changed = getChangedKeys(lastSyncedRef.current, content);
      if (changed.length === 0) return;

      suppressWatchRef.current = true;
      for (const key of changed) {
        formRef.current.setValue(key, content[key], { shouldDirty: true });
      }
      lastSyncedRef.current = { ...content };
      // Reset suppress flag after React processes setValue
      setTimeout(() => { suppressWatchRef.current = false; }, 50);
    };

    ymap.observeDeep(handleObserve);
    return () => {
      ymap.unobserveDeep(handleObserve);
    };
  }, [ydoc, enabled, role]);
}
