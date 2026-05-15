import { NextResponse } from "next/server";

export const PDF_NAVIGATION_TIMEOUT_MS = 8000;

type FontReadyPage = {
  evaluate: (fn: () => Promise<void>) => Promise<void>;
};

export function isPdfTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message);
}

export function buildPdfFailureResponse(error: unknown): NextResponse {
  const timedOut = isPdfTimeoutError(error);
  return new NextResponse(
    timedOut ? "PDF generation timed out" : "PDF generation failed",
    { status: timedOut ? 504 : 500 },
  );
}

export async function waitForPdfFonts(page: FontReadyPage): Promise<void> {
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }
  });
}
