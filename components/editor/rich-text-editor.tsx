"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline as UnderlineIcon, Link, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { tiptapExtensions } from "@/lib/tiptap-extensions";
import {
  DEFAULT_RICH_TEXT_FONT_SIZE,
  RICH_TEXT_FONT_SIZES,
  RICH_TEXT_PROSE_CLASS,
} from "@/lib/rich-text-prose";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { cn } from "@/lib/utils";

type Props = {
  content: TipTapJSON;
  onChange: (json: TipTapJSON) => void;
  placeholder?: string;
};

const COLOR_PALETTE = [
  "#000000", "#374151", "#DC2626", "#EA580C",
  "#CA8A04", "#16A34A", "#2563EB", "#7C3AED",
  "#DB2777", "#6B7280",
];

export function RichTextEditor({ content, onChange }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: tiptapExtensions,
    content,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getJSON() as TipTapJSON);
    },
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[80px] bg-background px-3 py-2 text-sm focus:outline-none",
          RICH_TEXT_PROSE_CLASS,
        ),
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = JSON.stringify(content);
    const current = JSON.stringify(editor.getJSON());
    if (incoming !== current) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-lg border transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring/30">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1.5">
        {/* Basic formatting */}
        <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} title="粗体" />
        <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} title="斜体" />
        <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UnderlineIcon} title="下划线" />
        <ToolBtn active={editor.isActive("link")} onClick={() => {
          const url = window.prompt("链接 URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
          else editor.chain().focus().unsetLink().run();
        }} icon={Link} title="链接" />

        <span className="mx-1 h-4 w-px bg-border/60" />

        {/* Lists */}
        <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} title="无序列表" />
        <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} title="有序列表" />

        <span className="mx-1 h-4 w-px bg-border/60" />

        {/* Alignment */}
        <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={AlignLeft} title="左对齐" />
        <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={AlignCenter} title="居中" />
        <ToolBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={AlignRight} title="右对齐" />

        <span className="mx-1 h-4 w-px bg-border/60" />

        <FontSizeToolbar editor={editor} />

        {/* Color */}
        <Popover>
          <PopoverTrigger
            render={<Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="颜色" />}
          >
            <Palette className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-5 gap-1">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="h-6 w-6 rounded border border-border transition-transform hover:scale-110"
                  style={{ backgroundColor: color }}
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  title={color}
                />
              ))}
            </div>
            <button
              type="button"
              className="mt-1.5 w-full rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => editor.chain().focus().unsetColor().run()}
            >
              重置颜色
            </button>
          </PopoverContent>
        </Popover>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function activeFontSize(editor: Editor): string {
  return editor.getAttributes("textStyle").fontSize ?? DEFAULT_RICH_TEXT_FONT_SIZE;
}

function FontSizeToolbar({ editor }: { editor: Editor }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  const current = activeFontSize(editor);

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5"
      role="group"
      aria-label="字号"
    >
      {RICH_TEXT_FONT_SIZES.map((size) => {
        const label = size.replace("px", "");
        const isDefault = size === DEFAULT_RICH_TEXT_FONT_SIZE;
        const active = current === size;

        return (
          <button
            key={size}
            type="button"
            title={isDefault ? "默认字号" : `${label}px`}
            className={cn(
              "h-6 min-w-7 rounded px-1 text-xs tabular-nums transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/70",
            )}
            onClick={() => {
              if (isDefault) {
                editor.chain().focus().unsetFontSize().run();
              } else {
                editor.chain().focus().setFontSize(size).run();
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ToolBtn({ active, onClick, icon: Icon, title }: { active: boolean; onClick: () => void; icon: React.FC<{ className?: string }>; title: string }) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="h-7 w-7"
      onClick={onClick}
      title={title}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
