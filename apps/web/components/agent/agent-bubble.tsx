"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MessageCircle, X, Minimize2, Maximize2 } from "lucide-react";

type AgentBubbleProps = {
  children: React.ReactNode;
  defaultOpen?: boolean;
};

export function AgentBubble({ children, defaultOpen = false }: AgentBubbleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    dragging: boolean;
  } | null>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  // Initialize position to bottom-right via lazy state initializer
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && typeof window !== "undefined") {
      initializedRef.current = true;
      setPosition({
        x: window.innerWidth - 72,
        y: window.innerHeight - 120,
      });
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPosX: position.x,
        startPosY: position.y,
        dragging: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [position],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.dragging = true;
    }
    setPosition({
      x: Math.max(0, Math.min(window.innerWidth - 56, dragRef.current.startPosX + dx)),
      y: Math.max(0, Math.min(window.innerHeight - 56, dragRef.current.startPosY + dy)),
    });
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const wasDragging = dragRef.current.dragging;
      dragRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (!wasDragging && !open) {
        setOpen(true);
      }
    },
    [open],
  );

  if (!open) {
    return (
      <button
        ref={bubbleRef}
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "fixed",
          left: position.x,
          top: position.y,
          zIndex: 50,
        }}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors touch-none select-none"
        aria-label="打开 Agent 对话"
      >
        <MessageCircle className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 50,
      }}
      className="bottom-4 right-4"
    >
      <div
        className={`flex flex-col rounded-lg border bg-background shadow-xl transition-all ${
          expanded
            ? "fixed inset-4 sm:inset-6 md:inset-10"
            : "h-[480px] w-[380px] max-w-[calc(100vw-2rem)]"
        }`}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
          <span className="text-xs font-medium">Agent 对话</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setExpanded((p) => !p)}
              className="rounded p-1 hover:bg-muted"
              aria-label={expanded ? "缩小" : "放大"}
            >
              {expanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 hover:bg-muted"
              aria-label="关闭对话"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
