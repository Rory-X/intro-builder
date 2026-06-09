"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline as UnderlineIcon, Link, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Palette,
} from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  applyRichTextFontSize,
  getActiveRichTextFontSize,
} from "@/lib/rich-text-font-size";
import { tiptapExtensions } from "@/lib/tiptap-extensions";
import {
  DEFAULT_RICH_TEXT_FONT_SIZE,
  RICH_TEXT_EDITOR_PROSE_CLASS,
  RICH_TEXT_FONT_SIZES,
  RICH_TEXT_FONT_SIZE_LABELS,
} from "@/lib/rich-text-prose";
import type { TipTapJSON } from "@/lib/tiptap-types";
import { cn } from "@/lib/utils";

/**
 * ProseMirror's `editor.getJSON()` returns objects whose nested `attrs`
 * carry the ProseMirror Mark/Node attribute instance. Next.js 16 server
 * actions serialize arguments through React Flight, which only walks plain
 * objects — non-plain prototypes get their entries dropped on the floor,
 * which is exactly what was happening to `fontSize` (the attribute survived
 * client `JSON.stringify` but never reached the `saveResume` action).
 *
 * Round-tripping through JSON guarantees we hand RHF a pure plain object,
 * so the value can travel intact through autosave.
 */
function toPlainJson(json: ReturnType<Editor["getJSON"]>): TipTapJSON {
  return JSON.parse(JSON.stringify(json)) as TipTapJSON;
}

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
  const lastSyncedContentRef = useRef(JSON.stringify(content));
  const [, setToolbarTick] = useState(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: tiptapExtensions,
    content,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(toPlainJson(e.getJSON()));
    },
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[56px] resize-y overflow-auto bg-white px-2.5 py-2 text-[13.5px] leading-[1.6] focus:outline-none dark:bg-muted/50 dark:text-foreground",
          RICH_TEXT_EDITOR_PROSE_CLASS,
        ),
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = JSON.stringify(content);
    if (incoming === lastSyncedContentRef.current) return;
    lastSyncedContentRef.current = incoming;
    const current = JSON.stringify(editor.getJSON());
    if (incoming !== current) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [editor, content]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const refresh = () => setToolbarTick((tick) => tick + 1);
    editor.on("selectionUpdate", refresh);
    editor.on("transaction", refresh);
    return () => {
      editor.off("selectionUpdate", refresh);
      editor.off("transaction", refresh);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="mt-1 overflow-hidden rounded-md border border-border/80 bg-white transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring/25 dark:bg-card">
      <div className="thin-scrollbar flex flex-wrap items-center gap-1 border-b bg-white px-1.5 py-1 dark:bg-card">
        {/* Basic formatting */}
        <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} icon={Bold} title="粗体" />
        <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={Italic} title="斜体" />
        <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} icon={UnderlineIcon} title="下划线" />
        <ToolBtn active={editor.isActive("link")} onClick={() => {
          const url = window.prompt("链接 URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
          else editor.chain().focus().unsetLink().run();
        }} icon={Link} title="链接" />

        <ToolbarSeparator />

        {/* Lists */}
        <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} icon={List} title="无序列表" />
        <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={ListOrdered} title="有序列表" />

        <ToolbarSeparator />

        {/* Alignment */}
        <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} icon={AlignLeft} title="左对齐" />
        <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} icon={AlignCenter} title="居中" />
        <ToolBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} icon={AlignRight} title="右对齐" />

        <ToolbarSeparator />

        <FontSizeToolbar
          editor={editor}
          onFormatChange={() => {
            // TipTap's onUpdate runs in the same microtask, but we forward
            // the latest JSON synchronously here too so RHF's `setValue` is
            // done before autosave reads `form.getValues()`.
            onChangeRef.current(toPlainJson(editor.getJSON()));
          }}
        />

        {/* Color */}
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="颜色"
              />
            }
          >
            <Palette className="h-3 w-3" />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="grid grid-cols-5 gap-1">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="h-5 w-5 rounded border border-border transition-transform hover:scale-110"
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

function FontSizeToolbar({
  editor,
  onFormatChange,
}: {
  editor: Editor;
  onFormatChange: () => void;
}) {
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

  const current = getActiveRichTextFontSize(editor);

  return (
    <div
      className="ml-0.5 flex shrink-0 items-center gap-px rounded-lg border border-border/60 bg-white p-0.5 dark:bg-card"
      role="group"
      aria-label="字号"
    >
      {RICH_TEXT_FONT_SIZES.map((size) => {
        const label = RICH_TEXT_FONT_SIZE_LABELS[size] ?? size;
        const isDefault = size === DEFAULT_RICH_TEXT_FONT_SIZE;
        const active = current === size;

        return (
          <button
            key={size}
            type="button"
            title={isDefault ? "默认字号" : `${label}px`}
            className={cn(
              "h-5 min-w-6 rounded-md px-1 text-[11px] tabular-nums transition-colors",
              active
                ? "bg-blue-500/10 font-bold text-blue-700 shadow-sm ring-1 ring-blue-500/20 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-blue-400/25"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
            onClick={() => {
              applyRichTextFontSize(editor, size);
              onFormatChange();
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ToolbarSeparator() {
  return <span className="mx-0.5 h-3 w-px shrink-0 bg-border/70" />;
}

function ToolBtn({ active, onClick, icon: Icon, title }: { active: boolean; onClick: () => void; icon: React.FC<{ className?: string }>; title: string }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] transition-colors",
        active
          ? "bg-blue-500/10 text-blue-700 shadow-sm ring-1 ring-blue-500/20 dark:bg-blue-400/15 dark:text-blue-300 dark:ring-blue-400/25 [&_svg]:stroke-[2.8]"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
      title={title}
    >
      <Icon className="h-3 w-3" />
    </button>
  );
}
