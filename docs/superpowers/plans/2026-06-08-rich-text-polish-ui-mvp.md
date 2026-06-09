# Rich Text Polish UI MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first Web editor UI for Phase 1 rich-text polish, letting users request a conservative AI rewrite and explicitly apply it back to the focused rich-text field.

**Architecture:** Reuse the existing shared `RichTextEditor` toolbar so every supported rich-text field can opt into the same button and candidate preview. Section editors pass `resumeId`, `section`, and `fieldPath` into `RichTextEditor`; the editor calls the existing Web BFF `POST /api/agent/rich-text/polish`, then converts returned `plain_text` into a simple TipTap document only after the user clicks apply.

**Tech Stack:** Next.js 16 App Router client components, React 19, TipTap v3, React Hook Form, Vitest + Testing Library.

---

## Scope

In scope:
- Show an "AI 润色" toolbar button only for rich-text editors with polish context.
- Send `resumeId`, `section`, `fieldPath`, `locale`, `content`, and `intent` to the existing Web BFF.
- Show a local candidate panel with result text, change summary, risk flags, apply, and dismiss actions.
- Apply only after user confirmation.
- Wire the button into experience, projects, education, research, skills, and custom rich-text fields.

Out of scope:
- No assistant-ui chat panel.
- No streaming/SSE.
- No automatic write-back without user confirmation.
- No model-generated TipTap JSON.
- No OCR/import resume/AI parsing migration.

## Tasks

- [x] Task 1: Add failing `RichTextEditor` tests for polish request and explicit apply.
- [x] Task 2: Implement optional polish toolbar state and BFF call.
- [x] Task 3: Wire polish context from section editors and `EditorClient`.
- [x] Task 4: Run targeted tests and full verification gates.

## Validation Commands

- `pnpm test tests/unit/rich-text-editor.test.tsx`
- `pnpm test`
- `pnpm tsc --noEmit`
- `pnpm lint`
- `pnpm build`
- `pnpm verify`

## Execution Notes

- The UI intentionally calls the Web BFF, not the Agent service directly.
- The first response shape is `plain_text`; applying the candidate creates a simple paragraph-based TipTap document.
- The button is hidden unless the section editor supplies a polish context, so existing non-resume uses of `RichTextEditor` stay unchanged.
