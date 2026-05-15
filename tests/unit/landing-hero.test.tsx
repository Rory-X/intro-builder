import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Landing from "@/app/(marketing)/page";

vi.mock("@/lib/templates/classic/Layout", () => ({
  ClassicLayout: () => <div>Classic preview</div>,
}));

vi.mock("@/lib/templates/modern/Layout", () => ({
  ModernLayout: () => <div>Modern preview</div>,
}));

describe("Landing hero", () => {
  it("uses compact feature chips without the free-use badge", () => {
    render(<Landing />);

    expect(screen.queryByText("免费使用，无需信用卡")).not.toBeInTheDocument();
    expect(screen.getByText("结构化编辑")).toBeInTheDocument();
    expect(screen.getByText("实时预览")).toBeInTheDocument();
    expect(screen.getByText("PDF / 分享")).toBeInTheDocument();
  });
});
