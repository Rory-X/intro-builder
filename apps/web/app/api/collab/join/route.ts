import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { db } from "@/db";
import { collabSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withDbRetry } from "@/lib/db-retry";

export async function POST(req: Request) {
  const { inviteToken, mentorName } = await req.json();

  if (!inviteToken || !mentorName?.trim()) {
    return NextResponse.json({ error: "请输入昵称" }, { status: 400 });
  }

  // Look up session
  const [session] = await withDbRetry("collab.join.read", () =>
    db.select().from(collabSessions).where(
      eq(collabSessions.inviteToken, inviteToken),
    ).limit(1),
  );

  if (!session) {
    return NextResponse.json({ error: "邀请链接无效" }, { status: 404 });
  }

  if (session.expiresAt < new Date()) {
    return NextResponse.json({ error: "邀请已过期（24小时有效期）" }, { status: 410 });
  }

  if (session.status === "ended") {
    return NextResponse.json(
      { error: "协作已结束，请联系对方重新邀请", status: "ended" },
      { status: 410 },
    );
  }

  // Update session with mentor name, mark active
  await withDbRetry("collab.join.write", () =>
    db.update(collabSessions)
      .set({ mentorName: mentorName.trim(), status: "active" })
      .where(eq(collabSessions.id, session.id)),
  );

  // Issue PartyKit connection JWT (25h to cover session lifetime)
  const secret = new TextEncoder().encode(process.env.COLLAB_JWT_SECRET!);
  const partyToken = await new SignJWT({
    resumeId: session.resumeId,
    sessionId: session.id,
    userId: `mentor:${session.id}`,
    displayName: mentorName.trim(),
    role: "mentor",
    mode: session.mode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("25h")
    .sign(secret);

  return NextResponse.json({
    partyToken,
    resumeId: session.resumeId,
    sessionId: session.id,
    mode: session.mode,
    roomId: `resume-${session.resumeId}-${session.id}`,
  });
}
