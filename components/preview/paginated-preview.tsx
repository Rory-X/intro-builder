"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import {
  ClientTemplateRenderFromSerializable,
  type SerializableResolvedTemplate,
} from "@/lib/templates/render";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type Props = {
  content: ResumeContent;
  resolvedTemplate: SerializableResolvedTemplate;
  styleSettings?: StyleSettings;
  showEmptyPlaceholders?: boolean;
  /** Callback when pagination breaks are recalculated — used by PDF export */
  onPaginationChange?: (data: { pageBreaks: number[]; totalHeight: number }) => void;
};

type BreakableElement = {
  /** Bottom edge position (absolute Y from container top) */
  bottom: number;
};

/**
 * Block-level tags that can serve as fine-grained break points within entries.
 */
const BLOCK_TAGS = new Set(["P", "LI", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"]);

/**
 * Find all breakable element boundaries by their absolute position.
 * Uses a two-level strategy:
 * 1. Explicit markers (data-pagination-*) for section/item level breaks
 * 2. Block-level children within items for fine-grained (line-level) breaks
 *
 * This ensures pages are filled as much as possible — if there's space for
 * even one more line, it gets placed on the current page.
 */
function findBreakPoints(container: HTMLElement): BreakableElement[] {
  const bottomSet = new Set<number>(); // deduplicate by position
  const scannedTextNodes = new WeakSet<Node>();

  // Level 1: Explicit pagination markers
  const breakables = container.querySelectorAll(
    "[data-pagination-item], [data-pagination-section], [data-pagination-section-header], [data-pagination-header]"
  );

  const seen = new Set<HTMLElement>();

  breakables.forEach((el) => {
    const element = el as HTMLElement;
    if (seen.has(element)) return;
    seen.add(element);

    // Even when a section/item box is not used as a page break itself, its
    // text lines are still safe break candidates. This covers templates that
    // have section markers but missing/faulty item markers.
    const hasTextLines = addTextLineBreakPoints(element, container, bottomSet, scannedTextNodes);

    // Skip sections that contain items (we break at item level instead)
    if (element.hasAttribute("data-pagination-section")) {
      const hasItems = element.querySelector("[data-pagination-item]");
      if (hasItems) return;
      // Section without items (e.g., rich-text-only sections like skills):
      // scan its children for fine-grained break points so we don't force-cut
      // through content when the section spans a page boundary.
    }

    // Skip items nested inside other items
    if (element.hasAttribute("data-pagination-item")) {
      const parentItem = element.parentElement?.closest("[data-pagination-item]");
      if (parentItem) return;
    }

    if (!hasTextLines) {
      const bottom = getAbsoluteBottom(element, container);
      bottomSet.add(Math.round(bottom));
    }

    // Level 2: For pagination items OR sections without items, add their
    // block-level children as finer break points. This allows splitting tall
    // content across pages at the paragraph/list-item level.
    addChildBreakPoints(element, container, bottomSet, scannedTextNodes);
  });

  // Convert to sorted array
  const elements: BreakableElement[] = Array.from(bottomSet)
    .sort((a, b) => a - b)
    .map((bottom) => ({ bottom }));

  return elements;
}

/**
 * Recursively find block-level children that can serve as break points.
 * Only adds elements that have meaningful height (> 10px).
 */
function addChildBreakPoints(
  parent: HTMLElement,
  container: HTMLElement,
  bottomSet: Set<number>,
  scannedTextNodes: WeakSet<Node>,
): void {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (!BLOCK_TAGS.has(el.tagName)) continue;
    if (el.offsetHeight < 10) continue; // Skip tiny/empty elements

    const hasTextLines = addTextLineBreakPoints(el, container, bottomSet, scannedTextNodes);
    if (!hasTextLines) {
      const bottom = getAbsoluteBottom(el, container);
      bottomSet.add(Math.round(bottom));
    }

    // For nested structures (like a div containing list items), go one level deeper
    if (el.tagName === "DIV" || el.tagName === "UL" || el.tagName === "OL") {
      addChildBreakPoints(el, container, bottomSet, scannedTextNodes);
    }
  }
}

function addTextLineBreakPoints(
  parent: HTMLElement,
  container: HTMLElement,
  bottomSet: Set<number>,
  scannedTextNodes: WeakSet<Node>,
): boolean {
  if (typeof document === "undefined" || typeof document.createRange !== "function") {
    return false;
  }

  let hasLineBreaks = false;
  const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  let textNode = walker.nextNode();
  const containerRect = container.getBoundingClientRect();
  while (textNode) {
    if (scannedTextNodes.has(textNode)) {
      textNode = walker.nextNode();
      continue;
    }
    scannedTextNodes.add(textNode);

    const range = document.createRange();
    try {
      range.selectNodeContents(textNode);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.height < 1) continue;
        const breakBeforeLine = Math.round(rect.top - containerRect.top - LINE_OVERFLOW_BUFFER);
        if (breakBeforeLine > 0) {
          bottomSet.add(breakBeforeLine);
          hasLineBreaks = true;
        }
      }
    } finally {
      range.detach();
    }
    textNode = walker.nextNode();
  }
  return hasLineBreaks;
}

