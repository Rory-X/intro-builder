import { generateJSON } from "@tiptap/html";
import {
  TipTapJSON as TipTapJSONSchema,
  emptyDoc,
  type TipTapJSON,
} from "@intro-builder/shared/types";

import { tiptapExtensions } from "@/lib/tiptap-extensions";

const HTML_TAG_RE = /<\/?[a-z][a-z0-9-]*(\s|>|\/)/i;
const BULLET_RE = /^[-*]\s+/;
const ORDERED_RE = /^\d+[.)]\s+/;

export type NormalizedAgentRichText = {
  plainText: string;
  tiptapJson: TipTapJSON;
};

export function normalizeAgentRichTextInput(input: string): NormalizedAgentRichText {
  const raw = input.trim();
  if (!raw) {
    return { plainText: "", tiptapJson: emptyDoc() };
  }

  const isHtml = looksLikeHtml(raw);
  const fallbackText = isHtml ? stripHtmlToPlainText(raw) : raw;
  const parsedHtmlDoc = isHtml ? parseHtmlToTipTap(raw) : null;
  const tiptapJson = parsedHtmlDoc ?? plainTextToTipTapDoc(fallbackText);
  const plainText = extractTipTapPlainText(tiptapJson) || fallbackText;

  return { plainText, tiptapJson };
}

export function agentRichTextToTipTapDoc(input: string): TipTapJSON {
  return normalizeAgentRichTextInput(input).tiptapJson;
}

function looksLikeHtml(input: string): boolean {
  return HTML_TAG_RE.test(input);
}

function parseHtmlToTipTap(input: string): TipTapJSON | null {
  try {
    const parsed = TipTapJSONSchema.safeParse(
      generateJSON(input, tiptapExtensions),
    );
    if (!parsed.success) return null;
    return parsed.data.content.length > 0 ? parsed.data : emptyDoc();
  } catch {
    return null;
  }
}

function plainTextToTipTapDoc(input: string): TipTapJSON {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return emptyDoc();

  if (lines.every((line) => BULLET_RE.test(line))) {
    return {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: lines.map((line) => listItem(line.replace(BULLET_RE, ""))),
        },
      ],
    };
  }

  if (lines.every((line) => ORDERED_RE.test(line))) {
    return {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1, type: "1" },
          content: lines.map((line) => listItem(line.replace(ORDERED_RE, ""))),
        },
      ],
    };
  }

  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function listItem(text: string) {
  return {
    type: "listItem",
    content: [
      {
        type: "paragraph",
        content: text ? [{ type: "text", text }] : [],
      },
    ],
  };
}

function extractTipTapPlainText(value: unknown): string {
  const blocks: string[] = [];
  collectTextBlocks(value, blocks);
  return blocks.join("\n").trim();
}

function collectTextBlocks(value: unknown, blocks: string[]): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "paragraph") {
    const text = collectInlineText(record).trim();
    if (text) blocks.push(text);
    return;
  }
  if (!Array.isArray(record.content)) return;
  for (const child of record.content) {
    collectTextBlocks(child, blocks);
  }
}

function collectInlineText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.content)) return "";
  return record.content.map((child) => collectInlineText(child)).join("");
}

function stripHtmlToPlainText(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
