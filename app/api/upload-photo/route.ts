import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("unauthorized", { status: 401 });

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
    const blob = await put(`photos/${session.user.id}/${Date.now()}-${file.name}`, file, {
      access: "private",
      contentType: file.type,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: unknown) {
    console.error("Photo upload error:", err);
    const message = err instanceof Error ? err.message : "Unknown upload error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
