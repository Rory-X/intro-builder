import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent as ResumeContentSchema } from "@intro-builder/shared/schemas";
import { getDefaultTemplateId } from "@/lib/templates/registry-server";
import { withDbRetry } from "@/lib/db-retry";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { content, title } = await request.json();

    // Validate content against schema
    const parsed = ResumeContentSchema.safeParse(content);
    if (!parsed.success) {
      return NextResponse.json({ error: "简历数据格式错误" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const templateId = await getDefaultTemplateId();
    await withDbRetry("importResume.create", () =>
      db.insert(resumes).values({
        id,
        userId,
        title: title || "导入的简历",
        content: parsed.data,
        templateId,
      }),
    );

    return NextResponse.json({ id });
  } catch (error) {
    console.error("[import-resume/create] error:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}
