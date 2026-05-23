import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collabSessions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/collab/session-status?sessionId=xxx
 *
 * Owner polls this endpoint to detect when a mentor joins.
 * Returns: { status, mentorName }
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  const [collab] = await db.select().from(collabSessions).where(
    and(
      eq(collabSessions.id, sessionId),
      eq(collabSessions.ownerId, session.user.id),
    ),
  ).limit(1);

  if (!collab) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  // Check if expired
  const status = collab.expiresAt < new Date() ? "expired" : collab.status;

  return NextResponse.json({
    status,
    mentorName: collab.mentorName || null,
  });
}
