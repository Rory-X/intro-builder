"use client";

/**
 * PDF-optimized preview.
 *
 * Strategy: Render the full resume content in a single column at A4 width,
 * and let Puppeteer's print engine handle pagination natively.
 * Uses CSS break-inside:avoid on sections/items to prevent mid-block splits.
 *
 * This ensures ALL content is always present in the PDF. Page breaks may differ
 * slightly from the live preview (which uses a custom DOM-measurement algorithm),
 * but no content is ever lost.
 */

import { useEffect, useRef, useState } from "react";
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { TemplateRenderer } from "./template-renderer";
import { A4_WIDTH_PX } from "@/lib/pagination";

type Props = {
  content: ResumeContent;
  templateId: TemplateId | string;
  styleSettings?: StyleSettings;
};

export function PdfPreview({ content, templateId, styleSettings }: Props) {
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Signal ready after fonts load and initial render
  useEffect(() => {
    const markReady = () => setReady(true);

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        // Extra frame to ensure layout has settled
        requestAnimationFrame(() => requestAnimationFrame(markReady));
      });
    } else {
      // Fallback: mark ready after a short delay
      setTimeout(markReady, 500);
    }
  }, []);

  return (
    <>
      {/* PDF styles: hide app shell, configure print layout */}
      <style dangerouslySetInnerHTML={{ __html: `
        header:not([data-pagination-header]), nav, footer { display: none !important; }
        html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
        main { display: block !important; padding: 0 !important; margin: 0 !important; }
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @page { size: A4; margin: 0; }

        /* Prevent breaks inside resume sections and items */
        [data-pagination-section] { break-inside: avoid; }
        [data-pagination-item] { break-inside: avoid; }
        [data-pagination-section-header] { break-inside: avoid; break-after: avoid; }
        [data-pagination-header] { break-inside: avoid; }
      `}} />

      {/* Resume content at exact A4 width */}
      <div
        ref={containerRef}
        style={{ width: `${A4_WIDTH_PX}px`, margin: "0 auto", backgroundColor: "#ffffff" }}
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
