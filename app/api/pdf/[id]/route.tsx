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
  try {
    const body = await req.json();
    pageBreaks = body.pageBreaks ?? [];
    totalHeight = body.totalHeight ?? 0;
  } catch { /* ignore parse errors, will fallback to native pagination */ }

  // Remote browser configured → use cloud service (production)
  if (BROWSER_WS_ENDPOINT) {
    return generatePdfRemote(id, session.user.id, row.title, pageBreaks, totalHeight);
  }

  // Fallback: local Puppeteer (dev environment)
  return generatePdfLocally(req, id, row.title, pageBreaks, totalHeight);
}

/**
 * Generate PDF via remote browser service (e.g. Browserless.io).
 * Uses a signed token for preview page authentication since the remote
 * browser cannot carry the user's session cookie.
 */
async function generatePdfRemote(resumeId: string, userId: string, title: string, pageBreaks: number[], totalHeight: number) {
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
    await page.setViewport({ width: 794, height: 1123 });
    await page.goto(previewUrl, { waitUntil: "networkidle2", timeout: PDF_NAVIGATION_TIMEOUT_MS });
    // Wait for PdfPreview to signal fonts loaded and content rendered
    await page.waitForSelector("[data-pdf-ready]", { timeout: 15_000 });
    await waitForPdfFonts(page);
    const pdfBuffer = await page.pdf({
      // Let Chromium's print engine handle pagination natively.
      // CSS break-inside:avoid on sections prevents mid-block splits.
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
      format: "A4",
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
