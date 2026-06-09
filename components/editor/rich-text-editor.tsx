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
import { TipTapJSON as TipTapJSONSchema, type TipTapJSON } from "@/lib/tiptap-types";
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
  originalText: string;
  originalTiptapJson: TipTapJSON;
  polishedText: string;
  replacementTiptapJson?: TipTapJSON;
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
          originalText: plainText,
          originalTiptapJson: tiptapJson,
          polishedText: result.polishedText,
          ...readReplacementTiptapJson(result),
          changeSummary: result.changeSummary,
          riskFlags: result.riskFlags.filter(isRiskFlag),
        },
      });
    } catch {
      setPolishState({ status: "error", message: "AI 润色暂不可用，请稍后再试" });
    }
  }

  function applyPolishCandidate(candidate: PolishCandidate) {
    const nextContent =
      candidate.replacementTiptapJson ??
      applyPolishedTextToExistingDoc(
        toPlainJson(activeEditor.getJSON()),
        candidate.polishedText,
      );
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
    <div className="border-b bg-muted/30 px-3 py-2 text-xs text-foreground dark:bg-muted/20">
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
            <PolishDiffView
              originalText={state.candidate.originalText}
              originalTiptapJson={state.candidate.originalTiptapJson}
              polishedText={state.candidate.polishedText}
              replacementTiptapJson={state.candidate.replacementTiptapJson}
            />
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

type DiffPart = {
  kind: "equal" | "delete" | "insert";
  text: string;
};

type DiffRow = {
  parts: DiffPart[];
};

const MAX_INLINE_DIFF_TOKENS = 800;
const MAX_VISIBLE_DIFF_ROWS = 6;
const DIFF_CONTEXT_CHARS = 18;

function PolishDiffView({
  originalText,
  originalTiptapJson,
  polishedText,
  replacementTiptapJson,
}: {
  originalText: string;
  originalTiptapJson: TipTapJSON;
  polishedText: string;
  replacementTiptapJson?: TipTapJSON;
}) {
  const rows = createDisplayDiffRows({
    originalText,
    originalTiptapJson,
    polishedText,
    replacementTiptapJson,
  });
  const visibleRows = rows.slice(0, MAX_VISIBLE_DIFF_ROWS);
  const hiddenRowCount = Math.max(0, rows.length - visibleRows.length);

  if (visibleRows.length === 0) {
    return (
      <p
        aria-label="AI 润色差异"
        className="mt-1 min-w-0 max-w-full whitespace-normal break-words text-muted-foreground [overflow-wrap:anywhere]"
      >
        {normalizeDiffDisplayText(polishedText)}
      </p>
    );
  }

  return (
    <div
      aria-label="AI 润色差异"
      className="mt-1 min-w-0 max-w-full overflow-x-hidden rounded-md border border-border/60 bg-background/80 px-2 py-1.5 shadow-sm dark:bg-background/50"
    >
      <div className="max-h-36 min-w-0 max-w-full space-y-1 overflow-y-auto">
        {visibleRows.map((row, rowIndex) => (
          <p
            key={rowIndex}
            data-diff-row
            title={getDiffRowText(row)}
            className="min-w-0 max-w-full whitespace-normal break-words leading-6 text-foreground [overflow-wrap:anywhere]"
          >
            {row.parts.map((part, partIndex) => (
              <DiffTextPart
                key={`${part.kind}-${partIndex}`}
                part={part}
              />
            ))}
          </p>
        ))}
        {hiddenRowCount > 0 && (
          <p className="leading-6 text-muted-foreground">
            还有 {hiddenRowCount} 行变更
          </p>
        )}
      </div>
    </div>
  );
}

function DiffTextPart({ part }: { part: DiffPart }) {
  if (part.kind === "equal") {
    return <span className="text-foreground/80">{part.text}</span>;
  }

  return (
    <span
      data-diff-kind={part.kind}
      className={cn(
        "mx-0.5 rounded px-1 py-0.5 break-words [overflow-wrap:anywhere]",
        part.kind === "delete"
          ? "bg-red-100 text-red-800 line-through decoration-red-500 dark:bg-red-950/45 dark:text-red-200"
          : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/45 dark:text-emerald-100",
      )}
    >
      {part.text}
    </span>
  );
}

function createDisplayDiffRows({
  originalText,
  originalTiptapJson,
  polishedText,
  replacementTiptapJson,
}: {
  originalText: string;
  originalTiptapJson: TipTapJSON;
  polishedText: string;
  replacementTiptapJson?: TipTapJSON;
}): DiffRow[] {
  const blockRows = replacementTiptapJson
    ? createBlockDiffRows(originalTiptapJson, replacementTiptapJson)
    : [];

  return blockRows.length > 0
    ? blockRows
    : createTextDiffRows(originalText, polishedText);
}

function createBlockDiffRows(
  originalTiptapJson: TipTapJSON,
  replacementTiptapJson: TipTapJSON,
): DiffRow[] {
  const originalBlocks = collectTextBlocks(originalTiptapJson as TipTapNode)
    .map(getBlockText);
  const replacementBlocks = collectTextBlocks(replacementTiptapJson as TipTapNode)
    .map(getBlockText);

  if (
    originalBlocks.length === 0 ||
    originalBlocks.length !== replacementBlocks.length
  ) {
    return [];
  }

  return originalBlocks
    .map((blockText, index) =>
      createDiffRow(blockText, replacementBlocks[index] ?? ""),
    )
    .filter(isDiffRow);
}

function createTextDiffRows(originalText: string, polishedText: string): DiffRow[] {
  const row = createDiffRow(originalText, polishedText);
  return row ? [row] : [];
}

function createDiffRow(originalText: string, polishedText: string): DiffRow | null {
  const parts = createContextualDiffParts(
    createInlineDiffParts(
      normalizeDiffDisplayText(originalText),
      normalizeDiffDisplayText(polishedText),
    ),
  );

  return parts.length > 0 ? { parts } : null;
}

function createContextualDiffParts(parts: DiffPart[]): DiffPart[] {
  const normalizedParts = parts
    .map((part) => ({
      kind: part.kind,
      text: normalizeDiffPartText(part.text),
    }))
    .filter((part) => part.text.length > 0);
  const changedIndexes = normalizedParts
    .map((part, index) =>
      part.kind !== "equal" && hasMeaningfulDiffText(part.text) ? index : -1,
    )
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return [];

  const firstChangedIndex = changedIndexes[0];
  const lastChangedIndex = changedIndexes.at(-1) ?? firstChangedIndex;
  const contextualParts: DiffPart[] = [];
  const beforeText = normalizedParts
    .slice(0, firstChangedIndex)
    .map((part) => part.text)
    .join("");
  const beforeContext = takeTextEnd(beforeText, DIFF_CONTEXT_CHARS).trimStart();
  if (beforeContext) {
    appendDiffPart(
      contextualParts,
      "equal",
      `${beforeText.length > beforeContext.length ? "…" : ""}${beforeContext}`,
    );
  }

  for (let index = firstChangedIndex; index <= lastChangedIndex; index += 1) {
    const part = normalizedParts[index];
    if (!part) continue;
    if (part.kind !== "equal" && !hasMeaningfulDiffText(part.text)) continue;
    appendDiffPart(contextualParts, part.kind, contextTextForDiffPart(part));
  }

  const afterText = normalizedParts
    .slice(lastChangedIndex + 1)
    .map((part) => part.text)
    .join("");
  const afterContext = takeTextStart(afterText, DIFF_CONTEXT_CHARS).trimEnd();
  if (afterContext) {
    appendDiffPart(
      contextualParts,
      "equal",
      `${afterContext}${afterText.length > afterContext.length ? "…" : ""}`,
    );
  }

  return contextualParts;
}

function contextTextForDiffPart(part: DiffPart): string {
  if (part.kind !== "equal") return part.text;
  const chars = Array.from(part.text);
  const maxEqualContext = DIFF_CONTEXT_CHARS * 2;
  if (chars.length <= maxEqualContext) return part.text;
  return `${takeTextStart(part.text, DIFF_CONTEXT_CHARS)}…${takeTextEnd(
    part.text,
    DIFF_CONTEXT_CHARS,
  )}`;
}

function isDiffRow(row: DiffRow | null): row is DiffRow {
  return row !== null;
}

function getDiffRowText(row: DiffRow): string {
  return normalizeDiffDisplayText(row.parts.map((part) => part.text).join(""));
}

function normalizeDiffDisplayText(text: string): string {
  return normalizeDiffPartText(text).trim();
}

function normalizeDiffPartText(text: string): string {
  return text.replace(/\s+/g, " ");
}

function hasMeaningfulDiffText(text: string): boolean {
  return /[0-9A-Za-z\u4e00-\u9fff]/u.test(text);
}

function takeTextStart(text: string, maxLength: number): string {
  return Array.from(text).slice(0, maxLength).join("");
}

function takeTextEnd(text: string, maxLength: number): string {
  return Array.from(text).slice(-maxLength).join("");
}

function createInlineDiffParts(
  originalText: string,
  polishedText: string,
): DiffPart[] {
  if (originalText === polishedText) {
    return [{ kind: "equal", text: polishedText }];
  }

  const originalTokens = tokenizeDiffText(originalText);
  const polishedTokens = tokenizeDiffText(polishedText);
  if (
    originalTokens.length + polishedTokens.length > MAX_INLINE_DIFF_TOKENS ||
    polishedTokens.length === 0
  ) {
    return [{ kind: "equal", text: polishedText }];
  }
  if (originalTokens.length === 0) {
    return [{ kind: "insert", text: polishedText }];
  }

  const table = createLcsTable(originalTokens, polishedTokens);
  const parts: DiffPart[] = [];
  let originalIndex = 0;
  let polishedIndex = 0;

  while (
    originalIndex < originalTokens.length &&
    polishedIndex < polishedTokens.length
  ) {
    if (originalTokens[originalIndex] === polishedTokens[polishedIndex]) {
      appendDiffPart(parts, "equal", originalTokens[originalIndex]);
      originalIndex += 1;
      polishedIndex += 1;
    } else if (
      table[originalIndex + 1][polishedIndex] >=
      table[originalIndex][polishedIndex + 1]
    ) {
      appendDiffPart(parts, "delete", originalTokens[originalIndex]);
      originalIndex += 1;
    } else {
      appendDiffPart(parts, "insert", polishedTokens[polishedIndex]);
      polishedIndex += 1;
    }
  }

  while (originalIndex < originalTokens.length) {
    appendDiffPart(parts, "delete", originalTokens[originalIndex]);
    originalIndex += 1;
  }
  while (polishedIndex < polishedTokens.length) {
    appendDiffPart(parts, "insert", polishedTokens[polishedIndex]);
    polishedIndex += 1;
  }

  return parts;
}

function tokenizeDiffText(text: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let bufferKind: "word" | "space" | null = null;

  for (const char of Array.from(text)) {
    const kind = getDiffCharKind(char);
    if (kind === "char") {
      if (buffer) tokens.push(buffer);
      buffer = "";
      bufferKind = null;
      tokens.push(char);
      continue;
    }
    if (bufferKind === kind) {
      buffer += char;
    } else {
      if (buffer) tokens.push(buffer);
      buffer = char;
      bufferKind = kind;
    }
  }
  if (buffer) tokens.push(buffer);

  return tokens;
}

function getDiffCharKind(char: string): "word" | "space" | "char" {
  if (/\s/.test(char)) return "space";
  if (/[\w#+./-]/u.test(char)) return "word";
  return "char";
}

function createLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () =>
    Array(right.length + 1).fill(0) as number[],
  );

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        left[i] === right[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

function appendDiffPart(
  parts: DiffPart[],
  kind: DiffPart["kind"],
  text: string,
) {
  const last = parts.at(-1);
  if (last?.kind === kind) {
    last.text += text;
  } else {
    parts.push({ kind, text });
  }
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

type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: unknown;
  marks?: unknown;
  content?: TipTapNode[];
  [key: string]: unknown;
};

function applyPolishedTextToExistingDoc(
  original: TipTapJSON,
  polishedText: string,
): TipTapJSON {
  const nextDoc = JSON.parse(JSON.stringify(original)) as TipTapJSON;
  const textBlocks = collectTextBlocks(nextDoc as TipTapNode);
  if (textBlocks.length === 0) return plainTextToDoc(polishedText);

  const replacementTexts = createReplacementTexts(polishedText, textBlocks);
  if (replacementTexts.length === 0) return plainTextToDoc(polishedText);

  textBlocks.forEach((block, index) => {
    block.content = createInlineContentForBlock(
      block,
      replacementTexts[index] ?? getBlockText(block),
    );
  });

  return nextDoc;
}

function collectTextBlocks(node: TipTapNode): TipTapNode[] {
  if (node.type === "paragraph") return [node];
  return Array.isArray(node.content)
    ? node.content.flatMap((child) => collectTextBlocks(child))
    : [];
}

function createReplacementTexts(text: string, textBlocks: TipTapNode[]): string[] {
  const expectedCount = textBlocks.length;
  const lines = splitPolishedTextLines(text);
  if (lines.length === expectedCount) return lines;
  if (lines.length > expectedCount) return fitPartsToCount(lines, expectedCount);

  const sentences = splitPolishedTextSentences(text);
  if (sentences.length >= expectedCount) {
    return fitPartsToCount(sentences, expectedCount);
  }
  const labelAwareSentences = splitBeforeLabelOnlyBlocks(sentences, textBlocks);
  if (labelAwareSentences.length >= expectedCount) {
    return fitPartsToCount(labelAwareSentences, expectedCount);
  }

  return lines;
}

function splitPolishedTextLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s*)/, "").trim())
    .filter(Boolean);
}

function splitPolishedTextSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[。！？；;])\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function fitPartsToCount(parts: string[], expectedCount: number): string[] {
  if (expectedCount <= 1) return [parts.join(" ")];
  return [
    ...parts.slice(0, expectedCount - 1),
    parts.slice(expectedCount - 1).join(" "),
  ];
}

function splitBeforeLabelOnlyBlocks(
  parts: string[],
  textBlocks: TipTapNode[],
): string[] {
  const labelOnlyTexts = new Set(
    textBlocks
      .map((block) => getBlockText(block).trim())
      .filter(isShortLabel),
  );
  if (labelOnlyTexts.size === 0) return parts;

  return parts.flatMap((part) => {
    for (const label of labelOnlyTexts) {
      if (part.startsWith(label) && part.length > label.length) {
        return [label, part.slice(label.length).trim()];
      }
    }
    return [part];
  }).filter(Boolean);
}

function getBlockText(block: TipTapNode): string {
  if (!Array.isArray(block.content)) return "";
  return block.content
    .filter(isTextNode)
    .map((node) => node.text)
    .join("");
}

function createInlineContentForBlock(
  block: TipTapNode,
  nextText: string,
): TipTapNode[] {
  if (!nextText) return [];
  const textNodes = Array.isArray(block.content)
    ? block.content.filter(isTextNode)
    : [];
  const labelNode = textNodes[0];
  const labelText = labelNode?.text ?? "";

  if (
    labelNode &&
    hasMarks(labelNode) &&
    isShortLabel(labelText) &&
    nextText.startsWith(labelText)
  ) {
    const rest = nextText.slice(labelText.length).trimStart();
    return [
      createTextNode(labelText, labelNode),
      ...(rest
        ? [createTextNode(rest, findNonBoldTextNode(textNodes) ?? labelNode)]
        : []),
    ];
  }

  return [createTextNode(nextText, textNodes[0])];
}

