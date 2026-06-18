import { currentUserId } from "@/lib/auth-helpers";
import {
  deleteFloatingChatSession,
  getFloatingChatSession,
  listFloatingChatMessages,
} from "@/lib/agent/floating-chat-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { sessionId } = await params;
  const session = await getFloatingChatSession({ sessionId, userId });
  if (!session) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const cursor = url.searchParams.get("cursor");
  const page = await listFloatingChatMessages({
    sessionId,
    before: cursor,
    limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 30,
  });

  return Response.json({
    session: {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt.toISOString(),
    },
    ...page,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { sessionId } = await params;
  const ok = await deleteFloatingChatSession({ sessionId, userId });
  if (!ok) {
    return Response.json({ error: "会话不存在" }, { status: 404 });
  }

  return Response.json({ ok: true });
}
