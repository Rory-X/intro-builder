import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent as ResumeContentSchema } from "@/lib/resume-schema";
import { getDefaultTemplateId } from "@/lib/templates/registry-server";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const { content, title } = await request.json();

    // Validate content against schema
    const parsed = ResumeContentSchema.safeParse(content);
    if (!parsed.success) {
      return NextResponse.json({ error: "简历数据格式错误" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const templateId = await getDefaultTemplateId();
    await db.insert(resumes).values({
      id,
      userId: session.user.id,
      title: title || "导入的简历",
      content: parsed.data,
      templateId,
    });

    return NextResponse.json({ id });
  } catch (error) {
    console.error("[import-resume/create] error:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}
