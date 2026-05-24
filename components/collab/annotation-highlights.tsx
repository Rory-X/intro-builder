"use client";

/**
 * Renders highlight marks over the preview for annotated text.
 * Strategy: always full re-apply (remove all → re-insert all) in a single
 * requestAnimationFrame so the browser paints in one frame (no visible jitter).
 * MutationObserver re-applies when React wipes the DOM.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { Annotation } from "@/hooks/use-annotations";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[];
  onClickAnnotation?: (annotation: Annotation) => void;
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
  useEffect(() => { annotationsRef.current = annotations; });
  const onClickRef = useRef(onClickAnnotation);
  useEffect(() => { onClickRef.current = onClickAnnotation; });

  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);

  // Disconnect observer during our own DOM mutations to avoid loops
  const observerRef = useRef<MutationObserver | null>(null);
  const isMutatingRef = useRef(false);

  const applyHighlights = useCallback(() => {
    const container = previewRef.current;
    if (!container) return;

    isMutatingRef.current = true;

    // 1. Remove all existing marks (unwrap back to text)
    for (const marks of marksRef.current.values()) {
      for (const mark of marks) {
        if (mark.parentNode) {
          const text = document.createTextNode(mark.textContent || "");
          mark.parentNode.replaceChild(text, mark);
        }
      }
    }
    // Normalize to merge adjacent text nodes (clean slate)
    container.normalize();
    marksRef.current.clear();

    // 2. Re-apply all visible annotations
    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");
    for (const ann of visible) {
      const marks = highlightText(container, ann);
      if (marks.length > 0) {
        marksRef.current.set(ann.id, marks);
        for (const mark of marks) {
          mark.addEventListener("click", (e) => {
            e.stopPropagation();
            const rect = mark.getBoundingClientRect();
            setActivePopover({
              annotation: ann,
              x: rect.right + 8,
              y: rect.top,
            });
            onClickRef.current?.(ann);
          });
        }
      }
    }

    isMutatingRef.current = false;
  }, [previewRef]);

  // Re-apply whenever annotations change (single rAF — no visible flash)
  useEffect(() => {
    const id = requestAnimationFrame(applyHighlights);
    return () => cancelAnimationFrame(id);
  }, [annotations, applyHighlights]);

  // MutationObserver: re-apply when React wipes our marks
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new MutationObserver(() => {
      if (isMutatingRef.current) return; // ignore our own mutations
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Check if marks still exist in DOM
        for (const marks of marksRef.current.values()) {
          if (marks[0] && !container.contains(marks[0])) {
            applyHighlights();
            break;
          }
        }
      }, 300);
    });

    observerRef.current = observer;
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [previewRef, applyHighlights]);

  // Cleanup marks on unmount
  useEffect(() => {
    return () => {
      for (const marks of marksRef.current.values()) {
        for (const mark of marks) {
          if (mark.parentNode) {
            mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ""), mark);
          }
        }
      }
      marksRef.current.clear();
    };
  }, []);

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

      {activePopover && (
        <div
          data-annotation-detail
          className="fixed z-50 w-64 rounded-lg border bg-background p-3 shadow-lg"
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

// --- Highlight logic ---

function highlightText(container: HTMLElement, annotation: Annotation): HTMLElement[] {
  const { selectedText, sectionKey } = annotation;
  if (!selectedText || selectedText.length < 2) return [];

  let scope: HTMLElement = container;
  if (sectionKey && sectionKey !== "unknown") {
    const el = container.querySelector(`[data-pagination-section="${sectionKey}"]`);
    if (el instanceof HTMLElement) scope = el;
  }

  const searchText = normalizeWhitespace(selectedText.slice(0, 100));

  // Collect all text nodes
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    textNodes.push(n);
  }

  // Build combined string with normalized whitespace for matching
  // But track original lengths for offset mapping
  const segments = textNodes.map((t) => t.textContent || "");
  const combined = normalizeWhitespace(segments.join(""));

  // Also build a mapping: normalized offset → (textNode index, offset within node)
  // We need to find where in the original text nodes the match occurs
  const matchIdx = combined.indexOf(searchText);
  if (matchIdx === -1) return [];

  // Strategy: re-search using the raw (non-normalized) combined with flexible matching
  // Since normalization may shift offsets, use a simpler approach:
  // Walk through text nodes and try to match the search text character by character,
  // treating any whitespace in search as matching any whitespace sequence in DOM
  const matchRanges = findFlexibleMatch(textNodes, searchText);
  if (matchRanges.length === 0) return [];

  // Apply from last to first (preserve earlier offsets)
  const marks: HTMLElement[] = [];
  for (let i = matchRanges.length - 1; i >= 0; i--) {
    const { node, start, end } = matchRanges[i];
    let target: Text = node;
    if (start > 0) target = node.splitText(start);
    const len = end - start;
    if (len < (target.textContent?.length || 0)) target.splitText(len);

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

/** Normalize whitespace: collapse \n, \r, \t, multiple spaces into single space */
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Flexible match: find text across text nodes, treating any whitespace
 * in the search string as matching any amount of whitespace (or node boundaries).
 */
function findFlexibleMatch(
  textNodes: Text[],
  searchText: string,
): { node: Text; start: number; end: number }[] {
  // Split search into non-whitespace tokens
  const tokens = searchText.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // Build a flat character array with node references
  type CharInfo = { node: Text; indexInNode: number };
  const chars: CharInfo[] = [];
  for (const node of textNodes) {
    const text = node.textContent || "";
    for (let i = 0; i < text.length; i++) {
      chars.push({ node, indexInNode: i });
    }
  }

  // Try to find the token sequence in the char array
  const fullText = chars.map((c) => (c.node.textContent || "")[c.indexInNode]).join("");

  // Build regex pattern: tokens joined by \s* (whitespace between them is flexible)
  const escapedTokens = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escapedTokens.join("\\s*"));
  const match = pattern.exec(fullText);
  if (!match) return [];

  const startIdx = match.index;
  const endIdx = startIdx + match[0].length;

  // Map char indices back to text node ranges
  const ranges: { node: Text; start: number; end: number }[] = [];
  let currentNode: Text | null = null;
  let rangeStart = 0;
  let rangeEnd = 0;

  for (let i = startIdx; i < endIdx; i++) {
    const { node, indexInNode } = chars[i];
    if (node !== currentNode) {
      if (currentNode) {
        ranges.push({ node: currentNode, start: rangeStart, end: rangeEnd });
      }
      currentNode = node;
      rangeStart = indexInNode;
    }
    rangeEnd = indexInNode + 1;
  }
  if (currentNode) {
    ranges.push({ node: currentNode, start: rangeStart, end: rangeEnd });
  }

  return ranges;
}

function getHighlightClass(status: Annotation["status"]): string {
  const base = "cursor-pointer rounded-sm px-0.5 inline";
  switch (status) {
    case "pending":
      return `${base} bg-yellow-200/80 dark:bg-yellow-600/40 border-b-2 border-yellow-500 hover:bg-yellow-300`;
    case "accepted":
      return `${base} bg-green-200/70 dark:bg-green-600/30 border-b-2 border-green-500`;
    case "dismissed":
      return `${base} bg-gray-200/30 dark:bg-gray-700/20 line-through opacity-40`;
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
