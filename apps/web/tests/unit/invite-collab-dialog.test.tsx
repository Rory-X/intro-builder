import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteCollabDialog } from "@/components/collab/invite-collab-dialog";

describe("InviteCollabDialog", () => {
  it("uses the solid blue toolbar state when collaboration is active", () => {
    render(
      <InviteCollabDialog
        resumeId="r1"
        onSessionCreated={vi.fn()}
        isActive
      />,
    );

    const trigger = screen.getByRole("button", { name: "邀请协作" });
    expect(trigger.className).toContain("bg-primary");
    expect(trigger.className).toContain("text-primary-foreground");
  });
});

describe("InviteCollabDialog end session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an end action for active collaboration and calls onEndSession", async () => {
    const onEndSession = vi.fn().mockResolvedValue(undefined);
    render(
      <InviteCollabDialog
        resumeId="r1"
        onSessionCreated={vi.fn()}
        isActive
        sessionId="collab_1"
        onEndSession={onEndSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请协作" }));
    fireEvent.click(screen.getByRole("button", { name: "结束协作" }));

    await waitFor(() => expect(onEndSession).toHaveBeenCalledWith("collab_1"));
  });

  it("shows error when end session fails", async () => {
    const onEndSession = vi.fn().mockRejectedValue(new Error("failed"));
    render(
      <InviteCollabDialog
        resumeId="r1"
        onSessionCreated={vi.fn()}
        isActive
        sessionId="collab_1"
        onEndSession={onEndSession}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "邀请协作" }));
    fireEvent.click(screen.getByRole("button", { name: "结束协作" }));

    await screen.findByText("failed");
    expect(screen.getByRole("button", { name: "结束协作" })).toBeInTheDocument();
  });
});
