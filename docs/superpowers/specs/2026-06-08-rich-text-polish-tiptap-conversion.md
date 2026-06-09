# Rich Text Polish TipTap Conversion Spec

## Background

The rich text polish request already sends `content.format: "tiptap_json"` and the current TipTap document to the Agent service. The response contract, however, still returns only `format: "plain_text"` with a single `polishedText` string. The editor then guesses how to map that plain text back into the existing TipTap tree.

That guess works only when the model happens to keep one text block per line. If the model returns paragraphs, extra blank lines, or merged sentences, the editor can only apply a weak best-effort mapping. Users experience this as "the text barely changed" or as unreliable rich-text preservation.

## Goal

When the input is TipTap rich text, the polish response should carry a deterministic TipTap replacement built from the original document structure and model-polished text blocks.

## Requirements

- Keep the existing explicit user confirmation flow: polish suggestions are shown first and applied only when the user clicks "应用润色".
- For `content.format: "tiptap_json"`, ask the model for block-aligned polished text rather than free-form paragraph text.
- Do not let the model generate arbitrary TipTap JSON. Code must clone the original TipTap JSON and replace text inside paragraph blocks.
- Preserve original list hierarchy, paragraph attrs, text marks, font size marks, color marks, and alignment attrs where possible.
- Return a structured replacement as `replacementTiptapJson` and let the editor apply it directly.
- Keep backward compatibility for older `plain_text` responses by retaining the existing editor fallback.
- Do not change resume schema, database schema, autosave semantics, or PDF rendering.

## Non-Goals

- No streaming polish UI.
- No automatic write-back without confirmation.
- No model-authored TipTap node trees.
- No broader resume rewriting or whole-document Agent panel.

## Design

The Agent prompt adds a `polishedBlocks` array requirement when the request contains TipTap JSON. Each entry corresponds to one non-empty paragraph text block collected from the original document. The provider response parser accepts this optional array and validates the existing `polishedText`, `changeSummary`, and `riskFlags` fields as before.

After parsing, the Agent builds `replacementTiptapJson` by deep-cloning `request.content.tiptapJson`, walking paragraph nodes in the same order, and replacing inline text content for each paragraph with the matching polished block. The conversion preserves the first text node's marks by default and keeps label-style prefixes such as `项目描述：` bold when the original block used marks on that prefix.

The Web BFF forwards the richer response shape unchanged. The editor candidate type accepts `replacementTiptapJson`; applying a candidate uses it first and falls back to the existing `plain_text` mapping only when the structured replacement is absent.

## Acceptance Criteria

- Agent unit tests prove a TipTap request can return `format: "tiptap_json"` with `replacementTiptapJson`.
- Editor unit tests prove applying a candidate with `replacementTiptapJson` preserves list structure and marks without using the plain-text heuristic.
- Existing plain-text polish behavior remains supported.
- Local verification runs the project DoD commands or reports exact blockers.
