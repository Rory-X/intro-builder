import { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import {
  applyRichTextFontSize,
  getActiveRichTextFontSize,
} from "@/lib/rich-text-font-size";
import { tiptapExtensions } from "@/lib/tiptap-extensions";

function makeEditor(content: object) {
  return new Editor({ extensions: tiptapExtensions, content });
}

describe("rich text fontSize helpers", () => {
  it("writes a fontSize mark to every text node when no selection is active", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "World" }] },
      ],
    });

    applyRichTextFontSize(editor, "0.92em");

    const json = JSON.stringify(editor.getJSON());
    expect(json.match(/"fontSize":"0.92em"/g)).toHaveLength(2);
    editor.destroy();
  });

  it("writes a fontSize mark into nested list text", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "项目描述" }],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: "登录请求" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    applyRichTextFontSize(editor, "1.23em");

    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('"text":"项目描述"');
    expect(json).toContain('"text":"登录请求"');
    expect(json.match(/"fontSize":"1.23em"/g)).toHaveLength(2);
    editor.destroy();
  });

  it("clears the mark for the default size (1em)", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Hello",
              marks: [{ type: "textStyle", attrs: { fontSize: "0.92em" } }],
            },
          ],
        },
      ],
    });

    applyRichTextFontSize(editor, "1em");

    expect(JSON.stringify(editor.getJSON())).not.toContain("fontSize");
    editor.destroy();
  });

  it("reads the document fontSize when the cursor sits at the start after reload", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Hello",
              marks: [{ type: "textStyle", attrs: { fontSize: "0.92em" } }],
            },
          ],
        },
      ],
    });

    expect(getActiveRichTextFontSize(editor)).toBe("0.92em");
    editor.destroy();
  });

  it("falls back to the default fontSize when no mark is present", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    });

    expect(getActiveRichTextFontSize(editor)).toBe("1em");
    editor.destroy();
  });

  it("restores the original cursor position after applying a size", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        { type: "paragraph", content: [{ type: "text", text: "World" }] },
      ],
    });

    editor.commands.setTextSelection(3);
    const before = editor.state.selection;
    expect(before.empty).toBe(true);

    applyRichTextFontSize(editor, "0.92em");

    const after = editor.state.selection;
    expect(after.empty).toBe(true);
    expect(after.from).toBe(before.from);
    editor.destroy();
  });
});
