import type { Editor } from "@tiptap/react";
import { DEFAULT_RICH_TEXT_FONT_SIZE } from "@/lib/rich-text-prose";

/**
 * Find the first text-node fontSize mark already in the document, so the
 * toolbar can show what was previously saved even when the cursor sits
 * before any actual text (e.g. right after the editor mounts).
 */
export function getActiveRichTextFontSize(editor: Editor): string {
  const cursorFontSize = editor.getAttributes("textStyle").fontSize;
  if (typeof cursorFontSize === "string" && cursorFontSize) return cursorFontSize;

  let documentFontSize: string | undefined;
  editor.state.doc.descendants((node) => {
    if (documentFontSize || !node.isText) return false;
    const textStyle = node.marks.find((mark) => mark.type.name === "textStyle");
    const fontSize = textStyle?.attrs.fontSize;
    if (typeof fontSize === "string" && fontSize) {
      documentFontSize = fontSize;
      return false;
    }
    return true;
  });

  return documentFontSize ?? DEFAULT_RICH_TEXT_FONT_SIZE;
}

/**
 * Apply a fontSize to the active selection. When the user has no selection
 * (just a cursor) we temporarily select everything so the mark actually
 * lands in the JSON instead of being stored only as a pending mark for the
 * next keystroke. After applying, the original cursor position is restored
 * so subsequent toolbar clicks (alignment, list, etc.) don't accidentally
 * act on the whole document.
 */
export function applyRichTextFontSize(editor: Editor, size: string) {
  const previousSelection = editor.state.selection;
  const hadEmptySelection = previousSelection.empty;

  const chain = editor.chain().focus();
  const target = hadEmptySelection ? chain.selectAll() : chain;

  if (size === DEFAULT_RICH_TEXT_FONT_SIZE) {
    target.unsetFontSize().run();
  } else {
    target.setFontSize(size).run();
  }

  if (hadEmptySelection) {
    // Use the bare command (no `chain().focus()`) so we don't trigger an
    // editor scroll-into-view, which both shifts the page on real usage and
    // crashes jsdom in tests because ProseMirror calls `getClientRects()`.
    editor.commands.setTextSelection({
      from: previousSelection.from,
      to: previousSelection.to,
    });
  }
}
