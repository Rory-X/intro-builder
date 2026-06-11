import { db } from "@/db";
import { collabSessions, resumes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MentorJoinForm } from "./mentor-join-form";
import { withDbRetry } from "@/lib/db-retry";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "协作修改简历" };

export default async function CollabEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [session] = await withDbRetry("collabEntry.session", () =>
    db.select().from(collabSessions).where(
      eq(collabSessions.inviteToken, token),
    ).limit(1),
  );

  if (!session) notFound();

  const expired = session.expiresAt < new Date();

  const [resume] = await withDbRetry("collabEntry.resume", () =>
    db.select({ title: resumes.title }).from(resumes).where(
      eq(resumes.id, session.resumeId),
    ).limit(1),
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-background p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">协作修改简历</h1>
          <p className="text-sm text-muted-foreground">
            你被邀请{session.mode === "edit" ? "帮改" : "批注"}简历
            {resume?.title && (
              <>「<span className="font-medium text-foreground">{resume.title}</span>」</>
            )}
          </p>
        </div>

        {expired ? (
          <div className="rounded-lg bg-destructive/10 p-4 text-center">
            <p className="text-sm font-medium text-destructive">邀请已过期</p>
            <p className="mt-1 text-xs text-destructive/80">邀请链接有效期为 24 小时，请联系对方重新发送</p>
          </div>
        ) : (
          <MentorJoinForm inviteToken={token} mode={session.mode} />
        )}
      </div>
    </div>
  );
}
