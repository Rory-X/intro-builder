"use client";

/**
 * Annotation highlights using the CSS Custom Highlight API.
 * NEVER modifies the preview DOM — uses Range + CSS.highlights for rendering.
 *
 * Fixes:
 * - Cursor: pointer on hover via mousemove detection
 * - Flash: temporary highlight group for visual pulse
 * - Multi-page: searches ALL text in container (no section scoping issues)
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

const hasHighlightAPI = typeof window !== "undefined" && "Highlight" in window && typeof CSS !== "undefined" && CSS.highlights !== undefined;

// Global store for ranges so flashAnnotation can access them
const globalRangesMap = new Map<string, Range>();

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

  const rangesMapRef = useRef<Map<string, Range>>(new Map());

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

    CSS.highlights.delete("annotation-pending");
    CSS.highlights.delete("annotation-accepted");
    CSS.highlights.delete("annotation-flash");
    rangesMapRef.current.clear();
    globalRangesMap.clear();

    const visible = annotationsRef.current.filter((a) => a.status !== "dismissed");
    const pendingRanges: Range[] = [];
    const acceptedRanges: Range[] = [];
    const usedRanges: Range[] = []; // Track already-matched ranges to avoid duplicates

    for (const ann of visible) {
      const range = findRangeInScope(container, ann.selectedText, usedRanges, ann.charOffset);
      if (range) {
        rangesMapRef.current.set(ann.id, range);
        globalRangesMap.set(ann.id, range);
        usedRanges.push(range);
        if (ann.status === "pending") pendingRanges.push(range);
        else if (ann.status === "accepted") acceptedRanges.push(range);
      }
    }

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
      CSS.highlights.delete("annotation-flash");
    };
  }, [previewRef, applyHighlights]);

  // Cursor: show pointer when hovering over a highlighted range
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (isPointInAnyRange(e.clientX, e.clientY, rangesMapRef.current)) {
        container.style.cursor = "pointer";
      } else {
        container.style.cursor = "";
      }
    };

    container.addEventListener("mousemove", handleMouseMove);
    return () => {
      container.removeEventListener("mousemove", handleMouseMove);
      container.style.cursor = "";
    };
  }, [previewRef, annotations]);

  // Click handler: detect which annotation was clicked
  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const hitId = getAnnotationAtPoint(e.clientX, e.clientY, rangesMapRef.current);
      if (!hitId) return;

      const ann = annotationsRef.current.find((a) => a.id === hitId);
      if (!ann) return;

      e.stopPropagation();
      // Position popover using viewport coords (fixed positioning)
      const range = rangesMapRef.current.get(hitId);
      if (range) {
        const rect = range.getBoundingClientRect();
        setActivePopover({ annotation: ann, x: rect.right + 8, y: rect.top });
      }
      onClickRef.current?.(ann);
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [previewRef, annotations]);

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
        ::highlight(annotation-flash) {
          background-color: rgba(59, 130, 246, 0.6);
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

// --- Hit detection ---

function isPointInAnyRange(x: number, y: number, ranges: Map<string, Range>): boolean {
  for (const range of ranges.values()) {
    if (isPointInRange(x, y, range)) return true;
  }
  return false;
}

function getAnnotationAtPoint(x: number, y: number, ranges: Map<string, Range>): string | null {
  for (const [id, range] of ranges) {
    if (isPointInRange(x, y, range)) return id;
  }
  return null;
}

function isPointInRange(x: number, y: number, range: Range): boolean {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}

// --- Visibility check ---

/**
 * Check if two ranges overlap (share any content).
 */
