# Rich Text Polish TipTap Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return and apply deterministic TipTap replacements for rich-text polish requests instead of relying only on plain-text remapping.

**Architecture:** The Agent asks the model for block-aligned `polishedBlocks`, then code clones the original TipTap document and replaces paragraph text in order. The Web BFF forwards the richer result, and `RichTextEditor` applies `replacementTiptapJson` when present while retaining the existing plain-text fallback.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client component, TipTap JSON, Vitest.

---

## File Structure

- `apps/agent/src/rich-text-polish.ts`: extend provider parsing, prompt schema, and deterministic TipTap replacement conversion.
- `apps/agent/tests/rich-text-polish.test.ts`: add red-green coverage for `polishedBlocks` and `replacementTiptapJson`.
- `lib/agent/client.ts`: widen the Web client response type to include `format: "tiptap_json"` and optional replacement JSON.
- `app/api/agent/rich-text/polish/route.ts`: keep validation and forward the richer Agent result unchanged.
- `tests/unit/agent-client.test.ts`: prove the client accepts the richer response.
- `tests/unit/agent-rich-text-polish-route.test.ts`: prove the BFF returns the richer result.
- `components/editor/rich-text-editor.tsx`: apply `replacementTiptapJson` before falling back to plain text.
- `tests/unit/rich-text-editor.test.tsx`: prove structured replacements are applied directly.
- `docs/agent/service-contracts.md`: document the richer response shape.

## Tasks

### Task 1: Agent Contract And Converter

- [x] Add failing tests in `apps/agent/tests/rich-text-polish.test.ts` for a TipTap request whose provider returns `polishedBlocks`, expecting `format: "tiptap_json"` and a `replacementTiptapJson` that preserves list nodes and marks.
- [x] Run `pnpm --filter @intro-builder/agent test rich-text-polish.test.ts` and confirm the new test fails because the response still returns `plain_text`.
- [x] Update `apps/agent/src/rich-text-polish.ts` to request `polishedBlocks`, parse it, validate block count when possible, and build the replacement TipTap JSON.
- [x] Re-run `pnpm --filter @intro-builder/agent test rich-text-polish.test.ts` and confirm the test passes.

### Task 2: Web Types And BFF Forwarding

- [x] Add failing tests in `tests/unit/agent-client.test.ts` and `tests/unit/agent-rich-text-polish-route.test.ts` for `format: "tiptap_json"` with `replacementTiptapJson`.
- [x] Run `pnpm tsc --noEmit` and confirm the new tests fail on the current narrow type. Note: `pnpm test tests/unit/...` passes args through to the agent workspace and is not a valid targeted Web-only command in this repo.
- [x] Update `lib/agent/client.ts` response types so Web code can represent both `plain_text` and `tiptap_json` polish results.
- [x] Keep `app/api/agent/rich-text/polish/route.ts` forwarding `result.data.result` unchanged unless TypeScript requires a narrow adjustment.
- [x] Re-run the two Web tests with `pnpm exec vitest run tests/unit/agent-client.test.ts tests/unit/agent-rich-text-polish-route.test.ts` and confirm they pass.

### Task 3: Editor Apply Path

- [x] Add a failing test in `tests/unit/rich-text-editor.test.tsx` where the API returns `replacementTiptapJson`; applying the suggestion must use that JSON directly and preserve nested list structure and bold labels.
- [x] Run `pnpm exec vitest run tests/unit/rich-text-editor.test.tsx` and confirm the new test fails because the editor ignores `replacementTiptapJson`.
- [x] Update `components/editor/rich-text-editor.tsx` so `PolishCandidate` accepts `replacementTiptapJson` and `applyPolishCandidate` prefers it.
- [x] Re-run the editor test and confirm it passes.

### Task 4: Docs And Full Verification

- [x] Update `docs/agent/service-contracts.md` with the `tiptap_json` response example and compatibility note.
- [x] Run `pnpm test`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [x] Update this plan with execution notes and any verification blockers.

## Execution Notes

- Agent red test failed on missing `polishedBlocks` prompt contract and missing `polishRichText` structured conversion helper; green run passed with 7 tests.
- Web targeted runtime tests passed after adding `tiptap_json` fixtures. Type red/green was captured with `pnpm tsc --noEmit`.
- Editor red test proved the old path wrote fallback plain text into the first bold text node; green run uses `replacementTiptapJson` directly.
- Full verification on 2026-06-08: `pnpm test` passed with Web 58 files / 298 tests and Agent 6 files / 42 tests; `pnpm tsc --noEmit` passed; `pnpm lint` passed with 10 existing warnings.
- `pnpm build` is blocked in this worktree because Next 16/Turbopack cannot fetch Google Fonts from `fonts.googleapis.com` / `fonts.gstatic.com`; direct `curl -I` to both domains fails with `Recv failure: Connection reset by peer`. This is unrelated to the rich-text polish conversion changes and originates from `app/layout.tsx` using `next/font/google`.

## Risks

- Strict block-count validation can make model failures visible. The implementation should prefer exact `polishedBlocks` for structured output and keep plain-text fallback for compatibility, but it should not silently accept malformed replacement JSON from the model.
- The converter must preserve existing marks and attrs without introducing a new TipTap dependency in the Agent package.
