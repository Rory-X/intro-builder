"use client";

/**
 * PDF preview with self-contained pagination.
 *
 * Uses the SAME measurement + rendering logic as PaginatedPreview.
 * Since measurement and rendering happen in the SAME browser instance,
 * there's no cross-browser font difference issue.
 *
 * Adds a conservative bottom safety margin to ensure no content is ever
 * clipped even in edge cases.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import {
  ClientTemplateRenderFromSerializable,
  type SerializableResolvedTemplate,
} from "@/lib/templates/render";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "@/lib/pagination";

type Props = {
  content: ResumeContent;
  resolved: SerializableResolvedTemplate;
  styleSettings?: StyleSettings;
};

/** Must match PaginatedPreview */
const CONTINUATION_PADDING = 32;
const BREAK_SAFETY_MARGIN = 2;

/**
 * Extra bottom margin to ensure content is never cut off.
 * This makes each page break slightly earlier than the theoretical maximum,
 * guaranteeing no content loss.
 */
const BOTTOM_SAFETY_PX = 40;
const LINE_OVERFLOW_BUFFER = 6;

/**
 * If the last page only contains a tiny tail, treat it as measurement noise
 * or bottom spacing and merge it back into the previous page.
 */
const MIN_LAST_PAGE_CONTENT = 80;

