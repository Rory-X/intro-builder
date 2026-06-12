import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collabSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withDbRetry } from "@/lib/db-retry";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  const { sessionId } = await req.json();

  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  const [collab] = await withDbRetry("collab.ownerToken", () =>
    db.select().from(collabSessions).where(
      and(
        eq(collabSessions.id, sessionId),
        eq(collabSessions.ownerId, userId),
      ),
    ).limit(1),
  );

  if (!collab) {
    return NextResponse.json({ error: "协作会话不存在" }, { status: 404 });
  }

  if (collab.expiresAt < new Date()) {
    return NextResponse.json({ error: "会话已过期" }, { status: 410 });
  }

  if (collab.status === "ended") {
    return NextResponse.json(
      { error: "协作已结束", status: "ended" },
      { status: 410 },
    );
  }

  // Issue PartyKit connection JWT for owner
  const secret = new TextEncoder().encode(process.env.COLLAB_JWT_SECRET!);
  const partyToken = await new SignJWT({
    resumeId: collab.resumeId,
    sessionId: collab.id,
    userId: session.user.id,
    displayName: session.user.name || "我",
    role: "owner",
    mode: collab.mode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("25h")
    .sign(secret);

  return NextResponse.json({
    partyToken,
    roomId: `resume-${collab.resumeId}-${collab.id}`,
  });
}
