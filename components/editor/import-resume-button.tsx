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
const TIMEOUT_MS = 120_000; // 2 minutes client-side timeout

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

      setProgress("正在解析简历…（可能需要 10-30 秒）");

      // Fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch("/api/import-resume", {
          method: "POST",
          body: formData,
          credentials: "include",
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
          throw new Error("请求超时，请稍后重试");
        }
        throw new Error("网络请求失败，请检查网络连接");
      }
      clearTimeout(timeoutId);

      // Check response status before parsing
      if (!response.ok) {
        // Specific message for gateway timeout
        if (response.status === 504) {
          throw new Error("解析超时，文件可能过大或服务繁忙，请稍后重试");
        }
        // Try to extract error message from JSON response
        let errorMsg = `服务器错误 (${response.status})，请稍后重试`;
        try {
          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const errBody = await response.json();
            if (errBody.error) errorMsg = errBody.error;
          }
        } catch {
          // If we can't parse the error response, use the generic message
        }
        throw new Error(errorMsg);
      }

      // Parse JSON response safely
      let result: ImportResult;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("服务器返回了非预期的响应格式");
        }
        result = await response.json();
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message.includes("非预期")) {
          throw parseErr;
        }
        throw new Error("解析服务器响应失败，请稍后重试");
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
    // Reset input so same file can be selected again
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
      <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
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
                文件越大解析时间越长，请耐心等待
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