const BLOCK_TAGS = new Set(["P", "LI", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"]);

function findBreakPoints(container: HTMLElement): { bottom: number }[] {
  const bottomSet = new Set<number>();
  const scannedTextNodes = new WeakSet<Node>();
  const breakables = container.querySelectorAll(
    "[data-pagination-item], [data-pagination-section], [data-pagination-section-header], [data-pagination-header]"
  );
  const seen = new Set<HTMLElement>();

  breakables.forEach((el) => {
    const element = el as HTMLElement;
    if (seen.has(element)) return;
    seen.add(element);

    const hasTextLines = addTextLineBreakPoints(element, container, bottomSet, scannedTextNodes);

    if (element.hasAttribute("data-pagination-section")) {
      if (element.querySelector("[data-pagination-item]")) return;
    }
    if (element.hasAttribute("data-pagination-item")) {
      if (element.parentElement?.closest("[data-pagination-item]")) return;
    }

    if (!hasTextLines) {
      const bottom = element.getBoundingClientRect().bottom - container.getBoundingClientRect().top + LINE_OVERFLOW_BUFFER;
      bottomSet.add(Math.round(bottom));
    }

    addChildBreakPoints(element, container, bottomSet, scannedTextNodes);
  });

  return Array.from(bottomSet).sort((a, b) => a - b).map((bottom) => ({ bottom }));
}

function addChildBreakPoints(
  parent: HTMLElement,
  container: HTMLElement,
  bottomSet: Set<number>,
  scannedTextNodes: WeakSet<Node>,
): void {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (!BLOCK_TAGS.has(el.tagName)) continue;
    if (el.offsetHeight < 10) continue;
    const hasTextLines = addTextLineBreakPoints(el, container, bottomSet, scannedTextNodes);
    if (!hasTextLines) {
      const bottom = el.getBoundingClientRect().bottom - container.getBoundingClientRect().top + LINE_OVERFLOW_BUFFER;
      bottomSet.add(Math.round(bottom));
    }
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

function calculatePageBreaks(breakPoints: { bottom: number }[], totalHeight: number): number[] {
  if (totalHeight <= A4_HEIGHT_PX) return [];

  const breaks: number[] = [];
  let pageStart = 0;
  let isFirstPage = true;

  while (pageStart < totalHeight) {
    // Conservative usable height — leaves safety margin at bottom
    const usableHeight = isFirstPage
      ? A4_HEIGHT_PX - BOTTOM_SAFETY_PX
      : A4_HEIGHT_PX - CONTINUATION_PADDING * 2 - BOTTOM_SAFETY_PX;
    const pageEnd = pageStart + usableHeight;

    if (pageEnd >= totalHeight) break;

    let bestBreak = -1;
    for (let i = 0; i < breakPoints.length; i++) {
      if (breakPoints[i].bottom <= pageEnd - BREAK_SAFETY_MARGIN && breakPoints[i].bottom > pageStart) {
        bestBreak = i;
      }
    }

    if (bestBreak >= 0) {
      breaks.push(breakPoints[bestBreak].bottom);
      pageStart = breakPoints[bestBreak].bottom;
    } else {
      breaks.push(pageEnd);
      pageStart = pageEnd;
    }
    isFirstPage = false;
  }

  if (breaks.length > 0) {
    const lastBreak = breaks[breaks.length - 1];
    const lastPageContent = totalHeight - lastBreak;
    if (lastPageContent < MIN_LAST_PAGE_CONTENT) {
      breaks.pop();
    }
  }

  return breaks;
}

export function PdfPreview({ content, resolved, styleSettings }: Props) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [pageBreaks, setPageBreaks] = useState<number[]>([]);
  const [totalHeight, setTotalHeight] = useState(0);
  const [measured, setMeasured] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  const debouncedRecalculate = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(recalculate, 150);
  }, [recalculate]);

  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, content, resolved, styleSettings]);

  useEffect(() => {
    const container = measureRef.current;
    if (!container) return;

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => debouncedRecalculate());
      observer.observe(container);
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => recalculate());
      }
      return () => {
        observer.disconnect();
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
      };
    }
  }, [recalculate, debouncedRecalculate]);

  const pageOffsets = [0, ...pageBreaks];
  const numPages = pageOffsets.length;

  return (
    <>
      {/* Hide app shell, FULLY reset body layout, configure print pages */}
      <style dangerouslySetInnerHTML={{ __html: `
        header:not([data-pagination-header]), nav, footer { display: none !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; display: block !important; min-height: 0 !important; height: auto !important; }
        main { display: block !important; padding: 0 !important; margin: 0 !important; flex: none !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: 794px 1123px; margin: 0; }
        .pdf-page { break-after: page; break-inside: avoid; }
        .pdf-page:last-child { break-after: auto; }
      `}} />

      {/* Invisible measurement container */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", opacity: 0, width: `${A4_WIDTH_PX}px` }}
      >
        <ClientTemplateRenderFromSerializable
          resolved={resolved}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={styleSettings}
        />
      </div>

      {/* Rendered pages */}
      {measured && (
        <div data-pdf-ready="true" data-pdf-breaks={JSON.stringify(pageBreaks)} data-pdf-total-height={totalHeight} data-pdf-num-pages={numPages} style={{ margin: 0, padding: 0, width: `${A4_WIDTH_PX}px` }}>
          {Array.from({ length: numPages }, (_, i) => {
            const offset = pageOffsets[i];
            const nextOffset = i < numPages - 1 ? pageOffsets[i + 1] : totalHeight;
            const isFirstPage = i === 0;
            const contentHeight = nextOffset - offset;
            // Bottom overlay hides next-page content bleeding through.
            // Page 1: content starts at Y=0, ends at Y=contentHeight
            // Page 2+: content starts at Y=CONTINUATION_PADDING, ends at Y=CONTINUATION_PADDING+contentHeight
            const bottomOverlay = isFirstPage
              ? Math.max(0, A4_HEIGHT_PX - contentHeight)
              : Math.max(0, A4_HEIGHT_PX - CONTINUATION_PADDING - contentHeight);

            return (
              <div
                key={i}
                className="pdf-page"
                style={{
                  position: "relative",
                  overflow: "hidden",
                  width: `${A4_WIDTH_PX}px`,
                  height: `${A4_HEIGHT_PX}px`,
                  backgroundColor: "#ffffff",
                }}
              >
                {!isFirstPage && (
                  <div style={{
                    position: "absolute",
                    left: 0, right: 0, top: 0,
                    height: `${CONTINUATION_PADDING}px`,
                    backgroundColor: "#ffffff",
                    zIndex: 1,
                  }} />
                )}
                <div style={{
                  position: "absolute",
                  left: 0, right: 0, top: 0,
                  transform: `translateY(${(isFirstPage ? 0 : CONTINUATION_PADDING) - offset}px)`,
                }}>
                  <ClientTemplateRenderFromSerializable
                    resolved={resolved}
                    content={content}
                    sectionOrder={content.sectionOrder}
                    styleSettings={styleSettings}
                  />
                </div>
                {bottomOverlay > 0 && (
                  <div style={{
                    position: "absolute",
                    left: 0, right: 0, bottom: 0,
                    height: `${bottomOverlay}px`,
                    backgroundColor: "#ffffff",
                    zIndex: 1,
                  }} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!measured && (
        <div style={{ width: `${A4_WIDTH_PX}px`, backgroundColor: "#ffffff" }}>
          <ClientTemplateRenderFromSerializable
            resolved={resolved}
            content={content}
            sectionOrder={content.sectionOrder}
            styleSettings={styleSettings}
          />
        </div>
      )}
    </>
  );
}
