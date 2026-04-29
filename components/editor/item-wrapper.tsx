"use client";
import { useRef, useEffect, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GripVertical } from "lucide-react";

type Props = {
  id: string;
  sectionKey: string;
  children: React.ReactNode;
};

export function ItemWrapper({ id, sectionKey, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

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

  return (
    <div
      ref={ref}
      className={`flex gap-2 ${isDragging ? "opacity-50" : ""} ${isDragOver ? "ring-2 ring-primary/30 rounded" : ""}`}
    >
      <button ref={handleRef} type="button" className="mt-3 cursor-grab self-start">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
