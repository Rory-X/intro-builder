import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";

export const tiptapExtensions = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
    link: false,
    underline: false,
  }),
  Link.configure({ openOnClick: false }),
  Underline,
  // Keep fontSize enabled so the rich-text toolbar can write a textStyle mark
  // with `fontSize: "<n>px"` into the saved JSON. Other styling extensions
  // (fontFamily/lineHeight/background) stay off because they're controlled by
  // the global style settings.
  TextStyleKit.configure({
    fontFamily: false,
    lineHeight: false,
    backgroundColor: false,
  }),
  TextAlign.configure({
    types: ["paragraph", "listItem"],
  }),
];

/**
 * Create TipTap extensions for collaborative mode.
 * Disables built-in undo/redo (Y.js has its own undo manager).
 */
export function createCollabExtensions(ydoc: import("yjs").Doc, provider: unknown, user: { name: string; color: string }) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      link: false,
      underline: false,
      undoRedo: false, // Y.js handles undo/redo in collab mode
    }),
    Link.configure({ openOnClick: false }),
    Underline,
    TextStyleKit.configure({
      fontFamily: false,
      lineHeight: false,
      backgroundColor: false,
    }),
    TextAlign.configure({
      types: ["paragraph", "listItem"],
    }),
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider,
      user,
    }),
  ];
}
