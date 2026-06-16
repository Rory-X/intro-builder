import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { agentSessions } from "@/db/schema";
import { currentUserId } from "@/lib/auth-helpers";

/**
 * Read the current preview for an agent session. Lives on the web side (not a
 * third agent endpoint): the web app owns Postgres, so it reads the persisted
 * `agent_session.stateJson` directly and returns the staged operations the
 * "应用" button feeds through {@link applyResumeOperation}, plus the display
 * snapshot for the preview pane.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const sessionId = new URL(req.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  const row = await db.query.agentSessions.findFirst({
    where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)),
  });
  if (!row) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  const changeSets = row.stateJson.workspace.changeSets ?? [];
  const staged = [...changeSets].reverse().find((set) => set.status === "staged");
  const latest = staged ?? changeSets.at(-1) ?? null;

  return Response.json({
    status: "ok",
    sessionId: row.id,
    preview: row.stateJson.workspace.draftResume ?? null,
    operations: latest?.operations ?? [],
  });
}
