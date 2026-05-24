"use client";

/**
 * Annotation highlights using the CSS Custom Highlight API.
 * This approach NEVER modifies the preview DOM — it creates Range objects
 * and registers them with CSS.highlights, which the browser renders as
 * colored backgrounds without affecting layout or pagination.
 *
 * Fallback: for browsers without Highlight API support (Firefox < 132),
 * highlights are not shown in preview (annotations still visible in list).
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

// Check if CSS Highlight API is available
const hasHighlightAPI = typeof window !== "undefined" && "Highlight" in window && CSS.highlights !== undefined;

export function AnnotationHighlights({
  previewRef,
  annotations,
  onClickAnnotation,
  canManage,
  onUpdateStatus,
}: Props) {
  const annotationsRef = useRef(annotations);
  useEffect(() => { annotationsRef.current = annotations; });
  const onClickRef = useRef(onClickAnnotation);
  useEffect(() => { onClickRef.current = onClickAnnotation; });

  // Store ranges per annotation for click detection
  const rangesMapRef = useRef<Map<string, Range[]>>(new Map());

  const [activePopover, setActivePopover] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);

  // Apply CSS highlights
  const applyHighlights = useCallback(() => {
    if (!hasHighlightAPI) return;
    const container = previewRef.current;
    if (!container) return;

    // Clear all existing highlights
    CSS.highlights.delete("annotation-pending");
    CSS.highlights.delete("annotation-accepted");
    rangesMapRef.current.clear();

    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");
    const pendingRanges: Range[] = [];
    const acceptedRanges: Range[] = [];

    for (const ann of visible) {
      const ranges = findTextRanges(container, ann);
      if (ranges.length > 0) {
        rangesMapRef.current.set(ann.id, ranges);
        for (const range of ranges) {
          if (ann.status === "pending") pendingRanges.push(range);
          else if (ann.status === "accepted") acceptedRanges.push(range);
        }
      }
    }

    // Register highlights with the browser
    if (pendingRanges.length > 0) {
      CSS.highlights.set("annotation-pending", new Highlight(...pendingRanges));
    }
    if (acceptedRanges.length > 0) {
      CSS.highlights.set("annotation-accepted", new Highlight(...acceptedRanges));
    }
  }, [previewRef]);

  // Re-apply on annotations change
  useEffect(() => {
    const id = requestAnimationFrame(applyHighlights);
    return () => cancelAnimationFrame(id);
  }, [annotations, applyHighlights]);

  // MutationObserver: re-apply when React re-renders preview
  useEffect(() => {
    if (!hasHighlightAPI) return;
    const container = previewRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(applyHighlights, 300);
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
      CSS.highlights.delete("annotation-pending");
      CSS.highlights.delete("annotation-accepted");
    };
  }, [previewRef, applyHighlights]);

  // Click handler: detect which annotation was clicked
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const sel = document.caretPositionFromPoint?.(e.clientX, e.clientY)
        || document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!sel) return;

      // Check if click is within any annotation range
      for (const [id, ranges] of rangesMapRef.current) {
        for (const range of ranges) {
          const point = document.createRange();
          if ("offsetNode" in sel) {
            // caretPositionFromPoint result
            const cp = sel as { offsetNode: Node; offset: number };
            point.setStart(cp.offsetNode, cp.offset);
            point.setEnd(cp.offsetNode, cp.offset);
          } else {
            // caretRangeFromPoint result (Range)
            const cr = sel as Range;
            point.setStart(cr.startContainer, cr.startOffset);
            point.setEnd(cr.endContainer, cr.endOffset);
          }

          if (
            range.compareBoundaryPoints(Range.START_TO_START, point) <= 0 &&
            range.compareBoundaryPoints(Range.END_TO_END, point) >= 0
          ) {
            const ann = annotationsRef.current.find((a) => a.id === id);
            if (ann) {
              e.stopPropagation();
              const rect = range.getBoundingClientRect();
              setActivePopover({ annotation: ann, x: rect.right + 8, y: rect.top });
              onClickRef.current?.(ann);
              return;
            }
          }
        }
      }
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [previewRef]);

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
        ::highlight(annotation-pending) {
          background-color: rgba(250, 204, 21, 0.4);
        }
        ::highlight(annotation-accepted) {
          background-color: rgba(74, 222, 128, 0.3);
        }
        @keyframes annotation-pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.6); }
          50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
        .annotation-flash {
          animation: annotation-pulse 0.6s ease-out 3;
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

// --- Text range finding (NO DOM modification) ---

function findTextRanges(container: HTMLElement, annotation: Annotation): Range[] {
  const { selectedText, sectionKey } = annotation;
  if (!selectedText || selectedText.length < 2) return [];

  // Find all matching sections (handles multi-page)
  let scopes: HTMLElement[] = [container];
  if (sectionKey && sectionKey !== "unknown") {
    const sections = container.querySelectorAll(`[data-pagination-section="${sectionKey}"]`);
    if (sections.length > 0) {
      scopes = Array.from(sections).filter((el): el is HTMLElement => el instanceof HTMLElement);
    }
  }

  for (const scope of scopes) {
    const range = findRangeInScope(scope, selectedText);
    if (range) return [range];
  }

  return [];
}

function findRangeInScope(scope: HTMLElement, selectedText: string): Range | null {
  // Collect text nodes
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    textNodes.push(n);
  }

  if (textNodes.length === 0) return null;

  // Build char-to-node mapping
  type CharRef = { nodeIdx: number; charIdx: number };
  const charMap: CharRef[] = [];
  for (let ni = 0; ni < textNodes.length; ni++) {
    const text = textNodes[ni].textContent || "";
    for (let ci = 0; ci < text.length; ci++) {
      charMap.push({ nodeIdx: ni, charIdx: ci });
    }
  }

  if (charMap.length === 0) return null;

  const fullText = charMap.map((c) => (textNodes[c.nodeIdx].textContent || "")[c.charIdx]).join("");

  // Normalize: strip whitespace from both
  const normSearch = selectedText.slice(0, 150).replace(/\s/g, "");
  const normFull = fullText.replace(/\s/g, "");

  if (normSearch.length < 2) return null;

  const normMatchIdx = normFull.indexOf(normSearch);
  if (normMatchIdx === -1) return null;

  // Map normalized → original indices
  const normToOrig: number[] = [];
  for (let i = 0; i < fullText.length; i++) {
    if (!/\s/.test(fullText[i])) {
      normToOrig.push(i);
    }
  }

  const origStart = normToOrig[normMatchIdx];
  const origEnd = normToOrig[normMatchIdx + normSearch.length - 1] + 1;

  if (origStart === undefined || origEnd === undefined) return null;

  // Create a Range (NO DOM modification!)
  const startChar = charMap[origStart];
  const endChar = charMap[origEnd - 1];

  const range = document.createRange();
  range.setStart(textNodes[startChar.nodeIdx], startChar.charIdx);
  range.setEnd(textNodes[endChar.nodeIdx], endChar.charIdx + 1);

  return range;
}

/** Scroll to and flash a specific annotation */
export function flashAnnotation(id: string) {
  // Flash by temporarily adding a visible element
  const ranges = document.getSelection();
  void ranges; // CSS highlights don't have direct DOM elements to flash

  // Use the annotation list scroll instead — the list item handles flash
  const listItem = document.querySelector(`[data-annotation-card="${id}"]`);
  if (listItem) {
    listItem.scrollIntoView({ behavior: "smooth", block: "center" });
    listItem.classList.add("annotation-flash");
    setTimeout(() => listItem.classList.remove("annotation-flash"), 2000);
  }
}
