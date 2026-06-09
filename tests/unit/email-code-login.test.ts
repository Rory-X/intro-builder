import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(),
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/email-code", () => ({
  verifyCode: vi.fn(),
}));

import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyCode } from "@/lib/email-code";
import { authorizeEmailCodeLogin } from "@/lib/email-code-login";

describe("authorizeEmailCodeLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an existing user when the verification code is valid", async () => {
    (verifyCode as unknown as Mock).mockResolvedValue(true);
    (db.query.users.findFirst as unknown as Mock).mockResolvedValue({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
    });

    await expect(authorizeEmailCodeLogin({
      email: " Alice@Example.com ",
      code: "123456",
    })).resolves.toEqual({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
    });

    expect(verifyCode).toHaveBeenCalledWith("alice@example.com", "123456");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates and returns a user when a valid code is used for a new email", async () => {
    (verifyCode as unknown as Mock).mockResolvedValue(true);
    (db.query.users.findFirst as unknown as Mock).mockResolvedValue(null);
    const returning = vi.fn().mockResolvedValue([{
      id: "u2",
      email: "new@example.com",
      name: null,
    }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as unknown as Mock).mockReturnValue({ values });

    await expect(authorizeEmailCodeLogin({
      email: "New@Example.com",
      code: "654321",
    })).resolves.toEqual({
      id: "u2",
      email: "new@example.com",
      name: null,
    });

    expect(values).toHaveBeenCalledWith({
      email: "new@example.com",
      emailVerified: expect.any(Date),
    });
    expect(returning).toHaveBeenCalledWith({
      id: users.id,
      email: users.email,
      name: users.name,
    });
  });

  it("rejects invalid codes without creating a user", async () => {
    (verifyCode as unknown as Mock).mockResolvedValue(false);

    await expect(authorizeEmailCodeLogin({
      email: "alice@example.com",
      code: "000000",
    })).resolves.toBeNull();

    expect(db.query.users.findFirst).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
