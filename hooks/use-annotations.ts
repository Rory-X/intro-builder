"use client";

/**
 * Hook for managing annotations via Y.js Array.
 * Annotations are stored in ydoc.getArray("annotations") and synced in real-time.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import type { Doc as YDoc } from "yjs";

// --- Types ---

export type Annotation = {
  id: string;
  selectedText: string;
  comment: string;
  sectionKey: string;
  itemIndex?: number;
  pageNumber?: number;
  timestamp: number;
  authorName: string;
  status: "pending" | "accepted" | "dismissed";
};

type UseAnnotationsOptions = {
  ydoc: YDoc | null;
  enabled: boolean;
};

type UseAnnotationsReturn = {
  annotations: Annotation[];
  addAnnotation: (ann: Omit<Annotation, "id" | "timestamp" | "status">) => void;
  updateStatus: (id: string, status: "accepted" | "dismissed") => void;
  deleteAnnotation: (id: string) => void;
};

// --- Hook ---

export function useAnnotations({ ydoc, enabled }: UseAnnotationsOptions): UseAnnotationsReturn {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const ydocRef = useRef(ydoc);
  useEffect(() => { ydocRef.current = ydoc; });

  // Sync from Y.Array to local state
  /* eslint-disable react-hooks/set-state-in-effect -- external Y.js subscription */
  useEffect(() => {
    if (!ydoc || !enabled) {
      setAnnotations([]);
      return;
    }

    const yarray = ydoc.getArray<string>("annotations");

    const refresh = () => {
      const items: Annotation[] = [];
      for (let i = 0; i < yarray.length; i++) {
        try {
          items.push(JSON.parse(yarray.get(i)));
        } catch { /* skip malformed */ }
      }
      setAnnotations(items);
    };

    // Initial load
    refresh();

    // Subscribe to changes
    yarray.observe(refresh);
    return () => yarray.unobserve(refresh);
  }, [ydoc, enabled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Add a new annotation
  const addAnnotation = useCallback(
    (ann: Omit<Annotation, "id" | "timestamp" | "status">) => {
      const doc = ydocRef.current;
      if (!doc) return;

      const full: Annotation = {
        ...ann,
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        status: "pending",
      };

      const yarray = doc.getArray<string>("annotations");
      yarray.push([JSON.stringify(full)]);
    },
    [],
  );

  // Update annotation status (accept/dismiss)
  const updateStatus = useCallback(
    (id: string, status: "accepted" | "dismissed") => {
      const doc = ydocRef.current;
      if (!doc) return;

      const yarray = doc.getArray<string>("annotations");
      for (let i = 0; i < yarray.length; i++) {
        try {
          const item: Annotation = JSON.parse(yarray.get(i));
          if (item.id === id) {
            item.status = status;
            doc.transact(() => {
              yarray.delete(i, 1);
              yarray.insert(i, [JSON.stringify(item)]);
            });
            break;
          }
        } catch { /* skip */ }
      }
    },
    [],
  );

  // Delete annotation
  const deleteAnnotation = useCallback(
    (id: string) => {
      const doc = ydocRef.current;
      if (!doc) return;

      const yarray = doc.getArray<string>("annotations");
      for (let i = 0; i < yarray.length; i++) {
        try {
          const item: Annotation = JSON.parse(yarray.get(i));
          if (item.id === id) {
            yarray.delete(i, 1);
            break;
          }
        } catch { /* skip */ }
      }
    },
    [],
  );

  return { annotations, addAnnotation, updateStatus, deleteAnnotation };
}
