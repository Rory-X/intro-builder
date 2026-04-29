import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";

export const tiptapExtensions = [
  StarterKit.configure({
    heading: false,
    codeBlock: false,
    blockquote: false,
    horizontalRule: false,
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
];
