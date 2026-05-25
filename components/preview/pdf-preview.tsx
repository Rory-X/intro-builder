"use client";

/**
 * PDF-optimized preview using the same pagination algorithm as the editor preview.
 * Renders each page as a fixed A4-sized div with page-break-after for print.
 * This ensures PDF output matches the live preview exactly.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { TemplateRenderer } from "./template-renderer";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "@/lib/pagination";

type Props = {
  content: ResumeContent;
  templateId: TemplateId | string;
  styleSettings?: StyleSettings;
};

/** Block-level tags that can serve as fine-grained break points */
const BLOCK_TAGS = new Set(["P", "LI", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "BLOCKQUOTE"]);

/** Padding applied to top/bottom of continuation pages (page 2+) */
const CONTINUATION_PADDING = 32;
const BREAK_SAFETY_MARGIN = 2;

function findBreakPoints(container: HTMLElement): { bottom: number }[] {
  const bottomSet = new Set<number>();

  const breakables = container.querySelectorAll(
    "[data-pagination-item], [data-pagination-section], [data-pagination-section-header], [data-pagination-header]"
  );

  const seen = new Set<HTMLElement>();

  breakables.forEach((el) => {
    const element = el as HTMLElement;
    if (element.hasAttribute("data-pagination-section")) {
      if (element.querySelector("[data-pagination-item]")) return;
    }
    if (element.hasAttribute("data-pagination-item")) {
      if (element.parentElement?.closest("[data-pagination-item]")) return;
    }
    if (seen.has(element)) return;
    seen.add(element);

    const bottom = getAbsoluteBottom(element, container);
    bottomSet.add(Math.round(bottom));

    if (element.hasAttribute("data-pagination-item")) {
      addChildBreakPoints(element, container, bottomSet);
    }
  });

  return Array.from(bottomSet).sort((a, b) => a - b).map((bottom) => ({ bottom }));
}

function addChildBreakPoints(parent: HTMLElement, container: HTMLElement, bottomSet: Set<number>): void {
  for (const child of Array.from(parent.children)) {
    const el = child as HTMLElement;
    if (!BLOCK_TAGS.has(el.tagName)) continue;
    if (el.offsetHeight < 10) continue;
    bottomSet.add(Math.round(getAbsoluteBottom(el, container)));
    if (el.tagName === "DIV" || el.tagName === "UL" || el.tagName === "OL") {
      addChildBreakPoints(el, container, bottomSet);
    }
  }
}

function getAbsoluteBottom(element: HTMLElement, container: HTMLElement): number {
  return element.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
}

function calculatePageBreaks(breakPoints: { bottom: number }[], totalHeight: number): number[] {
  if (totalHeight <= A4_HEIGHT_PX) return [];
  const breaks: number[] = [];
  let pageStart = 0;
  let isFirstPage = true;

  while (pageStart < totalHeight) {
    const usableHeight = isFirstPage ? A4_HEIGHT_PX : A4_HEIGHT_PX - CONTINUATION_PADDING * 2;
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

  return breaks;
}

export function PdfPreview({ content, templateId, styleSettings }: Props) {
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

  // Initial measurement
  useLayoutEffect(() => {
    recalculate();
  }, [recalculate, content, templateId, styleSettings]);

  // ResizeObserver + font loading — mirrors PaginatedPreview exactly
  useEffect(() => {
    const container = measureRef.current;
    if (!container) return;

    if (typeof ResizeObserver !== "undefined") {
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
    }
  }, [recalculate, debouncedRecalculate]);

  const pageOffsets = [0, ...pageBreaks];
  const numPages = pageOffsets.length;

  return (
    <>
      {/* Screen styles: hide app shell, break flex context */}
      <style dangerouslySetInnerHTML={{ __html: `
        header:not([data-pagination-header]), nav, footer { display: none !important; }
        main { display: block !important; padding: 0 !important; margin: 0 !important; }
        html, body { margin: 0; padding: 0; background: white; }
      `}} />
      {/* Print/PDF styles: only applied when page.pdf() generates the PDF */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { size: A4; margin: 0; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}} />

      {/* Invisible measurement container */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", opacity: 0, width: `${A4_WIDTH_PX}px` }}
      >
        <TemplateRenderer
          templateId={templateId}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={styleSettings}
        />
      </div>

      {/* Visible pages — each one is exactly A4 with page-break-after */}
      {/* data-pdf-ready signals to Puppeteer that pagination is complete */}
      {measured && (
        <div data-pdf-ready="true">
          {Array.from({ length: numPages }, (_, i) => {
            const offset = pageOffsets[i];
            const nextOffset = i < numPages - 1 ? pageOffsets[i + 1] : totalHeight;
            const isFirstPage = i === 0;
            const contentHeight = nextOffset - offset;
            const bottomOverlay = Math.max(0, A4_HEIGHT_PX - contentHeight) + (isFirstPage ? 0 : CONTINUATION_PADDING);

            return (
              <div
                key={i}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  width: `${A4_WIDTH_PX}px`,
                  height: `${A4_HEIGHT_PX}px`,
                  backgroundColor: "#ffffff",
                  pageBreakAfter: i < numPages - 1 ? "always" : "auto",
                }}
              >
                {/* Top padding on continuation pages */}
                {!isFirstPage && (
                  <div style={{
                    position: "absolute",
                    inset: "0",
                    bottom: "auto",
                    height: `${CONTINUATION_PADDING}px`,
                    backgroundColor: "#ffffff",
                    zIndex: 1,
                  }} />
                )}
                {/* Content shifted for this page */}
                <div style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  transform: `translateY(${(isFirstPage ? 0 : CONTINUATION_PADDING) - offset}px)`,
                }}>
                  <TemplateRenderer
                    templateId={templateId}
                    content={content}
                    sectionOrder={content.sectionOrder}
                    styleSettings={styleSettings}
                  />
                </div>
                {/* Bottom overlay */}
                {bottomOverlay > 0 && (
                  <div style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
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

      {/* Fallback while measuring — hidden once ready */}
      {!measured && (
        <div style={{ width: `${A4_WIDTH_PX}px`, minHeight: `${A4_HEIGHT_PX}px`, backgroundColor: "#ffffff" }}>
          <TemplateRenderer
            templateId={templateId}
            content={content}
            sectionOrder={content.sectionOrder}
            styleSettings={styleSettings}
          />
        </div>
      )}
    </>
  );
}
