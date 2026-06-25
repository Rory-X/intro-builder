"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResumeContent } from "@intro-builder/shared/schemas";

export type ResumeEditorSnapshot = {
  title: string;
  templateId: string;
  content: ResumeContent;
};

type HistoryState = {
  current: ResumeEditorSnapshot;
  past: ResumeEditorSnapshot[];
  future: ResumeEditorSnapshot[];
};

type CaptureOptions = {
  merge?: boolean;
};

const MAX_UNDO = 50;
const MERGE_WINDOW_MS = 2_000;

export function useResumeHistory(initialSnapshot: ResumeEditorSnapshot) {
  const [current, setCurrent] = useState(() => cloneSnapshot(initialSnapshot));
  const [past, setPast] = useState<ResumeEditorSnapshot[]>([]);
  const [future, setFuture] = useState<ResumeEditorSnapshot[]>([]);
  const stateRef = useRef<HistoryState>({
    current: cloneSnapshot(initialSnapshot),
    past: [],
    future: [],
  });
  const lastWasMergeRef = useRef(false);
  const lastMergeAtRef = useRef(0);

  useEffect(() => {
    stateRef.current = { current, past, future };
  }, [current, past, future]);

  const capture = useCallback((snapshot: ResumeEditorSnapshot, options: CaptureOptions = {}) => {
    const next = cloneSnapshot(snapshot);
    const state = stateRef.current;
    if (snapshotsEqual(state.current, next)) {
      return;
    }
    const now = Date.now();
    const canMergeWithPrevious =
      !!options.merge &&
      lastWasMergeRef.current &&
      now - lastMergeAtRef.current <= MERGE_WINDOW_MS;
    const nextPast = canMergeWithPrevious
      ? state.past
      : [...state.past, cloneSnapshot(state.current)].slice(-MAX_UNDO);
    stateRef.current = {
      current: next,
      past: nextPast,
      future: [],
    };
    setPast(nextPast);
    setFuture([]);
    setCurrent(next);
    lastWasMergeRef.current = !!options.merge;
    lastMergeAtRef.current = options.merge ? now : 0;
  }, []);

  const undo = useCallback(() => {
    const state = stateRef.current;
    if (state.past.length === 0) return null;
    const restored = cloneSnapshot(state.past.at(-1)!);
    const nextPast = state.past.slice(0, -1);
    const nextFuture = [cloneSnapshot(state.current), ...state.future];
    stateRef.current = {
      current: restored,
      past: nextPast,
      future: nextFuture,
    };
    setPast(nextPast);
    setFuture(nextFuture);
    setCurrent(restored);
    lastWasMergeRef.current = false;
    lastMergeAtRef.current = 0;
    return cloneSnapshot(restored);
  }, []);

  const redo = useCallback(() => {
    const state = stateRef.current;
    if (state.future.length === 0) return null;
    const restored = cloneSnapshot(state.future[0]);
    const nextPast = [...state.past, cloneSnapshot(state.current)].slice(-MAX_UNDO);
    const nextFuture = state.future.slice(1);
    stateRef.current = {
      current: restored,
      past: nextPast,
      future: nextFuture,
    };
    setPast(nextPast);
    setFuture(nextFuture);
    setCurrent(restored);
    lastWasMergeRef.current = false;
    lastMergeAtRef.current = 0;
    return cloneSnapshot(restored);
  }, []);

  const replaceBaseline = useCallback((snapshot: ResumeEditorSnapshot) => {
    const next = cloneSnapshot(snapshot);
    stateRef.current = {
      current: next,
      past: [],
      future: [],
    };
    setCurrent(next);
    setPast([]);
    setFuture([]);
    lastWasMergeRef.current = false;
    lastMergeAtRef.current = 0;
  }, []);

  const markBoundary = useCallback(() => {
    lastWasMergeRef.current = false;
    lastMergeAtRef.current = 0;
  }, []);

  return useMemo(
    () => ({
      current,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      capture,
      undo,
      redo,
      replaceBaseline,
      markBoundary,
    }),
    [capture, current, future.length, markBoundary, past.length, redo, replaceBaseline, undo],
  );
}

function cloneSnapshot(snapshot: ResumeEditorSnapshot): ResumeEditorSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ResumeEditorSnapshot;
}

function snapshotsEqual(left: ResumeEditorSnapshot, right: ResumeEditorSnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}
