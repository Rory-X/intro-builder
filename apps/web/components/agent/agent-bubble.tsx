"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MessageSquare, Minus } from "lucide-react";

const DESKTOP_WINDOW_WIDTH = 440;
const DESKTOP_WINDOW_HEIGHT = 620;
const BUBBLE_SIZE = 56;
const GAP = 12;
const MARGIN = 8;
const MOBILE_BREAKPOINT = 640;
const STORAGE_KEY = "intro-builder.agent.floating-bubble-position.v1";

type BubbleOffset = {
  right: number;
  bottom: number;
};

type WindowPosition = {
  left: number;
  top: number;
};

type WindowSize = {
  width: number;
  height: number;
};

type AgentBubbleProps = {
  children: ReactNode;
  defaultOpen?: boolean;
  title?: string;
};

function getWindowSize(): WindowSize {
  if (typeof window === "undefined") {
    return { width: DESKTOP_WINDOW_WIDTH, height: DESKTOP_WINDOW_HEIGHT };
  }
  if (window.innerWidth < MOBILE_BREAKPOINT) {
    return {
      width: Math.min(window.innerWidth - MARGIN * 2, 360),
      height: Math.min(window.innerHeight - 120, 520),
    };
  }
  return { width: DESKTOP_WINDOW_WIDTH, height: DESKTOP_WINDOW_HEIGHT };
}

function readStoredBubbleOffset(): BubbleOffset {
  if (typeof window === "undefined") return { right: 24, bottom: 24 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      typeof parsed.right === "number" &&
      typeof parsed.bottom === "number"
    ) {
      return {
        right: Math.max(0, parsed.right),
        bottom: Math.max(0, parsed.bottom),
      };
    }
  } catch {
    // Ignore broken localStorage and fall back to the default corner.
  }
  return { right: 24, bottom: 24 };
}

function storeBubbleOffset(offset: BubbleOffset) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(offset));
}

function calculateWindowPosition(
  bubbleOffset: BubbleOffset,
  size: WindowSize,
): WindowPosition {
  if (typeof window === "undefined") return { left: 100, top: 100 };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const bubbleLeft = viewportWidth - bubbleOffset.right - BUBBLE_SIZE;
  const bubbleTop = viewportHeight - bubbleOffset.bottom - BUBBLE_SIZE;

  let left = bubbleLeft + BUBBLE_SIZE - size.width;
  let top = bubbleTop - GAP - size.height;

  if (top < MARGIN) top = bubbleTop + BUBBLE_SIZE + GAP;
  if (top + size.height > viewportHeight - MARGIN) {
    top = viewportHeight - MARGIN - size.height;
  }
  if (top < MARGIN) top = MARGIN;
  if (left < MARGIN) left = MARGIN;
  if (left + size.width > viewportWidth - MARGIN) {
    left = viewportWidth - MARGIN - size.width;
  }

  return { left, top };
}

function clampBubbleOffset(offset: BubbleOffset): BubbleOffset {
  if (typeof window === "undefined") return offset;
  return {
    right: Math.min(Math.max(0, offset.right), window.innerWidth - BUBBLE_SIZE),
    bottom: Math.min(
      Math.max(0, offset.bottom),
      window.innerHeight - BUBBLE_SIZE,
    ),
  };
}

