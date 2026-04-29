import { z } from "zod";

export const TipTapJSON = z.object({
  type: z.literal("doc"),
  content: z.array(z.any()).default([]),
}).passthrough();

export type TipTapJSON = z.infer<typeof TipTapJSON>;

/** Create an empty TipTap doc */
export function emptyDoc(): TipTapJSON {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** Convert a string[] (v1 bullets) into a TipTap bulleted-list doc */
export function bulletsToDoc(bullets: string[]): TipTapJSON {
  if (bullets.length === 0) return emptyDoc();
  return {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: bullets.map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
        })),
      },
    ],
  };
}
