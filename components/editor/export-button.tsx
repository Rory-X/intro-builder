"use client";

import { useState } from "react";
import { Download, FileImage, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  filename: string;
  onExportImage: () => Promise<void>;
  isExportingImage: boolean;
  className?: string;
  /** Ref to the PaginatedPreview root (data-testid="resume-export-preview") */
  previewRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * Combined export button with dropdown menu for PDF and image export.
 * PDF is generated client-side by capturing the preview DOM directly.
 */
export function ExportButton({
  filename,
  onExportImage,
  isExportingImage,
  className,
  previewRef,
}: Props) {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [open, setOpen] = useState(false);

  const isBusy = isDownloadingPdf || isExportingImage;

  async function downloadPdf() {
    if (isDownloadingPdf) return;
    if (!previewRef.current) {
      toast.error("预览未就绪，请稍后重试");
      return;
    }

    setIsDownloadingPdf(true);
    setOpen(false);
    try {
      const { exportPreviewAsPdf } = await import("@/lib/client/export-pdf");
      await exportPreviewAsPdf({
        previewRoot: previewRef.current,
        filename: filename || "简历",
      });
      toast.success("PDF 已生成");
    } catch (error) {
      console.error("[pdf-download] failed", error);
      toast.error("PDF 生成失败，请稍后重试");
    } finally {
      setIsDownloadingPdf(false);
    }
  }

  async function handleExportImage() {
    setOpen(false);
    await onExportImage();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-all duration-200 hover:bg-primary/90 hover:shadow-md hover:shadow-primary/30 disabled:cursor-wait disabled:opacity-80",
          className,
        )}
        disabled={isBusy}
      >
        {isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {isDownloadingPdf ? "生成中…" : isExportingImage ? "导出中…" : "导出简历"}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-40 p-1">
        <button
          type="button"
          onClick={downloadPdf}
          disabled={isBusy}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <FileText className="h-4 w-4 text-muted-foreground" />
          下载 PDF
        </button>
        <button
          type="button"
          onClick={handleExportImage}
          disabled={isBusy}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent disabled:opacity-50"
        >
          <FileImage className="h-4 w-4 text-muted-foreground" />
          导出图片
        </button>
      </PopoverContent>
    </Popover>
  );
}
