import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeAll } from "vitest";

// Mock IntersectionObserver for motion/react whileInView
beforeAll(() => {
  global.IntersectionObserver = class IntersectionObserver {
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof global.IntersectionObserver;
});

vi.mock("@/lib/templates/registry-server", () => ({
  listAllTemplatesAsync: vi.fn().mockResolvedValue([]),
  listBuiltinHtmlFallbackTemplates: vi.fn().mockReturnValue([]),
}));

vi.mock("@/lib/templates/uploaded/fetch", () => ({
  listUploadedTemplates: vi.fn().mockResolvedValue([]),
}));

describe("Landing hero", () => {
  it("renders the main headline and feature chips", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    // Headline text
    expect(screen.getByText(/把简历/)).toBeInTheDocument();
    // Core feature chips (may appear multiple times on the page)
    expect(screen.getAllByText("结构化编辑").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("实时预览").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("PDF / 分享")).toBeInTheDocument();
  });

  it("shows the features section heading", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    expect(screen.getByText(/不只是简历模板/)).toBeInTheDocument();
  });
});
