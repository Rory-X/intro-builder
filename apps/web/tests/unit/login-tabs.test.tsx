import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginTabs } from "@/app/(auth)/login/login-tabs";

function renderLoginTabs() {
  const actions = {
    sendLoginCode: vi.fn(async () => ({ success: true })),
    loginWithEmailCode: vi.fn(async () => undefined),
    sendLoginLink: vi.fn(async () => undefined),
    loginWithPassword: vi.fn(async () => undefined),
  };

  render(<LoginTabs {...actions} />);
  return actions;
}

describe("LoginTabs", () => {
  it("defaults to email-code login while keeping magic link and password tabs", () => {
    renderLoginTabs();

    expect(screen.getByRole("button", { name: "邮箱验证码" })).toHaveClass("bg-background");
    expect(screen.getByRole("button", { name: "魔法链接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "密码登录" })).toBeInTheDocument();
    expect(screen.getByText("发送验证码")).toBeInTheDocument();
  });

  it("moves to code entry after sending a login code", async () => {
    const actions = renderLoginTabs();

    fireEvent.change(screen.getByLabelText("邮箱"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    await waitFor(() => {
      expect(actions.sendLoginCode).toHaveBeenCalled();
    });

    expect(await screen.findByText("验证码已发送")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("6 位数字验证码")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录 / 注册" })).toBeInTheDocument();
  });
});
