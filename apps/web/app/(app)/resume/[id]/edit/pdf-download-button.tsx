"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  resumeId: string;
  filename: string;
  className?: string;
};

/**
 * The PDF route streams a Puppeteer-rendered PDF; on cold starts that can
 * take several seconds. A plain `<a href>` gives the user zero feedback
 * during that wait, so this component fetches the bytes ourselves, swaps
 * the label to a spinner + "生成 PDF 中…", then triggers a download via a
 * temporary blob URL. On failure we surface a toast instead of leaving the
 * tab silently spinning.
 */
export function PdfDownloadButton({ resumeId, filename, className }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);

  async function downloadPdf() {
    if (isDownloading) return;
    setIsDownloading(true);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(`/api/pdf/${resumeId}`, {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`PDF 接口返回 ${response.status}`);
      }
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${filename || "简历"}.pdf`;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success("PDF 已生成");
    } catch (error) {
      console.error("[pdf-download] failed", error);
      toast.error("PDF 生成失败，请稍后重试");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsDownloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={downloadPdf}
      disabled={isDownloading}
      aria-busy={isDownloading}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30 disabled:cursor-wait disabled:opacity-80",
        className,
      )}
    >
      {isDownloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {isDownloading ? "生成 PDF 中…" : "下载 PDF"}
    </button>
  );
}
