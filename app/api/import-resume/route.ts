import { auth } from "@/lib/auth";
import { importResume, isSupportedType } from "@/lib/resume-import";

// Allow longer execution for file processing + LLM call
export const maxDuration = 60;

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (!file) {
    return Response.json({ error: "请选择文件" }, { status: 400 });
  }

  if (!isSupportedType(file.type)) {
    return Response.json(
      { error: "不支持的文件格式，请上传 PDF、Word(.docx) 或图片(.jpg/.png)" },
      { status: 400 },
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json(
      { error: "文件过大，最大支持 5MB" },
      { status: 400 },
    );
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json(
      { status: "parse-failed", error: "服务未配置 DEEPSEEK_API_KEY" },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type;

  // Stream response to avoid gateway timeout — data flows immediately so
  // the connection stays alive even if processing takes 30+ seconds
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        sendEvent({ step: "extracting", message: "正在提取文件内容…" });

        const result = await importResume(buffer, mimeType, (step) => {
          sendEvent({ step, message: getStepMessage(step) });
        });

        sendEvent({ step: "done", result });
      } catch (error) {
        console.error("[import-resume] stream error:", error);
        sendEvent({
          step: "done",
          result: {
            status: "parse-failed",
            error: error instanceof Error ? error.message : "解析失败，请稍后重试",
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function getStepMessage(step: string): string {
  switch (step) {
    case "extracting": return "正在提取文件内容…";
    case "ocr": return "正在识别图片文字（OCR）…";
    case "structuring": return "AI 正在解析简历结构…";
    default: return "处理中…";
  }
}
