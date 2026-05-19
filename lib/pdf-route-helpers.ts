import { NextResponse } from "next/server";
import { existsSync } from "node:fs";

export const PDF_NAVIGATION_TIMEOUT_MS = 8000;

type FontReadyPage = {
  evaluate: (fn: () => Promise<void>) => Promise<void>;
};

type ChromiumExecutableProvider = {
  executablePath: () => Promise<string>;
};

type ResolvePdfExecutablePathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (path: string) => boolean;
};

const MACOS_CHROME_EXECUTABLE_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

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

export async function resolvePdfExecutablePath(
  chromium: ChromiumExecutableProvider,
  options: ResolvePdfExecutablePathOptions = {},
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.existsSync ?? existsSync;

  if (env.PUPPETEER_EXECUTABLE_PATH && pathExists(env.PUPPETEER_EXECUTABLE_PATH)) {
    return env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (platform === "darwin") {
    const localChrome = MACOS_CHROME_EXECUTABLE_PATHS.find((path) => pathExists(path));
    if (localChrome) return localChrome;
  }

  return chromium.executablePath();
}
