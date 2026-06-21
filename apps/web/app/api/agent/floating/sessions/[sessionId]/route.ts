import { currentUserId } from "@/lib/auth-helpers";
import {
  deleteFloatingChatSession,
  getFloatingChatSession,
  listFloatingChatMessages,
  updateFloatingChatMessageApprovalStatus,
} from "@/lib/agent/floating-chat-session-store";
import type { AgentOperationApprovalRequest } from "@intro-builder/shared/types";

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

export async function PATCH(
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

  const body = await req.json().catch(() => null);
  const approvalUpdate = parseApprovalStatusUpdate(body);
  if (!approvalUpdate) {
    return Response.json({ error: "参数不完整" }, { status: 400 });
  }

  const ok = await updateFloatingChatMessageApprovalStatus({
    sessionId,
    ...approvalUpdate,
  });
  if (!ok) {
    return Response.json({ error: "修改建议不存在" }, { status: 404 });
  }

  return Response.json({ ok: true });
}

function parseApprovalStatusUpdate(value: unknown): {
  messageId: string | null;
  approvalId: string;
  status: Extract<AgentOperationApprovalRequest["status"], "approved" | "rejected">;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.approvalId !== "string" || !record.approvalId.trim()) return null;
  if (record.status !== "approved" && record.status !== "rejected") return null;
  return {
    messageId: typeof record.messageId === "string" ? record.messageId : null,
    approvalId: record.approvalId.trim(),
    status: record.status,
  };
}
