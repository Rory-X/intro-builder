import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";

const setTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme }),
}));

describe("ThemeToggle", () => {
  it("uses hydration-stable label and toggles from resolved theme", () => {
    render(<ThemeToggle />);

    const button = screen.getByRole("button", { name: "切换主题" });
    expect(button).toHaveAttribute("title", "切换主题");

    fireEvent.click(button);
    expect(setTheme).toHaveBeenCalledWith("light");
  });
});
