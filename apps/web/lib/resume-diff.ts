import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { TipTapJSON } from "@intro-builder/shared/types";

export type DiffTokenType = "unchanged" | "added" | "removed";

export type InlineDiffToken = {
  type: DiffTokenType;
  text: string;
};

export type RichInlineDiffToken = InlineDiffToken & {
  marks: Array<Record<string, unknown>>;
};

export type DiffBlock = {
  type: string;
  status: "unchanged" | "added" | "removed" | "modified";
  attrs?: Record<string, unknown>;
  tokens: RichInlineDiffToken[];
};

export type TipTapDiff = {
  blocks: DiffBlock[];
};

export type ResumeFieldDiff = {
  status: "unchanged" | "added" | "removed" | "modified";
  tokens: InlineDiffToken[];
};

export type ResumeDiff = {
  basics: Record<string, ResumeFieldDiff>;
  richText: Record<string, TipTapDiff>;
};

type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<Record<string, unknown>>;
  content?: TipTapNode[];
};

type TextSegment = {
  text: string;
  marks: Array<Record<string, unknown>>;
};

const RICH_TEXT_FIELDS = ["summary", "skills", "awards", "portfolio"] as const;

export function diffInlineText(oldText: string, newText: string): InlineDiffToken[] {
  if (oldText === newText) return oldText ? [{ type: "unchanged", text: oldText }] : [];
  const prefixLength = commonPrefixLength(oldText, newText);
  const rawSuffixLength = commonSuffixLength(
    oldText.slice(prefixLength),
    newText.slice(prefixLength),
  );
  const suffixLength = keepCommonSuffix(
    oldText.slice(oldText.length - rawSuffixLength),
  )
    ? rawSuffixLength
    : 0;
  const tokens: InlineDiffToken[] = [];
  if (prefixLength > 0) {
    tokens.push({ type: "unchanged", text: oldText.slice(0, prefixLength) });
  }
  const oldMiddle = oldText.slice(prefixLength, oldText.length - suffixLength);
  const newMiddle = newText.slice(prefixLength, newText.length - suffixLength);
  if (oldMiddle) tokens.push({ type: "removed", text: oldMiddle });
  if (newMiddle) tokens.push({ type: "added", text: newMiddle });
  if (suffixLength > 0) {
    tokens.push({ type: "unchanged", text: oldText.slice(oldText.length - suffixLength) });
  }
  return tokens;
}

export function diffTipTapDoc(oldDoc: TipTapJSON, newDoc: TipTapJSON): TipTapDiff {
  const oldBlocks = flattenBlocks(oldDoc as TipTapNode);
  const newBlocks = flattenBlocks(newDoc as TipTapNode);
  const blocks: DiffBlock[] = [];
  const max = Math.max(oldBlocks.length, newBlocks.length);
  for (let i = 0; i < max; i += 1) {
    const oldBlock = oldBlocks[i];
    const newBlock = newBlocks[i];
    if (!oldBlock && newBlock) {
      blocks.push({
        type: newBlock.type,
        attrs: newBlock.attrs,
        status: "added",
        tokens: newBlock.segments.map((segment) => ({
          type: "added",
          text: segment.text,
          marks: segment.marks,
        })),
      });
      continue;
    }
    if (oldBlock && !newBlock) {
      blocks.push({
        type: oldBlock.type,
        attrs: oldBlock.attrs,
        status: "removed",
        tokens: oldBlock.segments.map((segment) => ({
          type: "removed",
          text: segment.text,
          marks: segment.marks,
        })),
      });
      continue;
    }
    if (!oldBlock || !newBlock) continue;
    if (blocksEquivalent(oldBlock, newBlock)) {
      blocks.push(diffMatchingBlock(oldBlock, newBlock));
      continue;
    }
    if (oldBlock.type !== newBlock.type) {
      blocks.push({
        type: oldBlock.type,
        attrs: oldBlock.attrs,
        status: "removed",
        tokens: oldBlock.segments.map((segment) => ({
          type: "removed",
          text: segment.text,
          marks: segment.marks,
        })),
      });
      blocks.push({
        type: newBlock.type,
        attrs: newBlock.attrs,
        status: "added",
        tokens: newBlock.segments.map((segment) => ({
          type: "added",
          text: segment.text,
          marks: segment.marks,
        })),
      });
      continue;
    }
    if (shouldInlineDiffBlock(oldBlock, newBlock)) {
      blocks.push(diffMatchingBlock(oldBlock, newBlock));
    } else {
      blocks.push({
        type: oldBlock.type,
        attrs: oldBlock.attrs,
        status: "removed",
        tokens: oldBlock.segments.map((segment) => ({
          type: "removed",
          text: segment.text,
          marks: segment.marks,
        })),
      });
      blocks.push({
        type: newBlock.type,
        attrs: newBlock.attrs,
        status: "added",
        tokens: newBlock.segments.map((segment) => ({
          type: "added",
          text: segment.text,
          marks: segment.marks,
        })),
      });
    }
  }

  return { blocks };
}

export function buildResumeDiff(oldContent: ResumeContent, newContent: ResumeContent): ResumeDiff {
  return {
    basics: {
      name: diffResumeField(oldContent.basics.name, newContent.basics.name),
      status: diffResumeField(oldContent.basics.status, newContent.basics.status),
      title: diffResumeField(oldContent.basics.title, newContent.basics.title),
      email: diffResumeField(oldContent.basics.email, newContent.basics.email),
      phone: diffResumeField(oldContent.basics.phone, newContent.basics.phone),
      location: diffResumeField(oldContent.basics.location, newContent.basics.location),
      website: diffResumeField(oldContent.basics.website, newContent.basics.website),
      summary: diffResumeField(oldContent.basics.summary, newContent.basics.summary),
    },
    richText: Object.fromEntries(
      RICH_TEXT_FIELDS.map((field) => [
        field,
        diffTipTapDoc(oldContent[field], newContent[field]),
      ]),
    ),
  };
}