/**
 * Get the bottom edge of an element relative to a container.
 * Uses getBoundingClientRect for pixel-perfect accuracy.
 * Adds LINE_OVERFLOW_BUFFER so break points are placed slightly below
 * the element's box — ensuring text descenders/line-height don't get
 * clipped by the page overlay.
 */
function getAbsoluteBottom(element: HTMLElement, container: HTMLElement): number {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.bottom - containerRect.top + LINE_OVERFLOW_BUFFER;
}

/** Padding applied to top/bottom of continuation pages (page 2+) */
const CONTINUATION_PADDING = 32; // px — breathing room on continuation pages

/**
 * Bottom padding reserved on the FIRST page to create symmetric whitespace
 * matching the template's built-in top padding (~40px). Without this, content
 * fills all the way to the bottom edge of page 1 while the top has breathing
 * room — visually unbalanced.
 */
const FIRST_PAGE_BOTTOM_PADDING = 40; // px — matches template top padding

/** Small safety buffer to prevent sub-pixel rendering cuts at page boundaries */
const BREAK_SAFETY_MARGIN = 2; // px

/**
 * Extra pixels added beyond the break point to ensure text descenders,
 * line-height overflow, and sub-pixel rendering don't get clipped by
 * the bottom overlay. Without this, the last line on each page can
 * appear "cut in half" because the overlay starts exactly at the
 * element's bounding box bottom while the visual text extends slightly
 * further due to line-height.
 */
const LINE_OVERFLOW_BUFFER = 6; // px

/**
 * If the last page would contain less than this much content (px), merge it
 * back into the previous page. Prevents near-empty trailing pages caused by
 * bottom margins, padding, or minor overflows.
 */
const MIN_LAST_PAGE_CONTENT = 80; // px

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

/**
 * Calculate page break Y-offsets using absolute positions.
 * Each page break is at the bottom edge of the last element that fits.
 * Continuation pages reserve padding at top+bottom for breathing room.
 */
function calculatePageBreaks(
  breakPoints: BreakableElement[],
  totalHeight: number,
): number[] {
  if (totalHeight <= A4_HEIGHT_PX) return []; // Single page, no breaks needed

  const breaks: number[] = [];
  let pageStart = 0;
  let isFirstPage = true;

  while (pageStart < totalHeight) {
    // Continuation pages have less usable space (top + bottom padding reserved)
    const usableHeight = isFirstPage
      ? A4_HEIGHT_PX - FIRST_PAGE_BOTTOM_PADDING
      : A4_HEIGHT_PX - CONTINUATION_PADDING * 2;
    const pageEnd = pageStart + usableHeight;

    if (pageEnd >= totalHeight) break; // Remaining content fits on this page

    // Find the last break point that fits within this page (with safety margin)
    let bestBreak = -1;
    for (let i = 0; i < breakPoints.length; i++) {
      if (breakPoints[i].bottom <= pageEnd - BREAK_SAFETY_MARGIN && breakPoints[i].bottom > pageStart) {
        bestBreak = i;
      }
    }

    if (bestBreak >= 0) {
      const breakY = breakPoints[bestBreak].bottom;
      breaks.push(breakY);
      pageStart = breakY;
    } else {
      // No suitable break point — force break
      breaks.push(pageEnd);
      pageStart = pageEnd;
    }

    isFirstPage = false;
  }

  // Remove trailing break if the last page would have negligible content
  // (prevents near-empty pages from bottom margins or minor overflows)
  if (breaks.length > 0) {
    const lastBreak = breaks[breaks.length - 1];
    const lastPageContent = totalHeight - lastBreak;
    if (lastPageContent < MIN_LAST_PAGE_CONTENT) {
      breaks.pop();
    }
  }

  return breaks;
}

