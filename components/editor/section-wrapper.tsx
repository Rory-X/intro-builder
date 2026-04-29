"use client";
import { useRef, useEffect, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GripHorizontal } from "lucide-react";

type Props = {
  id: string;
  children: React.ReactNode;
};

export function SectionWrapper({ id, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    const handle = handleRef.current;
    if (!el || !handle) return;

    const cleanupDrag = draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({ type: "section", id }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });

    const cleanupDrop = dropTargetForElements({
      element: el,
      getData: () => ({ type: "section", id }),
      canDrop: ({ source }) => source.data.type === "section" && source.data.id !== id,
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: () => setIsDragOver(false),
    });

    return () => { cleanupDrag(); cleanupDrop(); };
  }, [id]);

  return (
    <div
      ref={ref}
      className={`rounded-xl border bg-card transition-all duration-200 ${isDragging ? "opacity-40 scale-[0.98]" : ""} ${isDragOver ? "ring-2 ring-primary/40 shadow-md shadow-primary/10" : ""}`}
    >
      <div
        ref={handleRef}
        className="flex cursor-grab items-center gap-1.5 border-b border-dashed border-border/60 px-4 py-1.5 text-muted-foreground transition-colors duration-200 hover:bg-muted/60 active:cursor-grabbing"
      >
        <GripHorizontal className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">拖拽排序</span>
      </div>
      {children}
    </div>
  );
}
