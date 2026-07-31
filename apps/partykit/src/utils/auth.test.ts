import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import { verifyCollabToken } from "./auth";

const SECRET = "test-collab-secret-with-enough-entropy";
const ROOM_ID = "resume-resume_123-session_456";

const validPayload = {
  resumeId: "resume_123",
  sessionId: "session_456",
  userId: "user_789",
  displayName: "测试用户",
  role: "owner" as const,
  mode: "edit" as const,
};

async function signToken(
  payload: Record<string, unknown> = validPayload,
  expiresIn = "1h",
) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

describe("verifyCollabToken", () => {
  it("accepts a valid token bound to the requested room", async () => {
    const token = await signToken();

    await expect(verifyCollabToken(token, SECRET, ROOM_ID)).resolves.toEqual(
      expect.objectContaining(validPayload),
    );
  });

  it("rejects a missing token", async () => {
    await expect(verifyCollabToken("", SECRET, ROOM_ID)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signToken(validPayload, "0s");

    await expect(verifyCollabToken(token, SECRET, ROOM_ID)).rejects.toThrow();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signToken();

    await expect(
      verifyCollabToken(token, "different-secret", ROOM_ID),
    ).rejects.toThrow();
  });

  it("rejects a malformed token", async () => {
    await expect(
      verifyCollabToken("not-a-jwt", SECRET, ROOM_ID),
    ).rejects.toThrow();
  });

  it("rejects a signed token with an invalid collaboration payload", async () => {
    const token = await signToken({
      ...validPayload,
      role: "administrator",
      displayName: "",
    });

    await expect(verifyCollabToken(token, SECRET, ROOM_ID)).rejects.toThrow(
      "payload",
    );
  });

  it("rejects a valid token issued for another room", async () => {
    const token = await signToken();

    await expect(
      verifyCollabToken(token, SECRET, "resume-other-session_456"),
    ).rejects.toThrow("room");
  });
});
