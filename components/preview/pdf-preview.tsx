"use client";

/**
 * PDF-optimized preview that renders using page break data from the editor.
 *
 * KEY INSIGHT: This component does NOT measure or calculate page breaks itself.
 * It receives the exact pageBreaks and totalHeight from the editor's
 * PaginatedPreview (via the API request), and renders using the identical
 * translateY + overlay logic. This guarantees 100% consistency with the
 * live preview — same break positions, same rendering.
 *
 * Fallback: If no breaks are provided, renders content with CSS break-inside:avoid
 * for native browser pagination (content is never lost, but breaks may differ).
 */

import { useEffect, useRef, useState } from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { TemplateRenderer } from "./template-renderer";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "@/lib/pagination";

/** Must match PaginatedPreview's CONTINUATION_PADDING exactly */
const CONTINUATION_PADDING = 32;

type Props = {
  content: ResumeContent;
  templateId: TemplateId | string;
  styleSettings?: StyleSettings;
  /** Page break Y-offsets from the editor's PaginatedPreview */
  pageBreaks?: number[];
  /** Total content height from the editor's measurement */
  totalHeight?: number;
};

export function PdfPreview({ content, templateId, styleSettings, pageBreaks, totalHeight }: Props) {
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Signal ready after fonts load
  useEffect(() => {
    const markReady = () => setReady(true);
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(markReady));
    } else {
      setTimeout(markReady, 500);
    }
  }, []);

  const hasBreaks = pageBreaks && pageBreaks.length > 0 && totalHeight && totalHeight > 0;

  // If we have editor-provided breaks, render paginated (100% consistent)
  if (hasBreaks) {
    return <PaginatedPdfOutput
      content={content}
      templateId={templateId}
      styleSettings={styleSettings}
      pageBreaks={pageBreaks}
      totalHeight={totalHeight}
      ready={ready}
    />;
  }

  // Fallback: native browser pagination with CSS break-inside:avoid
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        header:not([data-pagination-header]), nav, footer { display: none !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
        main { display: block !important; padding: 0 !important; margin: 0 !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: A4; margin: 0; }
        [data-pagination-section] { break-inside: avoid; }
        [data-pagination-item] { break-inside: avoid; }
        [data-pagination-section-header] { break-inside: avoid; break-after: avoid; }
        [data-pagination-header] { break-inside: avoid; }
      `}} />
      <div
        ref={containerRef}
        style={{ width: `${A4_WIDTH_PX}px`, backgroundColor: "#ffffff" }}
        {...(ready ? { "data-pdf-ready": "true" } : {})}
      >
        <TemplateRenderer
          templateId={templateId}
          content={content}
          sectionOrder={content.sectionOrder}
          styleSettings={styleSettings}
        />
      </div>
    </>
  );
}

/**
 * Renders pages using the exact same logic as PaginatedPreview:
 * - Each page is 794×1123px with overflow:hidden
 * - Content positioned via translateY
 * - White overlays hide content beyond page boundaries
 * - page-break-after forces each div onto a separate PDF page
 */
function PaginatedPdfOutput({
  content,
  templateId,
  styleSettings,
  pageBreaks,
  totalHeight,
  ready,
}: {
  content: ResumeContent;
  templateId: TemplateId | string;
  styleSettings?: StyleSettings;
  pageBreaks: number[];
  totalHeight: number;
  ready: boolean;
}) {
  const pageOffsets = [0, ...pageBreaks];
  const numPages = pageOffsets.length;

  return (
    <>
      {/* PDF styles: hide app shell, configure print */}
      <style dangerouslySetInnerHTML={{ __html: `
        header:not([data-pagination-header]), nav, footer { display: none !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
        main { display: block !important; padding: 0 !important; margin: 0 !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: 794px 1123px; margin: 0; }
      `}} />

      {/* Pages container — signals readiness to Puppeteer */}
      <div
        style={{ margin: 0, padding: 0 }}
        {...(ready ? { "data-pdf-ready": "true" } : {})}
      >
        {Array.from({ length: numPages }, (_, i) => {
          const offset = pageOffsets[i];
          const isFirstPage = i === 0;
          // No bottom overlay — overflow:hidden at 1123px handles clipping naturally.
          // This prevents content loss from font rendering differences between browsers.

          return (
            <div
              key={i}
              style={{
                position: "relative",
                overflow: "hidden",
                width: `${A4_WIDTH_PX}px`,
                height: `${A4_HEIGHT_PX}px`,
                backgroundColor: "#ffffff",
                // Force each page to be a separate PDF page
                pageBreakAfter: i < numPages - 1 ? "always" : "auto",
                breakAfter: i < numPages - 1 ? "page" : "auto",
              } as React.CSSProperties}
            >
              {/* Top white overlay for continuation page breathing room */}
              {!isFirstPage && (
                <div style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 0,
                  height: `${CONTINUATION_PADDING}px`,
                  backgroundColor: "#ffffff",
                  zIndex: 1,
                }} />
              )}
              {/* Content shifted to show this page's portion */}
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
            </div>
          );
        })}
      </div>
    </>
  );
}
