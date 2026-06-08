"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline as UnderlineIcon, Link, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  polish?: RichTextPolishContext;
};

type RichTextPolishContext = {
  resumeId: string;
  section:
    | "summary"
    | "experience"
    | "projects"
    | "education"
    | "skills"
    | "research"
    | "custom";
  fieldPath: string;
  tone?: "professional" | "confident" | "concise";
  length?: "same" | "shorter" | "longer";
  strategy?: "plain" | "star";
};

type PolishCandidate = {
  polishedText: string;
  changeSummary: string;
  riskFlags: Array<{
    type: string;
    message: string;
  }>;
};

type PolishState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; candidate: PolishCandidate }
  | { status: "error"; message: string };

const COLOR_PALETTE = [
  "#000000", "#374151", "#DC2626", "#EA580C",
  "#CA8A04", "#16A34A", "#2563EB", "#7C3AED",
  "#DB2777", "#6B7280",
];

export function RichTextEditor({ content, onChange, polish }: Props) {
  const onChangeRef = useRef(onChange);
  const lastSyncedContentRef = useRef(JSON.stringify(content));
  const [polishState, setPolishState] = useState<PolishState>({ status: "idle" });
  const polishIconGradientId = `ai-polish-gradient-${useId().replace(/:/g, "")}`;

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
          "min-h-[80px] bg-background px-3 py-2 text-sm focus:outline-none",
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

  if (!editor) return null;
  const activeEditor = editor;

  async function requestPolish() {
    if (!polish) return;
    const plainText = activeEditor.getText().trim();
    if (!plainText) {
      setPolishState({ status: "error", message: "请先输入需要润色的内容" });
      return;
    }

    const tiptapJson = toPlainJson(activeEditor.getJSON());
    setPolishState({ status: "loading" });

    try {
      const response = await fetch("/api/agent/rich-text/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId: polish.resumeId,
          section: polish.section,
          fieldPath: polish.fieldPath,
          locale: "zh-CN",
          content: {
            format: "tiptap_json",
            plainText,
            tiptapJson,
          },
          intent: {
            mode: "polish",
            tone: polish.tone ?? "professional",
            length: polish.length ?? "same",
            strategy: polish.strategy ?? defaultPolishStrategy(polish.section),
          },
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "AI 润色暂不可用，请稍后再试";
        setPolishState({ status: "error", message });
        return;
      }
      if (!isRecord(body) || !isRecord(body.result)) {
        setPolishState({ status: "error", message: "AI 润色返回格式异常" });
        return;
      }
      const result = body.result;
      if (
        typeof result.polishedText !== "string" ||
        typeof result.changeSummary !== "string" ||
        !Array.isArray(result.riskFlags)
      ) {
        setPolishState({ status: "error", message: "AI 润色返回格式异常" });
        return;
      }

      setPolishState({
        status: "ready",
        candidate: {
          polishedText: result.polishedText,
          changeSummary: result.changeSummary,
          riskFlags: result.riskFlags.filter(isRiskFlag),
        },
      });
    } catch {
      setPolishState({ status: "error", message: "AI 润色暂不可用，请稍后再试" });
    }
  }

  function applyPolishCandidate(candidate: PolishCandidate) {
    const nextContent = plainTextToDoc(candidate.polishedText);
    activeEditor.commands.setContent(nextContent, { emitUpdate: false });
    lastSyncedContentRef.current = JSON.stringify(nextContent);
    onChangeRef.current(nextContent);
    setPolishState({ status: "idle" });
  }

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

        {polish && (
          <>
            <span className="mx-1 h-4 w-px bg-border/60" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 rounded-full border border-fuchsia-300/50 bg-background/90 px-2.5 text-xs font-semibold shadow-sm shadow-fuchsia-500/10 hover:bg-muted/70 hover:text-foreground focus-visible:ring-fuchsia-400/40 disabled:saturate-50 dark:border-fuchsia-400/40 dark:bg-muted/40 dark:shadow-fuchsia-950/40"
              disabled={polishState.status === "loading"}
              onClick={() => void requestPolish()}
            >
              <GradientSparklesIcon gradientId={polishIconGradientId} />
              <span className="bg-gradient-to-r from-sky-500 via-fuchsia-500 to-amber-400 bg-clip-text text-transparent">
                {polishState.status === "loading" ? "润色中" : "AI 润色"}
              </span>
            </Button>
          </>
        )}
      </div>
      {polishState.status !== "idle" && (
        <PolishCandidatePanel
          state={polishState}
          onApply={applyPolishCandidate}
          onDismiss={() => setPolishState({ status: "idle" })}
        />
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function GradientSparklesIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      height="24"
      stroke={`url(#${gradientId})`}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="2" x2="22" y1="2" y2="22">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="52%" stopColor="#d946ef" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}

function PolishCandidatePanel({
  state,
  onApply,
  onDismiss,
}: {
  state: Exclude<PolishState, { status: "idle" }>;
  onApply: (candidate: PolishCandidate) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b bg-amber-50/70 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/25 dark:text-amber-100">
      {state.status === "loading" && (
        <p className="text-muted-foreground">正在生成润色建议…</p>
      )}
      {state.status === "error" && (
        <div className="flex items-center justify-between gap-3">
          <p>{state.message}</p>
          <button
            type="button"
            className="font-medium text-foreground hover:underline"
            onClick={onDismiss}
          >
            关闭
          </button>
        </div>
      )}
      {state.status === "ready" && (
        <div className="space-y-2">
          <div>
            <p className="font-medium">AI 润色建议</p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">
              {state.candidate.polishedText}
            </p>
          </div>
          <p className="text-muted-foreground">{state.candidate.changeSummary}</p>
          {state.candidate.riskFlags.length > 0 && (
            <ul className="space-y-1 text-muted-foreground">
              {state.candidate.riskFlags.map((flag, index) => (
                <li key={`${flag.type}-${index}`}>{flag.message}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onApply(state.candidate)}
            >
              应用润色
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onDismiss}
            >
              放弃
            </Button>
          </div>
        </div>
      )}
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
      className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5"
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
              "h-6 min-w-7 rounded px-1 text-xs tabular-nums transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/70",
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

function defaultPolishStrategy(
  section: RichTextPolishContext["section"],
): "plain" | "star" {
  return section === "experience" || section === "projects" ? "star" : "plain";
}

function plainTextToDoc(text: string): TipTapJSON {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRiskFlag(value: unknown): value is PolishCandidate["riskFlags"][number] {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.message === "string" &&
    value.message.trim() !== ""
  );
}
