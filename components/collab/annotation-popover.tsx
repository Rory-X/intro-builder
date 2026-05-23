"use client";

/**
 * Annotation popover: appears when user selects text in the preview.
 * Shows the selected text + comment textarea + submit button.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Send } from "lucide-react";

type Props = {
  /** The preview container ref to attach selection listener */
  previewRef: React.RefObject<HTMLDivElement | null>;
  /** Called when user submits an annotation */
  onSubmit: (data: {
    selectedText: string;
    comment: string;
    sectionKey: string;
    itemIndex?: number;
  }) => void;
  /** Whether annotation is enabled */
  enabled: boolean;
};

type PopoverState = {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  sectionKey: string;
  itemIndex?: number;
};

export function AnnotationPopover({ previewRef, onSubmit, enabled }: Props) {
  const [popover, setPopover] = useState<PopoverState>({
    visible: false, x: 0, y: 0, selectedText: "", sectionKey: "",
  });
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleMouseUp = useCallback(() => {
    if (!enabled) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 2) return; // too short

    // Check if selection is within the preview container
    const range = selection.getRangeAt(0);
    const container = previewRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    // Get position for popover
    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Find section context
    const anchorNode = range.startContainer.parentElement;
    const sectionEl = anchorNode?.closest("[data-pagination-section]");
    const sectionKey = sectionEl?.getAttribute("data-pagination-section") || "unknown";

    const itemEl = anchorNode?.closest("[data-pagination-item]");
    const itemIndex = itemEl?.getAttribute("data-pagination-item")
      ? parseInt(itemEl.getAttribute("data-pagination-item")!, 10)
      : undefined;

    setPopover({
      visible: true,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 10,
      selectedText: text.slice(0, 200), // cap at 200 chars
      sectionKey,
      itemIndex,
    });
    setComment("");
  }, [enabled, previewRef]);

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

    // Delay to avoid immediate close from the mouseup that opened it
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [popover.visible]);

  // Focus textarea when popover opens
  useEffect(() => {
    if (popover.visible) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
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
    // Clear selection
    window.getSelection()?.removeAllRanges();
  };

  if (!popover.visible) return null;

  return (
    <div
      data-annotation-popover
      className="absolute z-50 w-72 rounded-xl border bg-background p-3 shadow-xl"
      style={{
        left: `${popover.x}px`,
        top: `${popover.y}px`,
        transform: "translate(-50%, -100%)",
      }}
    >
      {/* Arrow */}
      <div className="absolute left-1/2 top-full -translate-x-1/2 border-8 border-transparent border-t-border" />
      <div className="absolute left-1/2 top-full -translate-x-1/2 -mt-px border-8 border-transparent border-t-background" />

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
