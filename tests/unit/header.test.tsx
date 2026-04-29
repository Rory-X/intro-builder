import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/app/(app)/actions/logout", () => ({ signOutAction: vi.fn() }));

import { auth } from "@/lib/auth";
import { Header } from "@/components/shell/header";

async function renderHeader() {
  const element = await Header();
  render(element);
}

describe("Header", () => {
  it("renders login button when signed out", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);
    await renderHeader();
    expect(screen.getAllByRole("link", { name: /登录/ }).length).toBeGreaterThan(0);
  });

  it("renders email initial in avatar when signed in", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { email: "alice@example.com" } });
    await renderHeader();
    expect(screen.getAllByText("A").length).toBeGreaterThan(0);
  });
});
