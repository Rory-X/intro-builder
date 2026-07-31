import { jwtVerify } from "jose";

export type CollabTokenPayload = {
  resumeId: string;
  sessionId: string;
  userId: string;
  displayName: string;
  role: "owner" | "mentor";
  mode: "edit" | "comment";
};

export async function verifyCollabToken(
  token: string,
  secret: string,
  roomId: string,
): Promise<CollabTokenPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
  });

  const collabPayload = parseCollabTokenPayload(payload);
  const expectedRoomId = `resume-${collabPayload.resumeId}-${collabPayload.sessionId}`;
  if (roomId !== expectedRoomId) {
    throw new Error("Collaboration token does not match the requested room");
  }

  return collabPayload;
}

function parseCollabTokenPayload(
  payload: Record<string, unknown>,
): CollabTokenPayload {
  const resumeId = readNonEmptyString(payload, "resumeId");
  const sessionId = readNonEmptyString(payload, "sessionId");
  const userId = readNonEmptyString(payload, "userId");
  const displayName = readNonEmptyString(payload, "displayName");

  if (payload.role !== "owner" && payload.role !== "mentor") {
    throw new Error("Invalid collaboration token payload: role");
  }
  if (payload.mode !== "edit" && payload.mode !== "comment") {
    throw new Error("Invalid collaboration token payload: mode");
  }

  return {
    resumeId,
    sessionId,
    userId,
    displayName,
    role: payload.role,
    mode: payload.mode,
  };
}

function readNonEmptyString(
  payload: Record<string, unknown>,
  field: string,
): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid collaboration token payload: ${field}`);
  }
  return value;
}
