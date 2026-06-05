"use client";
import { createContext, useContext, useRef, useEffect, useState } from "react";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { cn } from "@/lib/utils";

/**
 * 把拖拽手柄 ref 通过 context 下发给 section 头部行 —— 这样整条 section 头
 * 既是拖拽手柄、又是折叠开关(点击折叠、拖动排序),不再需要单独的"拖拽排序"条。
 */
const SectionDragHandleContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);
export function useSectionDragHandle() {
  return useContext(SectionDragHandleContext);
}

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
    <SectionDragHandleContext.Provider value={handleRef}>
      <div
        ref={ref}
        className={cn(
          "overflow-hidden rounded-lg border bg-card transition-all duration-200",
          isDragging && "scale-[0.99] opacity-50",
          isDragOver && "ring-2 ring-primary/40 shadow-md shadow-primary/10",
        )}
      >
        {children}
      </div>
    </SectionDragHandleContext.Provider>
  );
}