function diffResumeField(oldText: string, newText: string): ResumeFieldDiff {
  const tokens = diffInlineText(oldText, newText);
  return {
    status: statusFromTokens(tokens),
    tokens,
  };
}

function statusFromTokens(tokens: InlineDiffToken[]): ResumeFieldDiff["status"] {
  const hasAdded = tokens.some((token) => token.type === "added");
  const hasRemoved = tokens.some((token) => token.type === "removed");
  if (hasAdded && hasRemoved) return "modified";
  if (hasAdded) return "added";
  if (hasRemoved) return "removed";
  return "unchanged";
}

function tokenizeText(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9]+|[\u4e00-\u9fff]+|\s+|[^\sA-Za-z0-9\u4e00-\u9fff]+/gu) ?? [];
  return tokens.flatMap((token) => (/^[\u4e00-\u9fff]+$/u.test(token) ? Array.from(token) : [token]));
}

function flattenBlocks(doc: TipTapNode) {
  const blocks: Array<{
    type: string;
    attrs?: Record<string, unknown>;
    text: string;
    segments: TextSegment[];
  }> = [];

  for (const child of doc.content ?? []) {
    collectBlocks(child, blocks);
  }
  return blocks;
}

function collectBlocks(
  node: TipTapNode,
  blocks: Array<{ type: string; attrs?: Record<string, unknown>; text: string; segments: TextSegment[] }>,
  parentListType?: "bulletList" | "orderedList",
) {
  if (node.type === "bulletList" || node.type === "orderedList") {
    for (const child of node.content ?? []) collectBlocks(child, blocks, node.type);
    return;
  }
  if (isBlockNode(node)) {
    const segments = collectTextSegments(node);
    const attrs =
      node.type === "listItem" && parentListType
        ? { ...(node.attrs ?? {}), listType: parentListType }
        : node.attrs;
    blocks.push({
      type: node.type ?? "paragraph",
      attrs,
      text: segments.map((segment) => segment.text).join(""),
      segments,
    });
    return;
  }
  for (const child of node.content ?? []) collectBlocks(child, blocks, parentListType);
}

function isBlockNode(node: TipTapNode): boolean {
  return ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "horizontalRule"].includes(node.type ?? "");
}

function collectTextSegments(node: TipTapNode): TextSegment[] {
  if (node.type === "text") {
    return [{ text: node.text ?? "", marks: node.marks ?? [] }];
  }
  return (node.content ?? []).flatMap(collectTextSegments);
}

function shouldInlineDiffBlock(
  oldBlock: { type: string; segments: TextSegment[]; text: string },
  newBlock: { type: string; segments: TextSegment[]; text: string },
) {
  if (oldBlock.type !== newBlock.type) return false;
  if (hasMarks(oldBlock) || hasMarks(newBlock)) return true;
  if (Math.max(oldBlock.text.length, newBlock.text.length) < 6) return false;
  const similarity = tokenSimilarity(tokenizeText(oldBlock.text), tokenizeText(newBlock.text));
  return similarity >= 0.2;
}

function blocksEquivalent(
  oldBlock: { type: string; attrs?: Record<string, unknown>; text: string },
  newBlock: { type: string; attrs?: Record<string, unknown>; text: string },
) {
  return (
    oldBlock.type === newBlock.type &&
    oldBlock.text === newBlock.text &&
    JSON.stringify(oldBlock.attrs ?? {}) === JSON.stringify(newBlock.attrs ?? {})
  );
}

function hasMarks(block: { segments: TextSegment[] }) {
  return block.segments.some((segment) => segment.marks.length > 0);
}

function tokenSimilarity(a: string[], b: string[]) {
  if (a.length === 0 || b.length === 0) return 0;
  const lcs = longestCommonSubsequence(a, b);
  return lcs / Math.max(a.length, b.length);
}

function longestCommonSubsequence(a: string[], b: string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function diffMatchingBlock(
  oldBlock: { type: string; attrs?: Record<string, unknown>; text: string; segments: TextSegment[] },
  newBlock: { type: string; attrs?: Record<string, unknown>; text: string; segments: TextSegment[] },
): DiffBlock {
  if (oldBlock.text === newBlock.text && oldBlock.type === newBlock.type) {
    return {
      type: newBlock.type,
      attrs: newBlock.attrs,
      status: "unchanged",
      tokens: newBlock.segments.map((segment) => ({
        type: "unchanged",
        text: segment.text,
        marks: segment.marks,
      })),
    };
  }

  const plainTokens = diffInlineText(oldBlock.text, newBlock.text);
  return {
    type: newBlock.type,
    attrs: newBlock.attrs,
    status: "modified",
    tokens: plainTokens.map((token) => ({
      ...token,
      marks:
        token.type === "added"
          ? marksAtText(newBlock.segments, token.text)
          : marksAtText(oldBlock.segments, token.text),
    })),
  };
}

function marksAtText(segments: TextSegment[], text: string) {
  const found = segments.find((segment) => segment.text.includes(text) || text.includes(segment.text));
  return found?.marks ?? segments[0]?.marks ?? [];
}

function commonPrefixLength(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffixLength(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[a.length - 1 - index] === b[b.length - 1 - index]) {
    index += 1;
  }
  return index;
}

function keepCommonSuffix(suffix: string) {
  if (!suffix) return false;
  if (/^\s/.test(suffix)) return true;
  if (/[A-Za-z0-9]/.test(suffix)) return suffix.trim().length >= 2;
  return Array.from(suffix.trim()).length >= 2;
}
