"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * Uses TreeWalker to find matching text nodes and wraps them with <mark>.
 */

import { useEffect, useRef } from "react";
import type { Annotation } from "@/hooks/use-annotations";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
};

export function AnnotationHighlights({ previewRef, annotations, onClickAnnotation }: Props) {
  const marksRef = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    // Clean previous marks
    for (const mark of marksRef.current) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
        parent.normalize();
      }
    }
    marksRef.current = [];

    // Apply highlights for pending annotations
    const activeAnnotations = annotations.filter((a) => a.status !== "dismissed");

    for (const ann of activeAnnotations) {
      const marks = highlightTextInContainer(container, ann);
      marksRef.current.push(...marks);

      // Attach click handler
      for (const mark of marks) {
        mark.addEventListener("click", (e) => {
          e.stopPropagation();
          onClickAnnotation?.(ann);
        });
      }
    }

    return () => {
      // Cleanup on unmount
      for (const mark of marksRef.current) {
        const parent = mark.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          parent.normalize();
        }
      }
      marksRef.current = [];
    };
  }, [previewRef, annotations, onClickAnnotation]);

  return null; // This component only manipulates DOM imperatively
}

/**
 * Find and highlight text within a container element.
 * Returns the <mark> elements created.
 */
function highlightTextInContainer(
  container: HTMLElement,
  annotation: Annotation,
): HTMLElement[] {
  const { selectedText, sectionKey, status } = annotation;
  if (!selectedText || selectedText.length < 2) return [];

  // Try to scope to the section
  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const sectionEl = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (sectionEl instanceof HTMLElement) scope = sectionEl;
  }

  const marks: HTMLElement[] = [];
  const searchText = selectedText.slice(0, 100); // Limit search length

  // Walk text nodes to find matches
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.textContent?.indexOf(searchText) ?? -1;
    if (idx === -1) continue;

    // Split text node and wrap match in <mark>
    const before = node.splitText(idx);
    const match = before.splitText(searchText.length);
    void match; // remaining text after match

    const mark = document.createElement("mark");
    mark.textContent = before.textContent;
    mark.className = getHighlightClass(status);
    mark.title = annotation.comment;
    mark.dataset.annotationId = annotation.id;

    before.parentNode?.replaceChild(mark, before);
    marks.push(mark);

    break; // Only highlight first occurrence
  }

  return marks;
}

function getHighlightClass(status: Annotation["status"]): string {
  switch (status) {
    case "pending":
      return "bg-yellow-200/70 dark:bg-yellow-800/40 cursor-pointer rounded-sm px-0.5 border-b-2 border-yellow-400 hover:bg-yellow-300/70 transition-colors";
    case "accepted":
      return "bg-green-200/50 dark:bg-green-800/30 cursor-pointer rounded-sm px-0.5 border-b-2 border-green-400";
    case "dismissed":
      return "bg-gray-200/30 dark:bg-gray-700/20 cursor-pointer rounded-sm px-0.5 line-through opacity-50";
  }
}
