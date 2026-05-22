"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FileUp, Loader2, CheckCircle2, AlertTriangle, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ImportResult } from "@/lib/resume-import";

type Step = "idle" | "uploading" | "success" | "error";

const ACCEPTED = ".pdf,.docx,.jpg,.jpeg,.png";

export function ImportResumeButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  const handleFile = useCallback(async (file: File) => {
    setStep("uploading");
    setError("");
    setWarnings([]);
    setProgress("正在上传文件…");

    try {
      // Validate file size client-side
      if (file.size > 5 * 1024 * 1024) {
        setStep("error");
        setError("文件过大，最大支持 5MB");
        return;
      }

      const formData = new FormData();
      formData.append("file", file);

      setProgress("正在上传…");

      // Use streaming fetch to avoid gateway timeout
      const response = await fetch("/api/import-resume", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        // Handle non-streaming error responses
        if (response.status === 504) {
          throw new Error("解析超时，文件可能过大或服务繁忙，请稍后重试");
        }
        let errorMsg = `服务器错误 (${response.status})`;
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const errBody = await response.json();
            if (errBody.error) errorMsg = errBody.error;
          }
        } catch { /* ignore */ }
        throw new Error(errorMsg);
      }

      // Check if response is streaming (SSE) or plain JSON
      const contentType = response.headers.get("content-type") || "";
      let result: ImportResult;

      if (contentType.includes("text/event-stream")) {
        // Parse Server-Sent Events stream
        result = await readSSEStream(response, (msg) => setProgress(msg));
      } else if (contentType.includes("application/json")) {
        // Fallback: plain JSON response
        result = await response.json();
      } else {
        throw new Error("服务器返回了非预期的响应格式");
      }

      if (result.status === "success") {
        setProgress("正在创建简历…");
        if (result.warnings) setWarnings(result.warnings);

        // Create the resume
        const createRes = await fetch("/api/import-resume/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: result.data,
            title: file.name.replace(/\.(pdf|docx|jpg|jpeg|png)$/i, "") || "导入的简历",
          }),
          credentials: "include",
        });

        if (!createRes.ok) {
          let createErr = "创建简历失败";
          try {
            const body = await createRes.json();
            if (body.error) createErr = body.error;
          } catch { /* ignore */ }
          throw new Error(createErr);
        }
        const { id } = await createRes.json();

        setStep("success");
        toast.success("简历导入成功");
        setTimeout(() => {
          setOpen(false);
          router.push(`/resume/${id}/edit`);
        }, 500);
      } else if (result.status === "ocr-failed") {
        setStep("error");
        setError(result.error);
      } else {
        setStep("error");
        setError(result.error || "解析失败，请稍后重试");
      }
    } catch (e) {
      setStep("error");
      setError(e instanceof Error ? e.message : "导入失败，请稍后重试");
    }
  }, [router]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }

  function reset() {
    setStep("idle");
    setError("");
    setWarnings([]);
    setProgress("");
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={handleInputChange}
      />
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v && step !== "uploading") reset(); }}>
        <PopoverTrigger>
          <Button variant="outline" size="sm" className="gap-1.5">
            <FileUp className="h-4 w-4" />
            导入简历
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-80">
          {step === "idle" && (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="rounded-full bg-muted p-3">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">导入已有简历</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  支持 PDF、Word(.docx)、图片(.jpg/.png)
                </p>
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </Button>
              <p className="text-[11px] text-muted-foreground">最大 5MB</p>
            </div>
          )}

          {step === "uploading" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{progress}</p>
              <p className="text-[11px] text-muted-foreground/60">
                通常需要 10-30 秒，请耐心等待
              </p>
            </div>
          )}

          {step === "success" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium">导入成功</p>
              {warnings.length > 0 && (
                <div className="w-full rounded-md bg-amber-50 p-2 dark:bg-amber-950/30">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 dark:text-amber-400">⚠️ {w}</p>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">正在跳转到编辑页…</p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-center text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={reset}>
                重试
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

// ─── SSE Stream Reader ──────────────────────────────────────

async function readSSEStream(
  response: Response,
  onProgress: (message: string) => void,
): Promise<ImportResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastResult: ImportResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);
        if (event.step === "done" && event.result) {
          lastResult = event.result as ImportResult;
        } else if (event.message) {
          onProgress(event.message);
        }
      } catch {
        // Skip malformed events
      }
    }
  }

  if (!lastResult) {
    throw new Error("服务器未返回解析结果");
  }

  return lastResult;
}