/**
 * PaginatedPreview renders the resume template into multiple A4-sized pages.
 *
 * Zoom: pinch-to-zoom (ctrlKey wheel) applies CSS zoom — layout flow preserved
 * so native scroll continues to work for multi-page navigation.
 * Pan: native scroll by the parent overflow-y-auto container.
 */
export const PaginatedPreview = forwardRef<HTMLDivElement, Props>(function PaginatedPreview(
  { content, resolvedTemplate, styleSettings, showEmptyPlaceholders, onPaginationChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomShellRef = useRef<HTMLDivElement>(null);
  const visiblePagesRef = useRef<HTMLDivElement>(null);
  const zoomIndicatorRef = useRef<HTMLDivElement>(null);
  const baseScaleRef = useRef(1);
  const userZoomRef = useRef(1);
  const zoomRafRef = useRef<number | null>(null);
  const resetTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [measured, setMeasured] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyZoomNow = useCallback((options?: { animateReset?: boolean; anchor?: { clientX: number; clientY: number } }) => {
    const shell = zoomShellRef.current;
    const pages = visiblePagesRef.current;
    const indicator = zoomIndicatorRef.current;
    const scrollPane = containerRef.current?.closest("[data-preview-scroll-pane]") as HTMLElement | null;

    // Cursor-anchored zoom: capture the content point under the cursor as a
    // FRACTION of the zoomed element BEFORE applying the new zoom. Fractions are
    // invariant to zoom, so after reflow we put the same point back under the
    // cursor by adjusting scroll. Reading real post-layout rects means we don't
    // have to reason about centering (mx-auto) / padding — the geometry tells us.
    // Guard on width/height > 0 so jsdom (all-zero rects) safely skips this path.
    let anchorFrac: { fx: number; fy: number; clientX: number; clientY: number } | null = null;
    if (options?.anchor && pages && scrollPane) {
      const r0 = pages.getBoundingClientRect();
      if (r0.width > 0 && r0.height > 0) {
        anchorFrac = {
          fx: clamp((options.anchor.clientX - r0.left) / r0.width, 0, 1),
          fy: clamp((options.anchor.clientY - r0.top) / r0.height, 0, 1),
          clientX: options.anchor.clientX,
          clientY: options.anchor.clientY,
        };
      }
    }

    const effectiveZoom = baseScaleRef.current * userZoomRef.current;
    const zoomedWidth = A4_WIDTH_PX * effectiveZoom;

    if (shell) {
      shell.style.width = `${zoomedWidth}px`;
    }

    if (pages) {
      pages.style.setProperty("zoom", String(effectiveZoom));
      if (options?.animateReset) {
        pages.style.transition = "zoom 0.2s ease-out";
        if (resetTransitionTimerRef.current) {
          clearTimeout(resetTransitionTimerRef.current);
        }
        resetTransitionTimerRef.current = setTimeout(() => {
          pages.style.transition = "";
          resetTransitionTimerRef.current = null;
        }, 220);
      } else {
        pages.style.transition = "";
      }
    }

    if (indicator) {
      indicator.hidden = userZoomRef.current <= 1.05;
      indicator.textContent = `${Math.round(userZoomRef.current * 100)}%`;
    }

    if (scrollPane) {
      const maxScrollLeft = Math.max(0, scrollPane.scrollWidth - scrollPane.clientWidth);
      const maxScrollTop = Math.max(0, scrollPane.scrollHeight - scrollPane.clientHeight);
      if (anchorFrac && pages) {
        // Reading getBoundingClientRect here forces a synchronous reflow, so the
        // rect reflects the zoom we just set (no transition on this path → final
        // size is available immediately). Place the captured fraction point back
        // under the cursor by shifting scroll the delta between where it landed
        // and where the cursor is.
        const r1 = pages.getBoundingClientRect();
        const targetX = r1.left + anchorFrac.fx * r1.width;
        const targetY = r1.top + anchorFrac.fy * r1.height;
        scrollPane.scrollLeft = clamp(scrollPane.scrollLeft + (targetX - anchorFrac.clientX), 0, maxScrollLeft);
        scrollPane.scrollTop = clamp(scrollPane.scrollTop + (targetY - anchorFrac.clientY), 0, maxScrollTop);
      } else {
        scrollPane.scrollLeft = clamp(scrollPane.scrollLeft, 0, maxScrollLeft);
      }
    }
  }, []);

  const scheduleZoom = useCallback((nextUserZoom: number, options?: { animateReset?: boolean; anchor?: { clientX: number; clientY: number } }) => {
    userZoomRef.current = clamp(nextUserZoom, 1, 4);

    if (zoomRafRef.current !== null) {
      cancelAnimationFrame(zoomRafRef.current);
    }

    zoomRafRef.current = requestAnimationFrame(() => {
      zoomRafRef.current = null;
      applyZoomNow(options);
    });
  }, [applyZoomNow]);

  const applyZoom = useCallback((nextUserZoom: number, options?: { animateReset?: boolean; anchor?: { clientX: number; clientY: number } }) => {
    userZoomRef.current = clamp(nextUserZoom, 1, 4);
    applyZoomNow(options);
  }, [applyZoomNow]);

  const setVisiblePagesNode = useCallback(
    (node: HTMLDivElement | null) => {
      visiblePagesRef.current = node;
      assignForwardedRef(ref, node);
      applyZoom(userZoomRef.current);
    },
    [applyZoom, ref],
  );

  const recalculate = useCallback(() => {
    const container = measureRef.current;
    if (!container) return;

    const height = container.scrollHeight;
    if (height === 0) return;

    const breakPoints = findBreakPoints(container);
    const breaks = calculatePageBreaks(breakPoints, height);

    setPageBreaks(breaks);
    setTotalHeight(height);
    setMeasured(true);
    onPaginationChange?.({ pageBreaks: breaks, totalHeight: height });
  }, [onPaginationChange]);

  const debouncedRecalculate = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(recalculate, 150);
  }, [recalculate]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, content, resolvedTemplate, styleSettings]);

  useEffect(() => {
    const container = measureRef.current;
    if (!container) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      debouncedRecalculate();
    });
    observer.observe(container);

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => recalculate());
    }

    return () => {
      observer.disconnect();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [recalculate, debouncedRecalculate]);

  // Responsive base scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateScale = () => {
      const availableWidth = el.clientWidth;
      const targetWidth = A4_WIDTH_PX + 32;
      const s = availableWidth >= targetWidth ? 1 : availableWidth / targetWidth;
      baseScaleRef.current = Math.min(1, Math.max(0.3, s));
      applyZoom(userZoomRef.current);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, [applyZoom]);

  // Trackpad/mouse wheel handling for the preview surface:
  // - ctrl/meta + wheel is browser-level pinch (macOS trackpad and Ctrl+wheel)
  // - dominant horizontal wheel is preview pan, not browser history navigation
  // - vertical wheel stays native so multi-page scrolling remains smooth
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.008;
        scheduleZoom(userZoomRef.current + delta, {
          anchor: { clientX: e.clientX, clientY: e.clientY },
        });
        return;
      }

      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || e.deltaX === 0) return;

      const scrollPane = el.closest("[data-preview-scroll-pane]") as HTMLElement | null;
      if (!scrollPane) return;

      e.preventDefault();
      const maxScrollLeft = Math.max(0, scrollPane.scrollWidth - scrollPane.clientWidth);
      scrollPane.scrollLeft = clamp(scrollPane.scrollLeft + e.deltaX, 0, maxScrollLeft);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [scheduleZoom]);

  const handleDoubleClick = useCallback(() => {
    scheduleZoom(1, { animateReset: true });
  }, [scheduleZoom]);

  useEffect(() => {
    applyZoom(userZoomRef.current);
    return () => {
      if (zoomRafRef.current !== null) {
        cancelAnimationFrame(zoomRafRef.current);
      }
      if (resetTransitionTimerRef.current) {
        clearTimeout(resetTransitionTimerRef.current);
      }
      assignForwardedRef(ref, null);
    };
  }, [applyZoom, ref]);

  const pageOffsets = [0, ...pageBreaks];
  const numPages = pageOffsets.length;

  return (
    <div
      ref={containerRef}
      data-paginated-preview-root=""
      className="relative w-full"
      onDoubleClick={handleDoubleClick}
    >
      {/* Invisible measurement container */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-[-9999px] opacity-0"
        style={{ width: `${A4_WIDTH_PX}px` }}
      >
        <ClientTemplateRenderFromSerializable
          resolved={resolvedTemplate}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={styleSettings}
          showEmptyPlaceholders={showEmptyPlaceholders}
        />
      </div>

      <div
        className="mx-auto"
        ref={zoomShellRef}
        style={{ width: `${A4_WIDTH_PX}px` }}
      >
        {/* Pages — CSS zoom keeps layout flow so parent vertical scroll works naturally */}
        <div
          ref={setVisiblePagesNode}
          data-testid="resume-export-preview"
          className="flex flex-col items-center gap-8"
          style={{
            width: `${A4_WIDTH_PX}px`,
            zoom: 1,
          }}
        >
          {measured && Array.from({ length: numPages }, (_, i) => {
            const offset = pageOffsets[i];
            const nextOffset = i < numPages - 1 ? pageOffsets[i + 1] : totalHeight;
            const isFirstPage = i === 0;
            const contentHeight = nextOffset - offset;
            const contentEndOnPage = (isFirstPage ? 0 : CONTINUATION_PADDING) + contentHeight;
            const bottomOverlay = Math.max(0, A4_HEIGHT_PX - contentEndOnPage);

            return (
              <div
                key={i}
                className="relative overflow-hidden rounded-sm shadow-md ring-1 ring-black/5"
                style={{
                  width: `${A4_WIDTH_PX}px`,
                  height: `${A4_HEIGHT_PX}px`,
                  backgroundColor: "#ffffff",
                }}
              >
                {!isFirstPage && (
                  <div
                    className="absolute inset-x-0 top-0 z-[1]"
                    style={{ backgroundColor: "#ffffff", height: `${CONTINUATION_PADDING}px` }}
                  />
                )}
                <div
                  className="absolute inset-x-0 top-0"
                  style={{ transform: `translateY(${(isFirstPage ? 0 : CONTINUATION_PADDING) - offset}px)` }}
                >
                  <ClientTemplateRenderFromSerializable
                    resolved={resolvedTemplate}
                    content={content}
                    sectionOrder={content.sectionOrder}
                    styleSettings={styleSettings}
                    showEmptyPlaceholders={showEmptyPlaceholders}
                  />
                </div>
                {bottomOverlay > 0 && (
                  <div
                    className="absolute inset-x-0 bottom-0 z-[1]"
                    style={{ backgroundColor: "#ffffff", height: `${bottomOverlay}px` }}
                  />
                )}
                {numPages > 1 && (
                  <div className={cn(
                    "absolute bottom-2 right-3 z-10 rounded-full px-2 py-0.5 text-[10px] tabular-nums",
                    "bg-black/5 text-neutral-400 dark:bg-white/10",
                  )}>
                    {i + 1}/{numPages}
                  </div>
                )}
              </div>
            );
          })}

          {!measured && (
            <div
              className="overflow-hidden rounded-sm shadow-md ring-1 ring-black/5"
              style={{ width: `${A4_WIDTH_PX}px`, minHeight: `${A4_HEIGHT_PX}px`, backgroundColor: "#ffffff" }}
            >
              <ClientTemplateRenderFromSerializable
                resolved={resolvedTemplate}
                content={content}
                sectionOrder={content.sectionOrder}
                styleSettings={styleSettings}
                showEmptyPlaceholders={showEmptyPlaceholders}
              />
            </div>
          )}
        </div>
      </div>

      {/* Zoom indicator */}
      <div
        ref={zoomIndicatorRef}
        hidden
        className={cn(
          "absolute bottom-3 left-3 z-20 rounded-full px-2.5 py-1 text-xs tabular-nums cursor-pointer select-none",
          "bg-black/70 text-white backdrop-blur-sm dark:bg-white/20",
        )}
        onClick={handleDoubleClick}
        title="双击重置"
      >
        100%
      </div>
    </div>
  );
});
