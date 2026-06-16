import { currentUserId } from "@/lib/auth-helpers";
import {
  listAgentSessions,
  deleteAgentSession,
  renameAgentSession,
} from "@/lib/agent/session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const url = new URL(req.url);
  const resumeId = url.searchParams.get("resumeId");

  try {
    const sessions = await listAgentSessions({
      userId,
      resumeId,
    });
    return Response.json({ sessions });
  } catch {
    return Response.json(
      { error: "获取会话列表失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  try {
    const ok = await deleteAgentSession({ sessionId, userId });
    if (!ok) {
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "删除会话失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let body: { sessionId?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "无效请求" }, { status: 400 });
  }

  if (!body.sessionId || !body.title?.trim()) {
    return Response.json({ error: "缺少 sessionId 或 title" }, { status: 400 });
  }

  try {
    const ok = await renameAgentSession({
      sessionId: body.sessionId,
      userId,
      title: body.title.trim(),
    });
    if (!ok) {
      return Response.json({ error: "会话不存在" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "重命名失败" },
      { status: 500 },
    );
  }
}
