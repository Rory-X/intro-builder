import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collabSessions } from "@/db/schema";
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

  const [collab] = await withDbRetry("collab.end.read", () =>
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
    return NextResponse.json({ error: "会话已过期", status: "expired" }, { status: 410 });
  }

  await withDbRetry("collab.end.write", () =>
    db.update(collabSessions)
      .set({ status: "ended" })
      .where(eq(collabSessions.id, collab.id)),
  );

  return NextResponse.json({ status: "ended" });
}
