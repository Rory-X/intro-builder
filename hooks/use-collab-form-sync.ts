"use client";

/**
 * Bidirectional sync between a React Hook Form instance and a Y.js Map.
 *
 * Architecture:
 * - Owner seeds Y.Map("formState") with current form state on connect.
 * - Mentor initializes form from Y.Map on connect (or waits for owner).
 * - Both sides: local edits → debounced diff → write changed keys to Y.Map.
 * - Both sides: remote Y.Map changes → form.setValue() for changed keys.
 * - Anti-echo: counter-based suppression (more reliable than timeout).
 * - Change tracking: exports remoteChanges for UI highlighting + activity log.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { Doc as YDoc } from "yjs";

const LOCAL_ORIGIN = "local-form-edit";
const SYNC_DEBOUNCE_MS = 200; // Fast enough for responsive feel

// --- Types ---

export type ChangeLogEntry = {
  id: string;
  field: string;       // top-level key (e.g. "basics", "experience")
  subfield?: string;   // human-readable description
  timestamp: number;
  author: "owner" | "mentor";
};

export type CollabSyncState = {
  /** Fields currently highlighted as remotely modified (auto-clears after 5s) */
  highlightedFields: Set<string>;
  /** Full change log for the session */
  changeLog: ChangeLogEntry[];
  /** Whether Y.Map sync is active */
  isSyncing: boolean;
};

type UseCollabFormSyncOptions = {
  ydoc: YDoc | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  role: "owner" | "mentor";
  enabled: boolean;
};

// --- Utilities ---

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa === sb;
}

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

/** Human-readable label for a top-level key */
function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    basics: "基本信息",
    experience: "工作经历",
    education: "教育经历",
    projects: "项目经历",
    skills: "技能",
    custom: "自定义分区",
    sectionOrder: "分区顺序",
    styleSettings: "样式设置",
  };
  return labels[key] || key;
}

let changeIdCounter = 0;

// --- Hook ---

export function useCollabFormSync({
  ydoc,
  form,
  role,
  enabled,
}: UseCollabFormSyncOptions): CollabSyncState {
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set());
  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Counter-based anti-echo: incremented before remote setValue, decremented after React settles
  const remoteUpdateCounter = useRef(0);
  const lastSyncedRef = useRef<Record<string, unknown>>({});
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Stable form reference
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; });

  // Write local form changes to Y.Map (debounced, field-level diff)
  const writeToYMap = useCallback(() => {
    if (!ydoc || !enabled) return;

    const ymap = ydoc.getMap("formState");
    const current = formRef.current.getValues() as Record<string, unknown>;
    const changed = getChangedKeys(lastSyncedRef.current, current);

    if (changed.length === 0) return;

    ydoc.transact(() => {
      for (const key of changed) {
        ymap.set(key, JSON.stringify(current[key]));
      }
    }, LOCAL_ORIGIN);

    lastSyncedRef.current = structuredClone(current);
  }, [ydoc, enabled]);

  // Initialize: Owner seeds, Mentor reads
  /* eslint-disable react-hooks/set-state-in-effect -- external Y.js subscription pattern */
  useEffect(() => {
    if (!ydoc || !enabled || initializedRef.current) return;

    const ymap = ydoc.getMap("formState");

    if (role === "owner") {
      const values = formRef.current.getValues() as Record<string, unknown>;
      ydoc.transact(() => {
        for (const [key, value] of Object.entries(values)) {
          ymap.set(key, JSON.stringify(value));
        }
      }, LOCAL_ORIGIN);
      lastSyncedRef.current = structuredClone(values);
      initializedRef.current = true;
      setIsSyncing(true);
    } else {
      // Mentor: read from Y.Map if already seeded
      if (ymap.size > 0) {
        const content = readYMap(ymap);
        remoteUpdateCounter.current++;
        formRef.current.reset(content);
        lastSyncedRef.current = structuredClone(content);
        // Decrement after React settles
        requestAnimationFrame(() => { remoteUpdateCounter.current--; });
        initializedRef.current = true;
        setIsSyncing(true);
      }
    }
  }, [ydoc, enabled, role]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Subscribe to local form changes → write to Y.Map
  useEffect(() => {
    if (!ydoc || !enabled) return;

    const { unsubscribe } = formRef.current.watch(() => {
      // Skip if triggered by a remote update being applied
      if (remoteUpdateCounter.current > 0) return;

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(writeToYMap, SYNC_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [ydoc, enabled, writeToYMap]);

  // Subscribe to remote Y.Map changes → apply to form + track changes
  useEffect(() => {
    if (!ydoc || !enabled) return;

    const ymap = ydoc.getMap("formState");

    const handleObserve = (_events: unknown[], transaction: { origin: unknown }) => {
      // Skip own local edits
      if (transaction.origin === LOCAL_ORIGIN) return;

      const content = readYMap(ymap);

      // First sync for mentor (owner just connected and seeded)
      if (!initializedRef.current && role === "mentor") {
        remoteUpdateCounter.current++;
        formRef.current.reset(content);
        lastSyncedRef.current = structuredClone(content);
        requestAnimationFrame(() => { remoteUpdateCounter.current--; });
        initializedRef.current = true;
        setIsSyncing(true);
        return;
      }

      // Find which fields changed
      const changed = getChangedKeys(lastSyncedRef.current, content);
      if (changed.length === 0) return;

      // Apply to form
      remoteUpdateCounter.current++;
      for (const key of changed) {
        formRef.current.setValue(key, content[key], { shouldDirty: true });
      }
      lastSyncedRef.current = structuredClone(content);
      // Let React process setValue batch, then allow local edits again
      requestAnimationFrame(() => { remoteUpdateCounter.current--; });

      // --- Change tracking ---
      const remoteAuthor = role === "owner" ? "mentor" : "owner";

      // Add to change log
      const newEntries: ChangeLogEntry[] = changed.map((key) => ({
        id: `change-${++changeIdCounter}`,
        field: key,
        subfield: fieldLabel(key),
        timestamp: Date.now(),
        author: remoteAuthor,
      }));
      setChangeLog((prev) => [...prev, ...newEntries]);

      // Highlight changed fields (auto-clear after 5s)
      setHighlightedFields((prev) => {
        const next = new Set(prev);
        for (const key of changed) {
          next.add(key);
          // Clear existing timer for this field
          const existing = highlightTimersRef.current.get(key);
          if (existing) clearTimeout(existing);
          // Set new auto-clear timer
          const timer = setTimeout(() => {
            setHighlightedFields((s) => {
              const n = new Set(s);
              n.delete(key);
              return n;
            });
            highlightTimersRef.current.delete(key);
          }, 5000);
          highlightTimersRef.current.set(key, timer);
        }
        return next;
      });
    };

    ymap.observeDeep(handleObserve);
    return () => {
      ymap.unobserveDeep(handleObserve);
      // Clean up highlight timers
      for (const timer of highlightTimersRef.current.values()) clearTimeout(timer);
      highlightTimersRef.current.clear();
    };
  }, [ydoc, enabled, role]);

  return { highlightedFields, changeLog, isSyncing };
}

// --- Helpers ---

function readYMap(ymap: ReturnType<YDoc["getMap"]>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  ymap.forEach((value, key) => {
    try {
      content[key] = JSON.parse(value as string);
    } catch {
      content[key] = value;
    }
  });
  return content;
}
