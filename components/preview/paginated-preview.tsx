"use client";

import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

  // Level 1: Explicit pagination markers
  const breakables = container.querySelectorAll(
    "[data-pagination-item], [data-pagination-section], [data-pagination-section-header], [data-pagination-header]"
  );

  const seen = new Set<HTMLElement>();

  breakables.forEach((el) => {
    const element = el as HTMLElement;

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

    if (seen.has(element)) return;
    seen.add(element);

    const bottom = getAbsoluteBottom(element, container);
    bottomSet.add(Math.round(bottom));

    // Level 2: For pagination items OR sections without items, add their
    // block-level children as finer break points. This allows splitting tall
    // content across pages at the paragraph/list-item level.
    if (
      element.hasAttribute("data-pagination-item") ||
      (element.hasAttribute("data-pagination-section") && !element.querySelector("[data-pagination-item]"))
    ) {
      addChildBreakPoints(element, container, bottomSet);
    }
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
): void {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (!BLOCK_TAGS.has(el.tagName)) continue;
    if (el.offsetHeight < 10) continue; // Skip tiny/empty elements

    const bottom = getAbsoluteBottom(el, container);
    bottomSet.add(Math.round(bottom));

    // For nested structures (like a div containing list items), go one level deeper
    if (el.tagName === "DIV" || el.tagName === "UL" || el.tagName === "OL") {
      addChildBreakPoints(el, container, bottomSet);
    }
  }
}

/**
 * Get the bottom edge of an element relative to a container.
 * Uses getBoundingClientRect for pixel-perfect accuracy.
 */
function getAbsoluteBottom(element: HTMLElement, container: HTMLElement): number {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.bottom - containerRect.top;
}

/** Padding applied to top/bottom of continuation pages (page 2+) */
const CONTINUATION_PADDING = 32; // px — breathing room on continuation pages

/** Small safety buffer to prevent sub-pixel rendering cuts at page boundaries */
const BREAK_SAFETY_MARGIN = 2; // px

/**
 * If the last page would contain less than this much content (px), merge it
 * back into the previous page. Prevents near-empty trailing pages caused by
 * bottom margins, padding, or minor overflows.
 */
const MIN_LAST_PAGE_CONTENT = 80; // px

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
      ? A4_HEIGHT_PX
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
 * Strategy:
 * 1. Render content into an invisible measurement container
 * 2. Find all breakable element positions using offsetTop
 * 3. Calculate page breaks based on A4 height boundaries
 * 4. Render N visible page containers, each showing its portion via translateY
 * 5. White overlay hides content beyond each page's break point
 */
export const PaginatedPreview = forwardRef<HTMLDivElement, Props>(function PaginatedPreview(
  { content, resolvedTemplate, styleSettings, showEmptyPlaceholders, onPaginationChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [measured, setMeasured] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recalculate = useCallback(() => {
    const container = measureRef.current;
    if (!container) return;

    const height = container.scrollHeight;
    if (height === 0) return; // Not rendered yet

    const breakPoints = findBreakPoints(container);
    const breaks = calculatePageBreaks(breakPoints, height);

    setPageBreaks(breaks);
    setTotalHeight(height);
    setMeasured(true);
    onPaginationChange?.({ pageBreaks: breaks, totalHeight: height });
  }, [onPaginationChange]);

  /** Debounced recalculate — prevents rapid-fire updates during smart layout measurement */
  const debouncedRecalculate = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(recalculate, 150);
  }, [recalculate]);

  // Initial measurement after layout
  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, content, resolvedTemplate, styleSettings]);

  // Re-measure on resize (font loading, window resize) — debounced to avoid flicker
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

  // Responsive scaling: when container is narrower than A4 width, scale down
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateScale = () => {
      const availableWidth = el.clientWidth;
      // Add some padding allowance (16px each side)
      const targetWidth = A4_WIDTH_PX + 32;
      const newScale = availableWidth >= targetWidth ? 1 : availableWidth / targetWidth;
      setScale(Math.min(1, Math.max(0.4, newScale)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Calculate pages from breaks
  const pageOffsets = [0, ...pageBreaks];
  const numPages = pageOffsets.length;

  return (
    <div ref={containerRef} className="w-full">
      {/* Invisible measurement container — OUTSIDE the scaled area to ensure accurate A4 measurements */}
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

      {/* Scaled visual output — zoom changes both visual and layout dimensions */}
      <div
        ref={ref}
        data-testid="resume-export-preview"
        className="flex flex-col items-center gap-8"
        style={{
          zoom: scale !== null && scale < 1 ? scale : undefined,
          visibility: scale === null ? "hidden" : undefined,
        }}
      >

      {/* Visible pages */}
      {measured && Array.from({ length: numPages }, (_, i) => {
        const offset = pageOffsets[i];
        const nextOffset = i < numPages - 1 ? pageOffsets[i + 1] : totalHeight;
        const isFirstPage = i === 0;
        const contentHeight = nextOffset - offset;
        // Bottom overlay: hide content beyond break + add bottom margin on continuation pages
        const bottomOverlay = Math.max(0, A4_HEIGHT_PX - contentHeight) + (isFirstPage ? 0 : CONTINUATION_PADDING);

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
            {/* Top white overlay for continuation page breathing room */}
            {!isFirstPage && (
              <div
                className="absolute inset-x-0 top-0 z-[1]"
                style={{ backgroundColor: "#ffffff", height: `${CONTINUATION_PADDING}px` }}
              />
            )}
            {/* Content shifted to show this page's portion */}
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
            {/* Bottom white overlay to hide content beyond break point */}
            {bottomOverlay > 0 && (
              <div
                className="absolute inset-x-0 bottom-0 z-[1]"
                style={{ backgroundColor: "#ffffff", height: `${bottomOverlay}px` }}
              />
            )}
            {/* Page number indicator */}
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

      {/* Fallback: show single page while measuring */}
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
  );
});
