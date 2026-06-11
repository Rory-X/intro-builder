import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/(app)/settings/page";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u1",
      email: "demo@example.com",
    },
  })),
}));

vi.mock("@/app/(app)/settings/actions", () => ({
  hasPassword: vi.fn(async () => false),
  sendCode: vi.fn(async () => ({ success: true })),
  setPassword: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  }),
}));

describe("SettingsPage layout", () => {
  it("keeps the desktop settings card container full width", async () => {
    const ui = await SettingsPage();
    const { container } = render(ui);

    expect(container.querySelector("main")).toHaveClass("w-full");
  });
});
