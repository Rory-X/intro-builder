"use client";

/**
 * Annotation list panel — shows all annotations with status and actions.
 */

import type { Annotation } from "@/hooks/use-annotations";
import { Button } from "@/components/ui/button";
import { Check, X, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  annotations: Annotation[];
  /** Owner can change status */
  canManage: boolean;
  onUpdateStatus?: (id: string, status: "accepted" | "dismissed") => void;
  onClickAnnotation?: (annotation: Annotation) => void;
};

const SECTION_LABELS: Record<string, string> = {
  basics: "基本信息",
  experience: "工作经历",
  education: "教育经历",
  projects: "项目经历",
  skills: "技能",
  custom: "自定义分区",
  unknown: "其他",
};

export function AnnotationList({ annotations, canManage, onUpdateStatus, onClickAnnotation }: Props) {
  if (annotations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="rounded-full bg-muted p-3">
          <MessageSquare className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">暂无批注</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canManage ? "等待导师添加批注" : "选中预览中的文字即可添加批注"}
          </p>
        </div>
      </div>
    );
  }

  const pending = annotations.filter((a) => a.status === "pending");
  const resolved = annotations.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>共 {annotations.length} 条批注</span>
        {pending.length > 0 && (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
            {pending.length} 待处理
          </span>
        )}
      </div>

      {/* Pending annotations */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">待处理</h3>
          {pending.map((ann) => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              canManage={canManage}
              onUpdateStatus={onUpdateStatus}
              onClick={() => onClickAnnotation?.(ann)}
            />
          ))}
        </div>
      )}

      {/* Resolved annotations */}
      {resolved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">已处理</h3>
          {resolved.map((ann) => (
            <AnnotationCard
              key={ann.id}
              annotation={ann}
              canManage={canManage}
              onUpdateStatus={onUpdateStatus}
              onClick={() => onClickAnnotation?.(ann)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnotationCard({
  annotation,
  canManage,
  onUpdateStatus,
  onClick,
}: {
  annotation: Annotation;
  canManage: boolean;
  onUpdateStatus?: (id: string, status: "accepted" | "dismissed") => void;
  onClick?: () => void;
}) {
  const statusStyles = {
    pending: "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20",
    accepted: "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20",
    dismissed: "border-gray-200 bg-gray-50/50 dark:border-gray-700 dark:bg-gray-900/20 opacity-60",
  };

  const statusLabels = {
    pending: null,
    accepted: <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 dark:bg-green-900/50 dark:text-green-300">已采纳</span>,
    dismissed: <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">已忽略</span>,
  };

  return (
    <div
      data-annotation-card={annotation.id}
      className={cn(
        "cursor-pointer rounded-lg border p-3 transition-colors hover:shadow-sm",
        statusStyles[annotation.status],
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {SECTION_LABELS[annotation.sectionKey] || annotation.sectionKey}
          {annotation.itemIndex !== undefined && ` #${annotation.itemIndex + 1}`}
        </span>
        <div className="flex items-center gap-1">
          {statusLabels[annotation.status]}
          <span className="text-[10px] text-muted-foreground">
            {new Date(annotation.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>

      {/* Selected text */}
      <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">
        「{annotation.selectedText}」
      </p>

      {/* Comment */}
      <p className="mt-1 text-sm">{annotation.comment}</p>

      {/* Author */}
      <p className="mt-1.5 text-[10px] text-muted-foreground">— {annotation.authorName}</p>

      {/* Actions (owner only, pending only) */}
      {canManage && annotation.status === "pending" && (
        <div className="mt-2 flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[10px] text-green-700 hover:bg-green-50 dark:text-green-400"
            onClick={(e) => { e.stopPropagation(); onUpdateStatus?.(annotation.id, "accepted"); }}
          >
            <Check className="h-3 w-3" />
            采纳
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-[10px] text-gray-500 hover:bg-gray-50"
            onClick={(e) => { e.stopPropagation(); onUpdateStatus?.(annotation.id, "dismissed"); }}
          >
            <X className="h-3 w-3" />
            忽略
          </Button>
        </div>
      )}
    </div>
  );
}
