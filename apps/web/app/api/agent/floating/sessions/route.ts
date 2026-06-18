import { currentUserId } from "@/lib/auth-helpers";
import {
  createFloatingChatSession,
  listFloatingChatSessions,
} from "@/lib/agent/floating-chat-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const resumeId = new URL(req.url).searchParams.get("resumeId")?.trim();
  if (!resumeId) {
    return Response.json({ error: "缺少 resumeId" }, { status: 400 });
  }

  const sessions = await listFloatingChatSessions({ userId, resumeId });
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { resumeId?: string } | null;
  const resumeId = body?.resumeId?.trim();
  if (!resumeId) {
    return Response.json({ error: "缺少 resumeId" }, { status: 400 });
  }

  const session = await createFloatingChatSession({ userId, resumeId });
  return Response.json({ session });
}
