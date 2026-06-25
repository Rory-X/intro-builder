import { describe, expect, it } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";
import type { TipTapJSON } from "@intro-builder/shared/types";

import {
  buildResumeDiff,
  diffInlineText,
  diffTipTapDoc,
} from "@/lib/resume-diff";

function doc(content: TipTapJSON["content"]): TipTapJSON {
  return { type: "doc", content };
}

describe("resume diff", () => {
  it("splits Chinese sentence edits into removed and added phrases", () => {
    expect(diffInlineText("AI 作为副驾驶", "AI 是创作伙伴")).toEqual([
      { type: "unchanged", text: "AI " },
      { type: "removed", text: "作为副驾驶" },
      { type: "added", text: "是创作伙伴" },
    ]);
  });

  it("keeps English word changes narrow instead of replacing the whole sentence", () => {
    expect(diffInlineText("Built workflow for product analytics", "Built workflow for growth analytics")).toEqual([
      { type: "unchanged", text: "Built workflow for " },
      { type: "removed", text: "product" },
      { type: "added", text: "growth" },
      { type: "unchanged", text: " analytics" },
    ]);
  });

  it("preserves TipTap marks and link attrs on inline diff tokens", () => {
    const oldDoc = doc([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "查看项目",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      },
    ]);
    const newDoc = doc([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "查看线上案例",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "https://example.com" } },
            ],
          },
        ],
      },
    ]);

    const diff = diffTipTapDoc(oldDoc, newDoc);

    expect(diff.blocks[0].status).toBe("modified");
    expect(diff.blocks[0].tokens).toEqual([
      {
        type: "unchanged",
        text: "查看",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
      {
        type: "removed",
        text: "项目",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
      {
        type: "added",
        text: "线上案例",
        marks: [
          { type: "bold" },
          { type: "link", attrs: { href: "https://example.com" } },
        ],
      },
    ]);
  });

  it("marks added and removed list items as block-level changes", () => {
    const oldDoc = doc([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "旧项目" }] }] },
        ],
      },
    ]);
    const newDoc = doc([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "新项目" }] }] },
        ],
      },
    ]);

    const diff = diffTipTapDoc(oldDoc, newDoc);

    expect(diff.blocks.map((block) => block.status)).toEqual(["removed", "added"]);
    expect(diff.blocks[0].tokens).toEqual([{ type: "removed", text: "旧项目", marks: [] }]);
    expect(diff.blocks[1].tokens).toEqual([{ type: "added", text: "新项目", marks: [] }]);
  });

  it("keeps unchanged dividers as structural rich-text blocks", () => {
    const oldDoc = doc([{ type: "horizontalRule" }]);
    const newDoc = doc([{ type: "horizontalRule" }]);

    const diff = diffTipTapDoc(oldDoc, newDoc);

    expect(diff.blocks).toEqual([
      {
        attrs: undefined,
        type: "horizontalRule",
        status: "unchanged",
        tokens: [],
      },
    ]);
  });

  it("builds resume-level section diffs for basics and rich-text sections", () => {
    const oldContent = emptyResumeContent();
    oldContent.basics.title = "产品助理";
    oldContent.summary = doc([
      { type: "paragraph", content: [{ type: "text", text: "执行力强" }] },
    ]);
    const newContent = emptyResumeContent();
    newContent.basics.title = "增长产品经理";
    newContent.summary = doc([
      { type: "paragraph", content: [{ type: "text", text: "推动实验提升转化" }] },
    ]);

    const diff = buildResumeDiff(oldContent, newContent);

    expect(diff.basics.title.status).toBe("modified");
    expect(diff.basics.title.tokens).toContainEqual({ type: "removed", text: "产品助理" });
    expect(diff.basics.title.tokens).toContainEqual({ type: "added", text: "增长产品经理" });
    expect(diff.richText.summary.blocks.map((block) => block.status)).toEqual([
      "removed",
      "added",
    ]);
  });
});
