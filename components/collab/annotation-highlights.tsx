"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * Supports: flash animation when clicking annotation in the list.
 */

import { useEffect, useRef, useCallback } from "react";
import type { Annotation } from "@/hooks/use-annotations";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
  /** Set this to an annotation ID to scroll to it and flash */
  flashAnnotationId?: string | null;
};

export function AnnotationHighlights({ previewRef, annotations, onClickAnnotation, flashAnnotationId }: Props) {
  const marksRef = useRef<Map<string, HTMLElement>>(new Map());

  // Apply/refresh highlights
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    // Clean previous marks
    for (const mark of marksRef.current.values()) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
        parent.normalize();
      }
    }
    marksRef.current.clear();

    // Apply highlights for non-dismissed annotations
    const activeAnnotations = annotations.filter((a) => a.status !== "dismissed");

    for (const ann of activeAnnotations) {
      const mark = highlightTextInContainer(container, ann);
      if (mark) {
        marksRef.current.set(ann.id, mark);
        mark.addEventListener("click", (e) => {
          e.stopPropagation();
          onClickAnnotation?.(ann);
        });
      }
    }

    return () => {
      for (const mark of marksRef.current.values()) {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          parent.normalize();
        }
      }
      marksRef.current.clear();
    };
  }, [previewRef, annotations, onClickAnnotation]);

  // Flash and scroll to annotation when flashAnnotationId changes
  useEffect(() => {
    if (!flashAnnotationId) return;
    const mark = marksRef.current.get(flashAnnotationId);
    if (!mark) return;

    // Scroll into view
    mark.scrollIntoView({ behavior: "smooth", block: "center" });

    // Flash animation
    mark.classList.add("annotation-flash");
    const timer = setTimeout(() => mark.classList.remove("annotation-flash"), 1500);
    return () => clearTimeout(timer);
  }, [flashAnnotationId]);

  return (
    // Inject flash animation CSS
    <style>{`
      @keyframes annotation-flash {
        0%, 100% { opacity: 1; }
        25% { opacity: 0.3; background-color: rgba(59, 130, 246, 0.5); }
        50% { opacity: 1; background-color: rgba(59, 130, 246, 0.3); }
        75% { opacity: 0.3; background-color: rgba(59, 130, 246, 0.5); }
      }
      .annotation-flash {
        animation: annotation-flash 1.5s ease-in-out;
      }
    `}</style>
  );
}

/**
 * Find and highlight text within a container, returns the <mark> element or null.
 */
function highlightTextInContainer(container: HTMLElement, annotation: Annotation): HTMLElement | null {
  const { selectedText, sectionKey, status } = annotation;
  if (!selectedText || selectedText.length < 2) return null;

  // Try to scope to the section
  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const sectionEl = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (sectionEl instanceof HTMLElement) scope = sectionEl;
  }

  const searchText = selectedText.slice(0, 100);

  // Walk text nodes to find match
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.textContent?.indexOf(searchText) ?? -1;
    if (idx === -1) continue;

    // Split and wrap
    const before = node.splitText(idx);
    before.splitText(searchText.length);

    const mark = document.createElement("mark");
    mark.textContent = before.textContent;
    mark.className = getHighlightClass(status);
    mark.title = annotation.comment;
    mark.dataset.annotationId = annotation.id;

    before.parentNode?.replaceChild(mark, before);
    return mark;
  }

  return null;
}

function getHighlightClass(status: Annotation["status"]): string {
  switch (status) {
    case "pending":
      return "bg-yellow-200/70 dark:bg-yellow-700/50 cursor-pointer rounded-sm px-0.5 border-b-2 border-yellow-400 hover:bg-yellow-300/80 transition-colors";
    case "accepted":
      return "bg-green-200/60 dark:bg-green-700/40 cursor-pointer rounded-sm px-0.5 border-b-2 border-green-400";
    case "dismissed":
      return "bg-gray-200/30 dark:bg-gray-700/20 cursor-pointer rounded-sm px-0.5 line-through opacity-50";
  }
}

/** Exported for use from parent: trigger flash on a specific annotation */
export function flashAnnotation(id: string) {
  const mark = document.querySelector(`[data-annotation-id="${id}"]`);
  if (!mark) return;
  mark.scrollIntoView({ behavior: "smooth", block: "center" });
  mark.classList.add("annotation-flash");
  setTimeout(() => mark.classList.remove("annotation-flash"), 1500);
}
