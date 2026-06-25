import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/(app)/settings/page";

const MODEL_SETTINGS_KEY = "intro-builder.agent.model-settings.v1";
const MODEL_API_KEY = "intro-builder.agent.model-api-key.v1";

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
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("keeps the desktop settings card container full width", async () => {
    const ui = await SettingsPage();
    const { container } = render(ui);

    expect(container.querySelector("main")).toHaveClass("w-full");
  });

  it("shows the current Agent model settings and lets the user edit them", async () => {
    window.localStorage.setItem(
      MODEL_SETTINGS_KEY,
      JSON.stringify({
        baseUrl: "https://models.example.test/v1",
        modelName: "gpt-4.1-mini",
      }),
    );
    window.sessionStorage.setItem(MODEL_API_KEY, "sk-current-local");

    const ui = await SettingsPage();
    render(ui);

    expect(await screen.findByText("Agent 模型")).toBeInTheDocument();
    expect(screen.getByText("https://models.example.test/v1")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1-mini")).toBeInTheDocument();
    expect(screen.getByText("访问密钥已配置")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑模型设置" }));
    fireEvent.change(screen.getByLabelText("模型服务地址"), {
      target: { value: "https://models.next.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "sk-next-local" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "gpt-5-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("https://models.next.test/v1")).toBeInTheDocument();
    });
    expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
    expect(window.localStorage.getItem(MODEL_SETTINGS_KEY)).toBe(
      JSON.stringify({
        baseUrl: "https://models.next.test/v1",
        modelName: "gpt-5-mini",
      }),
    );
    expect(window.localStorage.getItem(MODEL_SETTINGS_KEY)).not.toContain(
      "sk-next-local",
    );
    expect(window.sessionStorage.getItem(MODEL_API_KEY)).toBe("sk-next-local");
  });
});
