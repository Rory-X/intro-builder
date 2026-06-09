"use client";
import { useRef, useEffect, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { Menu, ChevronRight, Trash2 } from "lucide-react";
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
      <span className="truncate text-[13.5px] font-semibold leading-none text-foreground">{title || "未填写"}</span>
      {rest.map((p, i) => (
        <span key={i} className="flex min-w-0 shrink items-center gap-1.5 text-muted-foreground">
          <span className="shrink-0 text-[9px] leading-none">·</span>
          <span className="max-w-[150px] truncate text-[12.5px] leading-none">{p}</span>
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
  const buttonHandleRef = useRef<HTMLButtonElement>(null);
  const rowHandleRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    const el = ref.current;
    const dragElement = collapsible ? rowHandleRef.current : el;
    const dragHandle = collapsible ? undefined : buttonHandleRef.current;
    if (!el || !dragElement || (!collapsible && !dragHandle)) return;

    const cleanupDrag = draggable({
      element: dragElement,
      ...(dragHandle ? { dragHandle } : {}),
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
  }, [collapsible, id, sectionKey]);

  // 向后兼容:非折叠模式维持旧布局(手柄 + 内容,卡片由子节点自带)
  if (!collapsible) {
    return (
      <div
        ref={ref}
        className={`flex gap-2 transition-all duration-200 ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${isDragOver ? "rounded-lg shadow-sm ring-2 ring-primary/30" : ""}`}
      >
        <button ref={buttonHandleRef} type="button" className="mt-4 cursor-grab self-start rounded p-0.5 transition-colors duration-200 hover:bg-muted active:cursor-grabbing">
          <Menu className="h-4 w-4 text-muted-foreground" />
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
        "overflow-hidden rounded-[9px] border border-border/70 bg-muted/50 transition-[transform,opacity,box-shadow] duration-300 ease-out",
        isDragging && "scale-[0.97] opacity-40 shadow-lg",
        isDragOver && "ring-2 ring-primary/30 translate-y-0.5",
      )}
    >
      <div
        ref={rowHandleRef}
        className="group flex min-h-[34px] cursor-grab items-center gap-0.5 pr-2 transition-colors hover:bg-foreground/[0.03] active:cursor-grabbing"
      >
        <button
          type="button"
          aria-label="拖拽排序"
          className="flex w-6 cursor-grab items-center justify-center self-stretch text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
        >
          <Menu className="h-[15px] w-[15px]" />
        </button>
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-90")} />
          <span className="min-w-0 flex-1 truncate">{summary}</span>
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label="删除此条"
            className="ml-1 flex h-[26px] w-[26px] shrink-0 scale-95 items-center justify-center text-muted-foreground opacity-0 transition-all duration-150 hover:text-destructive group-hover:scale-100 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/60 px-3 pb-3 pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
