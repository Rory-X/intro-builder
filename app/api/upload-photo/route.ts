import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { currentUserId } from "@/lib/auth-helpers";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  // currentUserId 走 dev bypass，让本地无邮箱魔法链接也能上传头像；生产
  // 环境 NODE_ENV !== "development" 时短路退化为纯 session 校验。
  const userId = await currentUserId();
  if (!userId) return new NextResponse("unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "not an image" }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: "file too large (max 4MB)" }, { status: 400 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Photo upload is not configured. Please set BLOB_READ_WRITE_TOKEN environment variable." },
      { status: 503 }
    );
  }

  try {
    const blob = await put(`photos/${userId}/${Date.now()}-${file.name}`, file, {
      access: "public",
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: unknown) {
    console.error("Photo upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
