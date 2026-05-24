import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import {
  buildPdfFailureResponse,
  PDF_NAVIGATION_TIMEOUT_MS,
  resolvePdfLaunchConfig,
  waitForPdfFonts,
} from "@/lib/pdf-route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("unauthorized", { status: 401 });
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, session.user.id)),
  });
  if (!row) return new NextResponse("not found", { status: 404 });

  const origin = new URL(req.url).origin;
  const previewUrl = `${origin}/resume/${id}/preview?_pdf=1`;
  const cookieHeader = req.headers.get("cookie") ?? "";

  let browser;
  try {
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
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.title)}.pdf"`,
      },
    });
  } catch (err) {
    console.error("PDF generation failed:", { resumeId: id, err });
    return buildPdfFailureResponse(err);
  } finally {
    if (browser) await browser.close();
  }
}
