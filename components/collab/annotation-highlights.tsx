"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * Uses MutationObserver to re-apply when React re-renders the preview.
 *
 * Key fix: uses textContent-based search to handle text spanning multiple
 * DOM nodes (e.g., bold/italic text splits into separate text nodes).
 */

import { useEffect, useRef, useCallback } from "react";
import type { Annotation } from "@/hooks/use-annotations";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
};

export function AnnotationHighlights({ previewRef, annotations, onClickAnnotation }: Props) {
  const marksRef = useRef<Map<string, HTMLElement[]>>(new Map());
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const onClickRef = useRef(onClickAnnotation);
  onClickRef.current = onClickAnnotation;

  const applyHighlights = useCallback(() => {
    const container = previewRef.current;
    if (!container) return;

    // Remove existing marks
    removeAllMarks(marksRef.current);
    marksRef.current.clear();

    // Only highlight non-dismissed annotations
    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");

    for (const ann of visible) {
      const marks = highlightText(container, ann);
      if (marks.length > 0) {
        marksRef.current.set(ann.id, marks);
        for (const mark of marks) {
          mark.addEventListener("click", (e) => {
            e.stopPropagation();
            onClickRef.current?.(ann);
          });
        }
      }
    }
  }, [previewRef]);

  // Apply on annotations change
  useEffect(() => {
    const timer = setTimeout(applyHighlights, 150);
    return () => clearTimeout(timer);
  }, [annotations, applyHighlights]);

  // MutationObserver: re-apply when preview DOM changes
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if any mark is no longer in DOM
        for (const marks of marksRef.current.values()) {
          if (marks[0] && !container.contains(marks[0])) {
            applyHighlights();
            break;
          }
        }
      }, 250);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      removeAllMarks(marksRef.current);
      marksRef.current.clear();
    };
  }, [previewRef, applyHighlights]);

  return (
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
  );
}

// --- Core highlight logic ---

/**
 * Two-pass approach to highlight multiple annotations:
 * 1. First pass: find all match positions in the unmodified DOM
 * 2. Second pass: apply highlights from END to START (later offsets first)
 *    so that earlier DOM modifications don't shift later positions.
 */
function highlightText(container: HTMLElement, annotation: Annotation): HTMLElement[] {
  const { selectedText, sectionKey } = annotation;
  if (!selectedText || selectedText.length < 2) return [];

  // Determine scope
  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const el = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (el instanceof HTMLElement) scope = el;
  }

  const searchText = selectedText.slice(0, 100);

  // Get all text nodes (including those already in marks — we need full text)
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    textNodes.push(n);
  }

  // Build combined text
  const combined = textNodes.map((t) => t.textContent || "").join("");
  const matchIdx = combined.indexOf(searchText);
  if (matchIdx === -1) return [];

  // Map character offset back to text nodes
  const matchEnd = matchIdx + searchText.length;
  let charOffset = 0;
  const ranges: { node: Text; start: number; end: number }[] = [];

  for (const textNode of textNodes) {
    const len = textNode.textContent?.length || 0;
    const nodeStart = charOffset;
    const nodeEnd = charOffset + len;

    if (nodeEnd > matchIdx && nodeStart < matchEnd) {
      // Skip nodes already inside a mark for THIS annotation
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

  // Apply from LAST to FIRST to preserve offsets
  const marks: HTMLElement[] = [];
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { node, start, end } = ranges[i];
    const text = node.textContent || "";

    let target: Text = node;
    if (start > 0) {
      target = node.splitText(start);
    }
    const actualEnd = end - start;
    if (actualEnd < (target.textContent?.length || 0)) {
      target.splitText(actualEnd);
    }

    const mark = document.createElement("mark");
    mark.textContent = target.textContent;
    mark.className = getHighlightClass(annotation.status);
    mark.title = annotation.comment;
    mark.dataset.annotationId = annotation.id;
    target.parentNode?.replaceChild(mark, target);
    marks.unshift(mark); // maintain order
  }

  return marks;
}

function getHighlightClass(status: Annotation["status"]): string {
  const base = "cursor-pointer rounded-sm px-0.5 transition-all inline";
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
        const text = document.createTextNode(mark.textContent || "");
        mark.parentNode.replaceChild(text, mark);
        text.parentNode?.normalize();
      }
    }
  }
}

/** Scroll to and flash a specific annotation */
export function flashAnnotation(id: string) {
  const marks = document.querySelectorAll(`[data-annotation-id="${id}"]`);
  if (marks.length === 0) return;

  const firstMark = marks[0] as HTMLElement;
  firstMark.scrollIntoView({ behavior: "smooth", block: "center" });

  // Flash all marks for this annotation
  for (const mark of marks) {
    mark.classList.remove("annotation-flash");
    void (mark as HTMLElement).offsetWidth; // force reflow
    mark.classList.add("annotation-flash");
  }
  setTimeout(() => {
    for (const mark of marks) mark.classList.remove("annotation-flash");
  }, 2000);
}
