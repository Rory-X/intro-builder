import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));

import { signOut } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";

describe("signOutAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls signOut with redirectTo /", async () => {
    (signOut as unknown as Mock).mockResolvedValue(undefined);
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/" });
  });
});
