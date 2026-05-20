import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingSubmitButton } from "@/app/(app)/dashboard/pending-submit-button";

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    useFormStatus: vi.fn(() => ({ pending: false, data: null, method: null, action: null })),
  };
});

const { useFormStatus } = await import("react-dom");

describe("PendingSubmitButton", () => {
  it("shows the idle label and icon when no submission is pending", () => {
    (useFormStatus as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      pending: false,
      data: null,
      method: null,
      action: null,
    });

    render(
      <PendingSubmitButton
        idleIcon={<span data-testid="idle-icon" />}
        idleLabel="新建简历"
        pendingLabel="创建中…"
      />,
    );

    expect(screen.getByRole("button", { name: "新建简历" })).toBeEnabled();
    expect(screen.getByTestId("idle-icon")).toBeInTheDocument();
  });

  it("swaps to a spinner + pending label and disables when submission is pending", () => {
    (useFormStatus as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      pending: true,
      data: null,
      method: "POST",
      action: null,
    });

    render(
      <PendingSubmitButton
        idleIcon={<span data-testid="idle-icon" />}
        idleLabel="新建简历"
        pendingLabel="创建中…"
      />,
    );

    expect(screen.getByRole("button", { name: "创建中…" })).toBeDisabled();
    expect(screen.queryByTestId("idle-icon")).not.toBeInTheDocument();
  });

  it("renders the inline destructive variant for delete actions", () => {
    (useFormStatus as unknown as { mockReturnValue: (v: unknown) => void }).mockReturnValue({
      pending: false,
      data: null,
      method: null,
      action: null,
    });

    render(
      <PendingSubmitButton
        variant="inline-destructive"
        idleIcon={<span />}
        idleLabel="删除"
        pendingLabel="删除中…"
      />,
    );

    const button = screen.getByRole("button", { name: "删除" });
    expect(button.className).toContain("text-destructive");
  });
});