function overlapsAnyRange(range: Range, excludeRanges: Range[]): boolean {
  for (const existing of excludeRanges) {
    // Two ranges overlap if neither is entirely before or after the other
    if (
      range.compareBoundaryPoints(Range.START_TO_END, existing) > 0 &&
      range.compareBoundaryPoints(Range.END_TO_START, existing) < 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a rect is truly visible — not just has dimensions, but is inside
 * a visible page container. The paginated preview renders each page as an
 * overflow:hidden div. Clipped content has valid getBoundingClientRect but
 * its center point is outside the page container's visible area.
 */
function isRectVisible(rect: DOMRect, scope: HTMLElement): boolean {
  // The page containers are direct children of the preview root (scope).
  // They have overflow:hidden and fixed A4 dimensions.
  // scope itself is [data-testid="resume-export-preview"]
  const pageContainers = scope.querySelectorAll(":scope > div");

  if (pageContainers.length === 0) {
    // No pages found — fallback: check if rect is roughly on screen
    return rect.left > -100 && rect.top > -100 &&
           rect.top < window.innerHeight + 2000;
  }

  // Check if rect center is within any page container's bounds
  const centerY = rect.top + rect.height / 2;
  const centerX = rect.left + rect.width / 2;

  for (const page of pageContainers) {
    const pageRect = page.getBoundingClientRect();
    // Page must have reasonable dimensions (skip tiny/collapsed elements)
    if (pageRect.height < 100) continue;
    if (centerX >= pageRect.left && centerX <= pageRect.right &&
        centerY >= pageRect.top && centerY <= pageRect.bottom) {
      return true;
    }
  }

  return false;
}

// --- Text range finding ---

function findRangeInScope(scope: HTMLElement, selectedText: string, excludeRanges: Range[] = [], charOffset?: number): Range | null {
  if (!selectedText || selectedText.length < 2) return null;

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

  // Strip whitespace from both and match
  const normSearch = selectedText.slice(0, 150).replace(/\s/g, "");
  const fullText = charMap.map((c) => (textNodes[c.nodeIdx].textContent || "")[c.charIdx]).join("");
  const normFull = fullText.replace(/\s/g, "");

  if (normSearch.length < 2) return null;

  // Map normalized → original indices
  const normToOrig: number[] = [];
  for (let i = 0; i < fullText.length; i++) {
    if (!/\s/.test(fullText[i])) {
      normToOrig.push(i);
    }
  }

  // If we have a precise charOffset, start searching from near that position
  // This ensures we find the EXACT occurrence the user selected, not the first one
  let searchFrom = 0;
  if (charOffset !== undefined && charOffset > 0) {
    searchFrom = Math.max(0, charOffset - 5);
  }

  // Find the occurrence at/near charOffset that's visually visible
  const result = searchForVisibleRange(normFull, normSearch, searchFrom, normToOrig, charMap, textNodes, scope, excludeRanges);
  if (result) return result;

  // Fallback: if charOffset-based search failed, try from the beginning
  if (searchFrom > 0) {
    return searchForVisibleRange(normFull, normSearch, 0, normToOrig, charMap, textNodes, scope, excludeRanges);
  }

  return null;
}

function searchForVisibleRange(
  normFull: string,
  normSearch: string,
  searchFrom: number,
  normToOrig: number[],
  charMap: { nodeIdx: number; charIdx: number }[],
  textNodes: Text[],
  scope: HTMLElement,
  excludeRanges: Range[],
): Range | null {
  while (searchFrom < normFull.length) {
    const normMatchIdx = normFull.indexOf(normSearch, searchFrom);
    if (normMatchIdx === -1) break;

    const origStart = normToOrig[normMatchIdx];
    const origEnd = normToOrig[normMatchIdx + normSearch.length - 1] + 1;

    if (origStart === undefined || origEnd === undefined) {
      searchFrom = normMatchIdx + 1;
      continue;
    }

    const startChar = charMap[origStart];
    const endChar = charMap[origEnd - 1];

    try {
      const range = document.createRange();
      range.setStart(textNodes[startChar.nodeIdx], startChar.charIdx);
      range.setEnd(textNodes[endChar.nodeIdx], endChar.charIdx + 1);

      // Check if this range is actually visible (not clipped by overflow:hidden)
      const rect = range.getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0 && isRectVisible(rect, scope)) {
        // Check it doesn't overlap with any already-used range
        if (!overlapsAnyRange(range, excludeRanges)) {
          return range;
        }
      }
    } catch { /* skip invalid ranges */ }

    searchFrom = normMatchIdx + 1;
  }

  return null;
}

/** Flash a specific annotation highlight + scroll into view */
export function flashAnnotation(id: string) {
  if (!hasHighlightAPI) return;

  const range = globalRangesMap.get(id);
  if (range) {
    // Scroll the highlighted text into view
    const rect = range.getBoundingClientRect();
    const container = range.startContainer.parentElement?.closest("[class*='overflow-y-auto']");
    if (container && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      // Need to scroll — find the element and scroll it
      const el = range.startContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Flash using a temporary CSS highlight group
    CSS.highlights.set("annotation-flash", new Highlight(range));
    setTimeout(() => CSS.highlights.delete("annotation-flash"), 1500);
  }

  // Also flash the card in the list
  const card = document.querySelector(`[data-annotation-card="${id}"]`);
  if (card instanceof HTMLElement) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.style.transition = "box-shadow 0.3s";
    card.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.5)";
    setTimeout(() => {
      card.style.boxShadow = "";
      setTimeout(() => { card.style.transition = ""; }, 300);
    }, 1500);
  }
}
