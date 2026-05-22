import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collabSessions, resumes } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { resumeId, mode = "edit" } = await req.json();

  if (!resumeId) {
    return NextResponse.json({ error: "缺少 resumeId" }, { status: 400 });
  }

  // Verify ownership
  const resume = await db.select().from(resumes).where(
    and(eq(resumes.id, resumeId), eq(resumes.userId, session.user.id)),
  ).limit(1);

  if (resume.length === 0) {
    return NextResponse.json({ error: "简历不存在" }, { status: 404 });
  }

  // Create collab session (24h TTL)
  const inviteToken = nanoid(21);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [created] = await db.insert(collabSessions).values({
    resumeId,
    ownerId: session.user.id,
    inviteToken,
    mode: mode === "comment" ? "comment" : "edit",
    expiresAt,
  }).returning();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.headers.get("origin") || "";
  const inviteUrl = `${baseUrl}/collab/${inviteToken}`;

  return NextResponse.json({
    sessionId: created.id,
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
  });
}
