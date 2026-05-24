"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * - Diff-based update: only adds/removes changed annotations (no jitter)
 * - MutationObserver: re-applies if React wipes the DOM
 * - Click handler: shows annotation detail popover
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { Annotation } from "@/hooks/use-annotations";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
  /** Owner can manage status from the popover */
  canManage?: boolean;
  onUpdateStatus?: (id: string, status: "accepted" | "dismissed") => void;
};

export function AnnotationHighlights({
  previewRef,
  annotations,
  onClickAnnotation,
  canManage,
  onUpdateStatus,
}: Props) {
  const marksRef = useRef<Map<string, HTMLElement[]>>(new Map());
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  // Popover state for clicking a highlight
  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);

  const applyHighlights = useCallback((forceAll = false) => {
    const container = previewRef.current;
    if (!container) return;

    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");
    const visibleIds = new Set(visible.map((a) => a.id));

    if (forceAll) {
      // Full re-apply (used when React wiped DOM)
      removeAllMarks(marksRef.current);
      marksRef.current.clear();

      for (const ann of visible) {
        applyOne(container, ann);
      }
    } else {
      // Diff-based: only add new, remove deleted
      // Remove marks for annotations that are no longer visible
      for (const [id, marks] of marksRef.current) {
        if (!visibleIds.has(id)) {
          for (const mark of marks) {
            if (mark.parentNode) {
              mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ""), mark);
              mark.parentNode.normalize();
            }
          }
          marksRef.current.delete(id);
        }
      }

      // Add marks for new annotations only
      for (const ann of visible) {
        if (!marksRef.current.has(ann.id)) {
          applyOne(container, ann);
        }
      }
    }

    function applyOne(cont: HTMLElement, ann: Annotation) {
      const marks = highlightText(cont, ann);
      if (marks.length > 0) {
        marksRef.current.set(ann.id, marks);
        for (const mark of marks) {
          mark.addEventListener("click", (e) => {
            e.stopPropagation();
            const rect = mark.getBoundingClientRect();
            const containerRect = cont.getBoundingClientRect();
            setActivePopover({
              annotation: ann,
              x: rect.right - containerRect.left + 8,
              y: rect.top - containerRect.top,
            });
            onClickAnnotation?.(ann);
          });
        }
      }
    }
  }, [previewRef, onClickAnnotation]);

  // Apply on annotations change (diff-based, no jitter)
  useEffect(() => {
    const timer = setTimeout(() => applyHighlights(false), 100);
    return () => clearTimeout(timer);
  }, [annotations, applyHighlights]);

  // MutationObserver: full re-apply only when marks are wiped by React
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Only re-apply if marks are gone
        for (const marks of marksRef.current.values()) {
          if (marks[0] && !container.contains(marks[0])) {
            applyHighlights(true);
            break;
          }
        }
      }, 300);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      removeAllMarks(marksRef.current);
      marksRef.current.clear();
    };
  }, [previewRef, applyHighlights]);

  // Close popover on outside click
  useEffect(() => {
    if (!activePopover) return;
    const handle = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-annotation-detail]")) {
        setActivePopover(null);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", handle), 50);
    return () => document.removeEventListener("mousedown", handle);
  }, [activePopover]);

  return (
    <>
      <style>{`
        @keyframes annotation-pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
          50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
        .annotation-flash {
          animation: annotation-pulse 0.6s ease-out 3;
          border-radius: 2px;
        }
      `}</style>

      {/* Annotation detail popover (appears on click) */}
      {activePopover && (
        <div
          data-annotation-detail
          className="absolute z-50 w-64 rounded-lg border bg-background p-3 shadow-lg"
          style={{ top: activePopover.y, left: activePopover.x }}
        >
          <p className="mb-1 line-clamp-2 text-xs text-muted-foreground">
            「{activePopover.annotation.selectedText}」
          </p>
          <p className="text-sm">{activePopover.annotation.comment}</p>
          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>— {activePopover.annotation.authorName}</span>
            <span>{new Date(activePopover.annotation.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          {canManage && activePopover.annotation.status === "pending" && (
            <div className="mt-2 flex gap-1.5 border-t pt-2">
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px] text-green-700"
                onClick={() => { onUpdateStatus?.(activePopover.annotation.id, "accepted"); setActivePopover(null); }}
              >
                <Check className="h-3 w-3" /> 采纳
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 px-2 text-[10px] text-gray-500"
                onClick={() => { onUpdateStatus?.(activePopover.annotation.id, "dismissed"); setActivePopover(null); }}
              >
                <X className="h-3 w-3" /> 忽略
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// --- Highlight logic (unchanged from previous fix) ---

function highlightText(container: HTMLElement, annotation: Annotation): HTMLElement[] {
  const { selectedText, sectionKey } = annotation;
  if (!selectedText || selectedText.length < 2) return [];

  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const el = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (el instanceof HTMLElement) scope = el;
  }

  const searchText = selectedText.slice(0, 100);

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    textNodes.push(n);
  }

  const combined = textNodes.map((t) => t.textContent || "").join("");
  const matchIdx = combined.indexOf(searchText);
  if (matchIdx === -1) return [];

  const matchEnd = matchIdx + searchText.length;
  let charOffset = 0;
  const ranges: { node: Text; start: number; end: number }[] = [];

  for (const textNode of textNodes) {
    const len = textNode.textContent?.length || 0;
    const nodeStart = charOffset;
    const nodeEnd = charOffset + len;

    if (nodeEnd > matchIdx && nodeStart < matchEnd) {
      if (textNode.parentElement?.tagName === "MARK" &&
          textNode.parentElement.dataset.annotationId) {
        charOffset += len;
        continue;
      }
      const start = Math.max(0, matchIdx - nodeStart);
      const end = Math.min(len, matchEnd - nodeStart);
      ranges.push({ node: textNode, start, end });
    }

    charOffset += len;
    if (charOffset >= matchEnd) break;
  }

  if (ranges.length === 0) return [];

  const marks: HTMLElement[] = [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { node, start, end } = ranges[i];
    let target: Text = node;
    if (start > 0) target = node.splitText(start);
    const actualEnd = end - start;
    if (actualEnd < (target.textContent?.length || 0)) target.splitText(actualEnd);

    const mark = document.createElement("mark");
    mark.textContent = target.textContent;
    mark.className = getHighlightClass(annotation.status);
    mark.title = annotation.comment;
    mark.dataset.annotationId = annotation.id;
    target.parentNode?.replaceChild(mark, target);
    marks.unshift(mark);
  }

  return marks;
}

function getHighlightClass(status: Annotation["status"]): string {
  const base = "cursor-pointer rounded-sm px-0.5 transition-colors inline";
  switch (status) {
    case "pending":
      return `${base} bg-yellow-200/80 dark:bg-yellow-600/40 border-b-2 border-yellow-500 hover:bg-yellow-300`;
    case "accepted":
      return `${base} bg-green-200/70 dark:bg-green-600/30 border-b-2 border-green-500`;
    case "dismissed":
      return `${base} bg-gray-200/30 dark:bg-gray-700/20 line-through opacity-40`;
  }
}

function removeAllMarks(marksMap: Map<string, HTMLElement[]>) {
  for (const marks of marksMap.values()) {
    for (const mark of marks) {
      if (mark.parentNode) {
        mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ""), mark);
        mark.parentNode.normalize();
      }
    }
  }
}

/** Scroll to and flash a specific annotation */
export function flashAnnotation(id: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${id}"]`);
  if (marks.length === 0) return;
  const first = marks[0] as HTMLElement;
  first.scrollIntoView({ behavior: "smooth", block: "center" });
  for (const mark of marks) {
    mark.classList.remove("annotation-flash");
    void (mark as HTMLElement).offsetWidth;
    mark.classList.add("annotation-flash");
  }
  setTimeout(() => { for (const m of marks) m.classList.remove("annotation-flash"); }, 2000);
}
