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
): Promise<CollabTokenPayload> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
  });
  return payload as unknown as CollabTokenPayload;
}
