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
      className={`transition-opacity ${isDragging ? "opacity-50" : ""} ${isDragOver ? "ring-2 ring-primary/50 rounded" : ""}`}
    >
      <div
        ref={handleRef}
        className="mb-1 flex cursor-grab items-center gap-1 text-muted-foreground"
      >
        <GripHorizontal className="h-4 w-4" />
        <span className="text-xs">拖拽排序</span>
      </div>
      {children}
    </div>
  );
}
