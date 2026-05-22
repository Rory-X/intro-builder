import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { importResume, isSupportedType } from "@/lib/resume-import";

// Allow up to 60 seconds for this route (Vercel Pro)
// OCR + LLM call can take 10-30 seconds
export const maxDuration = 60;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    }

    if (!isSupportedType(file.type)) {
      return NextResponse.json(
        { error: "不支持的文件格式，请上传 PDF、Word(.docx) 或图片(.jpg/.png)" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "文件过大，最大支持 5MB" },
        { status: 400 },
      );
    }

    // Check DeepSeek API key is configured
    if (!process.env.DEEPSEEK_API_KEY) {
      console.error("[import-resume] DEEPSEEK_API_KEY not configured");
      return NextResponse.json(
        { status: "parse-failed", error: "服务未配置完整，请联系管理员" },
        { status: 500 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importResume(buffer, file.type);

    return NextResponse.json(result);
  } catch (error) {
    console.error("[import-resume] route error:", error);
    return NextResponse.json(
      { status: "parse-failed", error: "服务器错误，请稍后重试" },
      { status: 500 },
    );
  }
}