export function AgentBubble({
  children,
  defaultOpen = false,
  title = "AI 简历助手",
}: AgentBubbleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [bubbleOffset, setBubbleOffset] = useState<BubbleOffset>({
    right: 24,
    bottom: 24,
  });
  const [manualWindowPosition, setManualWindowPosition] =
    useState<WindowPosition | null>(null);
  const [windowSize, setWindowSize] = useState<WindowSize>({
    width: DESKTOP_WINDOW_WIDTH,
    height: DESKTOP_WINDOW_HEIGHT,
  });
  const [hasMeasuredViewport, setHasMeasuredViewport] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  const bubbleDragRef = useRef<{
    startX: number;
    startY: number;
    originalRight: number;
    originalBottom: number;
  } | null>(null);
  const windowDragRef = useRef<{
    startX: number;
    startY: number;
    originalLeft: number;
    originalTop: number;
    originalRight: number;
    originalBottom: number;
  } | null>(null);
  const didDragRef = useRef(false);

  useEffect(() => {
    const measureFrame = window.requestAnimationFrame(() => {
      setWindowSize(getWindowSize());
      setBubbleOffset(clampBubbleOffset(readStoredBubbleOffset()));
      setHasMeasuredViewport(true);
    });

    function handleResize() {
      setWindowSize(getWindowSize());
      setBubbleOffset((current) => {
        const next = clampBubbleOffset(current);
        storeBubbleOffset(next);
        return next;
      });
      setManualWindowPosition(null);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(measureFrame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const autoWindowPosition = useMemo(
    () =>
      hasMeasuredViewport
        ? calculateWindowPosition(bubbleOffset, windowSize)
        : { left: 100, top: 100 },
    [bubbleOffset, hasMeasuredViewport, windowSize],
  );
  const windowPosition = manualWindowPosition ?? autoWindowPosition;

  const handleBubblePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      didDragRef.current = false;
      bubbleDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originalRight: bubbleOffset.right,
        originalBottom: bubbleOffset.bottom,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [bubbleOffset],
  );

  const handleBubblePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!bubbleDragRef.current) return;
      const dx = event.clientX - bubbleDragRef.current.startX;
      const dy = event.clientY - bubbleDragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didDragRef.current = true;
      }
      const next = clampBubbleOffset({
        right: bubbleDragRef.current.originalRight - dx,
        bottom: bubbleDragRef.current.originalBottom - dy,
      });
      setBubbleOffset(next);
      setManualWindowPosition(null);
    },
    [],
  );

  const handleBubblePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!bubbleDragRef.current) return;
      bubbleDragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      storeBubbleOffset(bubbleOffset);
    },
    [bubbleOffset],
  );

  const handleBubbleClick = useCallback(() => {
    if (!didDragRef.current) {
      setOpen((current) => !current);
    }
  }, []);

  const handleWindowPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      windowDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originalLeft: windowPosition.left,
        originalTop: windowPosition.top,
        originalRight: bubbleOffset.right,
        originalBottom: bubbleOffset.bottom,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [bubbleOffset, windowPosition],
  );

  const handleWindowPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!windowDragRef.current) return;
      const dx = event.clientX - windowDragRef.current.startX;
      const dy = event.clientY - windowDragRef.current.startY;
      setManualWindowPosition({
        left: windowDragRef.current.originalLeft + dx,
        top: windowDragRef.current.originalTop + dy,
      });
      const next = clampBubbleOffset({
        right: windowDragRef.current.originalRight - dx,
        bottom: windowDragRef.current.originalBottom - dy,
      });
      setBubbleOffset(next);
    },
    [],
  );

  const handleWindowPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!windowDragRef.current) return;
      windowDragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      storeBubbleOffset(bubbleOffset);
    },
    [bubbleOffset],
  );

  return (
    <>
      <section
        role="dialog"
        aria-label={title}
        aria-hidden={!open}
        className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-opacity duration-200 dark:border-border"
        style={{
          width: windowSize.width,
          height: windowSize.height,
          left: windowPosition.left,
          top: windowPosition.top,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div
          className="flex h-11 cursor-move items-center justify-between bg-gradient-to-r from-sky-600 via-teal-600 to-amber-500 px-4 text-white"
          onPointerDown={handleWindowPointerDown}
          onPointerMove={handleWindowPointerMove}
          onPointerUp={handleWindowPointerUp}
        >
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <button
            type="button"
            aria-label="收起 AI 简历助手"
            className="rounded p-1 text-white/85 transition hover:bg-white/20 hover:text-white"
            onClick={() => setOpen(false)}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </section>

      <div
        className="fixed z-50"
        style={{ right: bubbleOffset.right, bottom: bubbleOffset.bottom }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {showTooltip && !open ? (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
            打开 AI 简历助手
            <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-foreground" />
          </div>
        ) : null}
        <button
          type="button"
          aria-label={open ? "收起 AI 简历助手" : "打开 AI 简历助手"}
          className="relative flex h-14 w-14 cursor-grab items-center justify-center rounded-full bg-gradient-to-br from-sky-600 via-teal-600 to-amber-500 text-white shadow-lg transition-transform hover:scale-105 active:cursor-grabbing active:scale-95"
          onPointerDown={handleBubblePointerDown}
          onPointerMove={handleBubblePointerMove}
          onPointerUp={handleBubblePointerUp}
          onClick={handleBubbleClick}
        >
          <MessageSquare className="h-6 w-6" />
        </button>
      </div>
    </>
  );
}
