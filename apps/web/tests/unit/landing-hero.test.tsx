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
}));

vi.mock("@/lib/templates/uploaded/fetch", () => ({
  listUploadedTemplates: vi.fn().mockResolvedValue([]),
}));

describe("Landing hero", () => {
  it("keeps the original headline and balanced feature chips", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    // Headline text
    expect(screen.getByText(/把简历/)).toBeInTheDocument();
    expect(screen.getByText(/一份产品/)).toBeInTheDocument();

    // Balanced feature chips
    expect(screen.getByText("流畅编辑")).toBeInTheDocument();
    expect(screen.getAllByText("AI 诊断").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("求职文档").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("PDF / 分享")).toBeInTheDocument();
  });

  it("shows the balanced features section heading", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    expect(screen.getByText(/不只是简历模板/)).toBeInTheDocument();
    expect(screen.getByText(/是从编辑到投递的工作台/)).toBeInTheDocument();
  });

  it("shows the hero mockup in agent mode with a live resume preview", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    expect(screen.getAllByText("Agent 模式").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("实时 A4 预览")).toBeInTheDocument();
    expect(screen.getByText("Agent 改写已应用")).toBeInTheDocument();
    expect(screen.getByText(/右侧预览会同步展示改写后的版本/)).toBeInTheDocument();
  });

  it("shows collaboration mockups for review and comment modes", async () => {
    const Landing = (await import("@/app/(marketing)/page")).default;
    const element = await Landing();
    render(element);

    expect(screen.getByText(/找人帮你改/)).toBeInTheDocument();
    expect(screen.getByText("帮改模式")).toBeInTheDocument();
    expect(screen.getByText("批注模式")).toBeInTheDocument();
    expect(screen.getAllByText(/产品运营实习生 - 陈晓晨/).length).toBeGreaterThanOrEqual(1);
  });
});
