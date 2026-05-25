import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import puppeteer from "puppeteer-core";
import {
  buildPdfFailureResponse,
  PDF_NAVIGATION_TIMEOUT_MS,
  resolvePdfLaunchConfig,
  waitForPdfFonts,
} from "@/lib/pdf-route-helpers";
import { signPdfToken } from "@/lib/pdf-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Environment variable: WebSocket endpoint for a remote Chromium browser.
 * When set, uses puppeteer.connect() instead of local launch.
 * e.g. "wss://chrome.browserless.io?token=YOUR_TOKEN"
 */
const BROWSER_WS_ENDPOINT = process.env.BROWSER_WS_ENDPOINT;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("unauthorized", { status: 401 });

  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, session.user.id)),
  });
  if (!row) return new NextResponse("not found", { status: 404 });

  // Read pagination data from request body (sent by editor's ExportButton)
  let pageBreaks: number[] = [];
  let totalHeight = 0;
  let debugScreenshot = false;
  try {
    const body = await req.json();
    pageBreaks = body.pageBreaks ?? [];
    totalHeight = body.totalHeight ?? 0;
    debugScreenshot = body._debug === "screenshot";
  } catch { /* ignore parse errors, will fallback to native pagination */ }

  // Remote browser configured → use cloud service (production)
  if (BROWSER_WS_ENDPOINT) {
    return generatePdfRemote(id, session.user.id, row.title, pageBreaks, totalHeight, debugScreenshot);
  }

  // Fallback: local Puppeteer (dev environment)
  return generatePdfLocally(req, id, row.title, pageBreaks, totalHeight);
}

/**
 * Generate PDF via remote browser service (e.g. Browserless.io).
 * Uses a signed token for preview page authentication since the remote
 * browser cannot carry the user's session cookie.
 */
