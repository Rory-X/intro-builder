"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * Uses MutationObserver to re-apply highlights when React re-renders the preview.
 *
 * Status colors:
 * - pending (待处理): 黄色高亮 + 黄色下边框
 * - accepted (已采纳): 绿色高亮 + 绿色下边框
 * - dismissed (已忽略): 不显示高亮
 */

import { useEffect, useRef, useCallback } from "react";
import type { Annotation } from "@/hooks/use-annotations";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
};

export function AnnotationHighlights({ previewRef, annotations, onClickAnnotation }: Props) {
  const marksRef = useRef<Map<string, HTMLElement>>(new Map());
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const onClickRef = useRef(onClickAnnotation);
  onClickRef.current = onClickAnnotation;

  const applyHighlights = useCallback(() => {
    const container = previewRef.current;
    if (!container) return;

    // Remove existing marks safely
    for (const mark of marksRef.current.values()) {
      if (mark.parentNode) {
        const text = document.createTextNode(mark.textContent || "");
        mark.parentNode.replaceChild(text, mark);
        text.parentNode?.normalize();
      }
    }
    marksRef.current.clear();

    // Only highlight pending and accepted
    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");

    for (const ann of visible) {
      const mark = highlightText(container, ann);
      if (mark) {
        marksRef.current.set(ann.id, mark);
        mark.addEventListener("click", (e) => {
          e.stopPropagation();
          onClickRef.current?.(ann);
        });
      }
    }
  }, [previewRef]);

  // Apply on annotations change
  useEffect(() => {
    // Small delay to let React finish rendering preview DOM
    const timer = setTimeout(applyHighlights, 100);
    return () => clearTimeout(timer);
  }, [annotations, applyHighlights]);

  // MutationObserver: re-apply when preview DOM changes (React re-renders)
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      // Debounce to avoid applying during rapid re-renders
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Only re-apply if marks are gone (React wiped them)
        const firstMark = marksRef.current.values().next().value;
        if (firstMark && !container.contains(firstMark)) {
          applyHighlights();
        }
      }, 200);
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      // Cleanup marks
      for (const mark of marksRef.current.values()) {
        if (mark.parentNode) {
          mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          mark.parentNode.normalize();
        }
      }
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

// --- Highlight logic ---

function highlightText(container: HTMLElement, annotation: Annotation): HTMLElement | null {
  const { selectedText, sectionKey } = annotation;
  if (!selectedText || selectedText.length < 2) return null;

  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const el = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (el instanceof HTMLElement) scope = el;
  }

  const searchText = selectedText.slice(0, 80);
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const content = node.textContent || "";
    const idx = content.indexOf(searchText);
    if (idx === -1) continue;

    // Don't re-highlight already marked text
    if (node.parentElement?.tagName === "MARK") continue;

    const before = node.splitText(idx);
    before.splitText(searchText.length);

    const mark = document.createElement("mark");
    mark.textContent = before.textContent;
    mark.className = getHighlightClass(annotation.status);
    mark.title = annotation.comment;
    mark.dataset.annotationId = annotation.id;

    before.parentNode?.replaceChild(mark, before);
    return mark;
  }

  return null;
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

/** Scroll to and flash a specific annotation mark */
export function flashAnnotation(id: string) {
  const mark = document.querySelector(`[data-annotation-id="${id}"]`);
  if (!mark || !(mark instanceof HTMLElement)) return;

  // Scroll smoothly
  mark.scrollIntoView({ behavior: "smooth", block: "center" });

  // Remove any existing flash, then add
  mark.classList.remove("annotation-flash");
  // Force reflow to restart animation
  void mark.offsetWidth;
  mark.classList.add("annotation-flash");

  setTimeout(() => mark.classList.remove("annotation-flash"), 2000);
}
