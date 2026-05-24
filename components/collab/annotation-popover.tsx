"use client";

/**
 * Annotation popover: appears when user selects text in the preview.
 * Smart positioning: prefers right side of selection, falls back to below.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Send } from "lucide-react";

type Props = {
  previewRef: React.RefObject<HTMLDivElement | null>;
  onSubmit: (data: {
    selectedText: string;
    comment: string;
    sectionKey: string;
    itemIndex?: number;
  }) => void;
  enabled: boolean;
};

type PopoverPosition = {
  top: number;
  left: number;
  placement: "right" | "below";
};

type PopoverState = {
  visible: boolean;
  position: PopoverPosition;
  selectedText: string;
  sectionKey: string;
  itemIndex?: number;
};

const POPOVER_WIDTH = 288; // w-72 = 18rem = 288px
const POPOVER_HEIGHT_ESTIMATE = 220;
const GAP = 12;

export function AnnotationPopover({ previewRef, onSubmit, enabled }: Props) {
  const [popover, setPopover] = useState<PopoverState>({
    visible: false,
    position: { top: 0, left: 0, placement: "right" },
    selectedText: "",
    sectionKey: "",
  });
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const computePosition = useCallback((selectionRect: DOMRect, _containerRect: DOMRect): PopoverPosition => {
    // Use viewport coordinates directly (fixed positioning)
    const viewportWidth = window.innerWidth;
    const centerY = selectionRect.top + selectionRect.height / 2;

    // Try right side of selection
    const spaceRight = viewportWidth - selectionRect.right;
    if (spaceRight >= POPOVER_WIDTH + GAP) {
      return {
        top: Math.max(GAP, centerY - POPOVER_HEIGHT_ESTIMATE / 2),
        left: selectionRect.right + GAP,
        placement: "right",
      };
    }

    // Try left side
    if (selectionRect.left >= POPOVER_WIDTH + GAP) {
      return {
        top: Math.max(GAP, centerY - POPOVER_HEIGHT_ESTIMATE / 2),
        left: selectionRect.left - POPOVER_WIDTH - GAP,
        placement: "right",
      };
    }

    // Fall back to below selection
    return {
      top: selectionRect.bottom + GAP,
      left: Math.max(GAP, selectionRect.left),
      placement: "below",
    };
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!enabled) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

    const text = selection.toString().trim();
    if (text.length < 2) return;

    const range = selection.getRangeAt(0);
    const container = previewRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const selectionRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Find section context
    const anchorNode = range.startContainer.parentElement;
    const sectionEl = anchorNode?.closest("[data-pagination-section]");
    const sectionKey = sectionEl?.getAttribute("data-pagination-section") || "unknown";

    const itemEl = anchorNode?.closest("[data-pagination-item]");
    const itemIndex = itemEl?.getAttribute("data-pagination-item")
      ? parseInt(itemEl.getAttribute("data-pagination-item")!, 10)
      : undefined;

    const position = computePosition(selectionRect, containerRect);

    setPopover({
      visible: true,
      position,
      selectedText: text.slice(0, 200),
      sectionKey,
      itemIndex,
    });
    setComment("");
  }, [enabled, previewRef, computePosition]);

  // Attach listener
  useEffect(() => {
    const container = previewRef.current;
    if (!container || !enabled) return;
    container.addEventListener("mouseup", handleMouseUp);
    return () => container.removeEventListener("mouseup", handleMouseUp);
  }, [previewRef, enabled, handleMouseUp]);

  // Close on click outside
  useEffect(() => {
    if (!popover.visible) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-annotation-popover]")) return;
      setPopover((p) => ({ ...p, visible: false }));
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 100);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handleClickOutside); };
  }, [popover.visible]);

  // Focus textarea
  useEffect(() => {
    if (popover.visible) setTimeout(() => textareaRef.current?.focus(), 50);
  }, [popover.visible]);

  const handleSubmit = () => {
    if (!comment.trim()) return;
    onSubmit({
      selectedText: popover.selectedText,
      comment: comment.trim(),
      sectionKey: popover.sectionKey,
      itemIndex: popover.itemIndex,
    });
    setPopover((p) => ({ ...p, visible: false }));
    setComment("");
    window.getSelection()?.removeAllRanges();
  };

  if (!popover.visible) return null;

  return (
    <div
      ref={popoverRef}
      data-annotation-popover
      className="fixed z-50 w-72 rounded-xl border bg-background p-3 shadow-xl ring-1 ring-black/5"
      style={{
        top: `${popover.position.top}px`,
        left: `${popover.position.left}px`,
      }}
    >
      {/* Selected text preview */}
      <div className="mb-2 flex items-start gap-1.5">
        <MessageSquarePlus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p className="line-clamp-2 text-xs text-muted-foreground">
          「{popover.selectedText}」
        </p>
      </div>

      {/* Comment input */}
      <textarea
        ref={textareaRef}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="输入你的批注建议…"
        className="w-full resize-none rounded-lg border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />

      {/* Actions */}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">⌘+Enter 提交</span>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setPopover((p) => ({ ...p, visible: false }))}
          >
            取消
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleSubmit}
            disabled={!comment.trim()}
          >
            <Send className="h-3 w-3" />
            提交
          </Button>
        </div>
      </div>
    </div>
  );
}