function isTextNode(node: TipTapNode): node is TipTapNode & { text: string } {
  return node.type === "text" && typeof node.text === "string";
}

function hasMarks(node: TipTapNode): boolean {
  return Array.isArray(node.marks) && node.marks.length > 0;
}

function isShortLabel(text: string): boolean {
  return text.length > 0 && text.length <= 24 && /[：:]$/.test(text);
}

function findNonBoldTextNode(nodes: TipTapNode[]): TipTapNode | undefined {
  return nodes.find((node) => {
    if (!Array.isArray(node.marks)) return true;
    return !node.marks.some(
      (mark) => isRecord(mark) && mark.type === "bold",
    );
  });
}

function createTextNode(text: string, template: TipTapNode | undefined): TipTapNode {
  return {
    type: "text",
    ...(cloneOptionalProperty(template, "marks")),
    text,
  };
}

function cloneOptionalProperty(
  source: TipTapNode | undefined,
  key: "marks",
): Partial<TipTapNode> {
  if (!source || source[key] === undefined) return {};
  return { [key]: JSON.parse(JSON.stringify(source[key])) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readReplacementTiptapJson(
  result: Record<string, unknown>,
): { replacementTiptapJson: TipTapJSON } | Record<string, never> {
  if (
    result.format !== "tiptap_json" ||
    result.replacementTiptapJson === undefined
  ) {
    return {};
  }
  const parsed = TipTapJSONSchema.safeParse(result.replacementTiptapJson);
  return parsed.success ? { replacementTiptapJson: parsed.data } : {};
}

function isRiskFlag(value: unknown): value is PolishCandidate["riskFlags"][number] {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.message === "string" &&
    value.message.trim() !== ""
  );
}