async function generatePdfRemote(resumeId: string, userId: string, title: string, pageBreaks: number[], totalHeight: number, debugScreenshot: boolean) {
  const token = signPdfToken(resumeId, userId);
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

  // Build preview URL with signed token
  const url = new URL(`/resume/${resumeId}/preview`, appOrigin);
  url.searchParams.set("_pdf", "1");
  url.searchParams.set("_token", token);

  // Pass page break data from editor (ensures PDF matches preview exactly)
  if (pageBreaks.length > 0 && totalHeight > 0) {
    const breaksData = Buffer.from(JSON.stringify({ pageBreaks, totalHeight })).toString("base64url");
    url.searchParams.set("_breaks", breaksData);
  }

  // Vercel Deployment Protection bypass
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypassSecret) {
    url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  }

  const previewUrl = url.toString();

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: BROWSER_WS_ENDPOINT!,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 2400 }); // Tall viewport to see full content
    await page.goto(previewUrl, { waitUntil: "networkidle2", timeout: PDF_NAVIGATION_TIMEOUT_MS });
    // Wait for PdfPreview to signal fonts loaded and content rendered
    await page.waitForSelector("[data-pdf-ready]", { timeout: 15_000 });
    await waitForPdfFonts(page);

    // Debug mode: return screenshot + pagination + font diagnostic
    if (debugScreenshot) {
      const debugInfo = await page.evaluate(() => {
        const readyEl = document.querySelector("[data-pdf-ready]");
        const pdfBreaks = readyEl?.getAttribute("data-pdf-breaks") || "[]";
        const pdfTotalHeight = readyEl?.getAttribute("data-pdf-total-height") || "0";
        const pdfNumPages = readyEl?.getAttribute("data-pdf-num-pages") || "0";
        const fonts = Array.from(document.fonts).map(f => ({
          family: f.family,
          status: f.status,
          weight: f.weight,
        }));
        const computedFont = window.getComputedStyle(document.body).fontFamily;
        const testEl = document.querySelector("[data-pagination-header]");
        const testFont = testEl ? window.getComputedStyle(testEl).fontFamily : "N/A";
        // Get all page div heights and offsets
        const pageDivs = readyEl ? Array.from(readyEl.children) : [];
        const pageInfo = pageDivs.map((el, i) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return { page: i, top: rect.top, height: rect.height, width: rect.width };
        });
        return {
          pageBreaks: JSON.parse(pdfBreaks),
          totalHeight: Number(pdfTotalHeight),
          numPages: Number(pdfNumPages),
          fonts,
          bodyFont: computedFont,
          headerFont: testFont,
          pageInfo,
          bodyHeight: document.body.scrollHeight,
          documentHeight: document.documentElement.scrollHeight,
        };
      });
      const screenshot = await page.screenshot({ fullPage: true, type: "png" });
      return new NextResponse(JSON.stringify({
        ...debugInfo,
        screenshotBase64: Buffer.from(screenshot).toString("base64"),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Screenshot each page div individually, then assemble into PDF.
    // This uses SCREEN rendering (not print engine) which matches the preview exactly.
    const { PDFDocument } = await import("pdf-lib");
    const numPages = await page.evaluate(() => {
      const el = document.querySelector("[data-pdf-ready]");
      return el ? el.children.length : 0;
    });

    if (numPages === 0) {
      return new NextResponse("No pages rendered", { status: 500 });
    }

    const pdfDoc = await PDFDocument.create();
    // A4 in points (72 DPI): 595.28 x 841.89
    const A4_WIDTH_PT = 595.28;
    const A4_HEIGHT_PT = 841.89;

    for (let i = 0; i < numPages; i++) {
      // Screenshot each .pdf-page div at its exact rendered size
      const elementHandle = await page.$(`[data-pdf-ready] > .pdf-page:nth-child(${i + 1})`);
      if (!elementHandle) continue;

      const pngBuffer = await elementHandle.screenshot({ type: "png" });
      const pngImage = await pdfDoc.embedPng(pngBuffer);
      const pdfPage = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
      pdfPage.drawImage(pngImage, {
        x: 0,
        y: 0,
        width: A4_WIDTH_PT,
        height: A4_HEIGHT_PT,
      });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("Remote PDF generation failed:", { resumeId, err });
    return buildPdfFailureResponse(err);
  } finally {
    // disconnect — don't close; the remote instance is managed by the service
    if (browser) browser.disconnect();
  }
}

/**
 * Generate PDF locally using puppeteer.launch() with system Chrome or @sparticuz/chromium.
 * Used in development or when BROWSER_WS_ENDPOINT is not configured.
 */
async function generatePdfLocally(req: Request, id: string, title: string, pageBreaks: number[], totalHeight: number) {
  const origin = new URL(req.url).origin;
  const url = new URL(`/resume/${id}/preview`, origin);
  url.searchParams.set("_pdf", "1");
  if (pageBreaks.length > 0 && totalHeight > 0) {
    const breaksData = Buffer.from(JSON.stringify({ pageBreaks, totalHeight })).toString("base64url");
    url.searchParams.set("_breaks", breaksData);
  }
  const previewUrl = url.toString();
  const cookieHeader = req.headers.get("cookie") ?? "";

  let browser;
  try {
    const chromium = (await import("@sparticuz/chromium")).default;
    const launchConfig = await resolvePdfLaunchConfig(chromium);
    browser = await puppeteer.launch({
      args: launchConfig.args,
      defaultViewport: { width: 794, height: 1123 },
      executablePath: launchConfig.executablePath,
      headless: true,
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ cookie: cookieHeader });
    await page.goto(previewUrl, { waitUntil: "networkidle2", timeout: PDF_NAVIGATION_TIMEOUT_MS });
    await waitForPdfFonts(page);
    const pdfBuffer = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    return new NextResponse(pdfBuffer as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation failed:", { resumeId: id, err });
    return buildPdfFailureResponse(err);
  } finally {
    if (browser) await browser.close();
  }
}
