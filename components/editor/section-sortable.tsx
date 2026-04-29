"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripHorizontal } from "lucide-react";

export function SortableSection({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-50" : ""}
    >
      <div className="mb-1 flex cursor-grab items-center gap-1 text-muted-foreground" {...attributes} {...listeners}>
        <GripHorizontal className="h-4 w-4" />
        <span className="text-xs">拖拽排序</span>
      </div>
      {children}
    </div>
  );
}
