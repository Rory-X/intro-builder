"use client";

/**
 * Client-side PDF export using html2canvas + jsPDF.
 *
 * Captures each page of the PaginatedPreview as an image and assembles
 * them into a multi-page PDF. This guarantees 100% pixel-perfect
 * consistency with the live preview — same fonts, same breaks, same rendering.
 */

import html2canvas from "html2canvas-pro";
import { jsPDF } from "jspdf";
import { A4_WIDTH_PX, A4_HEIGHT_PX } from "@/lib/pagination";

// A4 dimensions in mm (for jsPDF)
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

type ExportPdfOptions = {
  /** The PaginatedPreview root element (data-testid="resume-export-preview") */
  previewRoot: HTMLElement;
  /** PDF filename (without extension) */
  filename: string;
};

/**
 * Export the preview pages as a PDF by capturing each page div as a canvas.
 */
export async function exportPreviewAsPdf({ previewRoot, filename }: ExportPdfOptions): Promise<void> {
  // Find all page divs inside the preview (direct children of the export container)
  // PaginatedPreview renders pages as direct children of [data-testid="resume-export-preview"]
  const pageDivs = Array.from(previewRoot.children).filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.offsetHeight > 100 && // Skip tiny elements (like the measurement container hint)
      !el.hasAttribute("aria-hidden"), // Skip the invisible measurement container
  );

  if (pageDivs.length === 0) {
    throw new Error("No page elements found in preview");
  }

  // Create PDF (A4, portrait)
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  for (let i = 0; i < pageDivs.length; i++) {
    const pageDiv = pageDivs[i];

    // Capture page div as canvas at 2x resolution for quality
    const canvas = await html2canvas(pageDiv, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      width: A4_WIDTH_PX,
      height: A4_HEIGHT_PX,
      // Ignore the page number indicator for cleaner PDF
      ignoreElements: (el) => {
        return el.classList?.contains("tabular-nums") || false;
      },
    });

    // Convert canvas to image data
    const imgData = canvas.toDataURL("image/jpeg", 0.95);

    // Add new page for pages after the first
    if (i > 0) {
      pdf.addPage();
    }

    // Add image filling the entire A4 page
    pdf.addImage(imgData, "JPEG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
  }

  // Download
  pdf.save(`${filename || "简历"}.pdf`);
}
