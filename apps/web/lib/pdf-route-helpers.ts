import { NextResponse } from "next/server";
import { existsSync } from "node:fs";

export const PDF_NAVIGATION_TIMEOUT_MS = 30000;

type FontReadyPage = {
  evaluate: (fn: () => Promise<void>) => Promise<void>;
};

type ChromiumExecutableProvider = {
  executablePath: () => Promise<string>;
  args: string[];
};

type ResolvePdfExecutablePathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  existsSync?: (path: string) => boolean;
};

type PdfLaunchConfig = {
  executablePath: string;
  args: string[];
};

const MACOS_CHROME_EXECUTABLE_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

const LOCAL_BROWSER_PDF_ARGS = ["--no-sandbox", "--disable-setuid-sandbox"];

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

  const localExecutablePath = resolveLocalPdfExecutablePath(platform, env, pathExists);
  if (localExecutablePath) return localExecutablePath;

  return chromium.executablePath();
}

export async function resolvePdfLaunchConfig(
  chromium: ChromiumExecutableProvider,
  options: ResolvePdfExecutablePathOptions = {},
): Promise<PdfLaunchConfig> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathExists = options.existsSync ?? existsSync;

  const localExecutablePath = resolveLocalPdfExecutablePath(platform, env, pathExists);
  if (localExecutablePath) {
    return {
      executablePath: localExecutablePath,
      args: [...LOCAL_BROWSER_PDF_ARGS],
    };
  }

  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args,
  };
}

function resolveLocalPdfExecutablePath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  pathExists: (path: string) => boolean,
): string | null {
  if (env.PUPPETEER_EXECUTABLE_PATH && pathExists(env.PUPPETEER_EXECUTABLE_PATH)) {
    return env.PUPPETEER_EXECUTABLE_PATH;
  }

  if (platform === "darwin") {
    const localChrome = MACOS_CHROME_EXECUTABLE_PATHS.find((path) => pathExists(path));
    if (localChrome) return localChrome;
  }

  return null;
}
