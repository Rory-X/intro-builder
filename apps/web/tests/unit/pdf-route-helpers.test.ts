import { describe, expect, it, vi } from "vitest";
import {
  buildPdfFailureResponse,
  isPdfTimeoutError,
  PDF_NAVIGATION_TIMEOUT_MS,
  resolvePdfLaunchConfig,
  resolvePdfExecutablePath,
  waitForPdfFonts,
} from "@/lib/pdf-route-helpers";

describe("PDF route helpers", () => {
  it("identifies navigation timeout errors", () => {
    expect(isPdfTimeoutError(new Error("Navigation timeout of 8000 ms exceeded"))).toBe(true);
    expect(isPdfTimeoutError(new Error("Protocol error"))).toBe(false);
  });

  it("returns 504 for timeout failures", () => {
    const response = buildPdfFailureResponse(new Error("Navigation timeout of 8000 ms exceeded"));
    expect(response.status).toBe(504);
  });

  it("keeps a single navigation timeout budget", () => {
    expect(PDF_NAVIGATION_TIMEOUT_MS).toBe(30000);
  });

  it("waits for browser fonts before printing", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(undefined) };

    await waitForPdfFonts(page);

    expect(page.evaluate).toHaveBeenCalledOnce();
  });

  it("uses local Chrome on macOS when available", async () => {
    const chromium = {
      executablePath: vi.fn().mockResolvedValue("/tmp/sparticuz-chromium"),
      args: ["--single-process"],
    };

    const executablePath = await resolvePdfExecutablePath(chromium, {
      platform: "darwin",
      env: { NODE_ENV: "test" },
      existsSync: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });

    expect(executablePath).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(chromium.executablePath).not.toHaveBeenCalled();
  });

  it("uses local browser launch args with local Chrome", async () => {
    const chromium = {
      executablePath: vi.fn().mockResolvedValue("/tmp/sparticuz-chromium"),
      args: ["--single-process"],
    };

    const config = await resolvePdfLaunchConfig(chromium, {
      platform: "darwin",
      env: { NODE_ENV: "test" },
      existsSync: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    });

    expect(config).toEqual({
      executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    expect(chromium.executablePath).not.toHaveBeenCalled();
  });

  it("falls back to Sparticuz Chromium outside local macOS", async () => {
    const chromium = {
      executablePath: vi.fn().mockResolvedValue("/tmp/sparticuz-chromium"),
      args: ["--single-process"],
    };

    const executablePath = await resolvePdfExecutablePath(chromium, {
      platform: "linux",
      env: { NODE_ENV: "test" },
      existsSync: () => false,
    });

    expect(executablePath).toBe("/tmp/sparticuz-chromium");
  });
});
