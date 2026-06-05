"use client";
import { useRef, useEffect, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GripVertical, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  sectionKey: string;
  children: React.ReactNode;
  /** 开启折叠模式:卡片头部显示摘要 + 展开箭头 + 删除,正文可折叠 */
  collapsible?: boolean;
  /** 折叠态摘要(标题·副标题·日期);仅 collapsible 时显示 */
  summary?: React.ReactNode;
  /** 默认展开(默认 true,避免加载时隐藏已有内容) */
  defaultOpen?: boolean;
  /** 删除回调(折叠头部的删除按钮);不传则不显示 */
  onDelete?: () => void;
};

/** 折叠态条目摘要:主标题 + 若干次要片段(自动过滤空值、截断) */
export function ItemSummary({ title, parts }: { title?: string; parts?: (string | undefined)[] }) {
  const rest = (parts ?? []).filter(Boolean) as string[];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-medium text-foreground">{title || "未填写"}</span>
      {rest.map((p, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <span className="text-[10px] leading-none">·</span>
          <span className="max-w-[150px] truncate">{p}</span>
        </span>
      ))}
    </span>
  );
}

export function ItemWrapper({
  id,
  sectionKey,
  children,
  collapsible = false,
  summary,
  defaultOpen = true,
  onDelete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    const el = ref.current;
    const handle = handleRef.current;
    if (!el || !handle) return;

    const cleanupDrag = draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({ type: "item", id, sectionKey }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });

    const cleanupDrop = dropTargetForElements({
      element: el,
      getData: () => ({ type: "item", id, sectionKey }),
      canDrop: ({ source }) => source.data.type === "item" && source.data.sectionKey === sectionKey && source.data.id !== id,
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: () => setIsDragOver(false),
    });

    return () => { cleanupDrag(); cleanupDrop(); };
  }, [id, sectionKey]);

  // 向后兼容:非折叠模式维持旧布局(手柄 + 内容,卡片由子节点自带)
  if (!collapsible) {
    return (
      <div
        ref={ref}
        className={`flex gap-2 transition-all duration-200 ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${isDragOver ? "rounded-lg shadow-sm ring-2 ring-primary/30" : ""}`}
      >
        <button ref={handleRef} type="button" className="mt-4 cursor-grab self-start rounded p-0.5 transition-colors duration-200 hover:bg-muted active:cursor-grabbing">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1">{children}</div>
      </div>
    );
  }

  // 折叠模式:卡片(bg-card-2) + 头部行(手柄·展开箭头·摘要·删除) + 正文(隐藏不卸载)
  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden rounded-lg border border-border/60 bg-card-2 transition-all duration-200",
        isDragging && "scale-[0.98] opacity-40",
        isDragOver && "ring-2 ring-primary/30",
      )}
    >
      <div className="group flex items-center gap-0.5 pr-2">
        <button
          ref={handleRef}
          type="button"
          aria-label="拖拽排序"
          className="flex cursor-grab items-center self-stretch px-1.5 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left text-sm"
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="删除此条"
            className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* 正文:折叠时用 hidden 隐藏而非卸载 —— 保住 TipTap 实例 / RHF register / 预览 useWatch */}
      <div className={cn("border-t border-border/60 p-4", !isOpen && "hidden")}>{children}</div>
    </div>
  );
}
