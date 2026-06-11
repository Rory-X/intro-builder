import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
