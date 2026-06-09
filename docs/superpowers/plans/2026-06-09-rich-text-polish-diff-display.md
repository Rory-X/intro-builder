# Rich Text Polish Diff Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show AI rich-text polish suggestions as compact single-line text diffs before users apply them.

**Architecture:** Keep all changes inside `components/editor/rich-text-editor.tsx` and its unit test. Capture original plain text and original TipTap JSON at request time, store them on the candidate, compare structured replacement text blocks when available, and render single-line contextual diff rows without changing the existing apply path.

**Tech Stack:** React 19 client component, TipTap editor text extraction, Vitest + Testing Library.

---

## File Structure

- `components/editor/rich-text-editor.tsx`: store original text/TipTap JSON in `PolishCandidate`, add `PolishDiffView`, and add small dependency-free diff/display helpers.
- `tests/unit/rich-text-editor.test.tsx`: add coverage for delete/insert diff rendering, single-line contextual rows, and whitespace-only fragment filtering.

## Tasks

### Task 1: Diff Candidate Test

- [x] Add a failing test in `tests/unit/rich-text-editor.test.tsx` where original text is "负责系统开发，优化页面速度。" and `polishedText` is "负责核心业务系统前端开发，持续优化页面性能。".
- [x] Assert that the suggestion panel renders deleted text with `data-diff-kind="delete"` and inserted text with `data-diff-kind="insert"`.
- [x] Run `pnpm exec vitest run tests/unit/rich-text-editor.test.tsx` and confirm the new test fails because the panel currently renders plain text only.

### Task 2: Inline Diff Implementation

- [x] Update `components/editor/rich-text-editor.tsx` so `requestPolish` captures the original plain text and stores it on the ready candidate.
- [x] Add a `createInlineDiffParts(original, polished)` helper that tokenizes text and computes `equal`, `delete`, and `insert` runs.
- [x] Render the diff in `PolishCandidatePanel` with compact red/green spans.
- [x] Re-run `pnpm exec vitest run tests/unit/rich-text-editor.test.tsx` and confirm it passes.

### Task 2.5: Visual Noise Reduction

- [x] Replace full-text diff rendering with compact delete/insert chips.
- [x] Filter whitespace-only and punctuation-only diff fragments.
- [x] Add a regression test proving whitespace-only diff fragments are not rendered.
- [x] Use a neutral, height-limited suggestion panel background so long rich-text fields do not dominate the editor.

### Task 2.6: Single-Line Text Diff Rows

- [x] Store the original TipTap JSON on the polish candidate.
- [x] Prefer block-by-block diffs when `replacementTiptapJson` is available.
- [x] Render each changed block as a single-line contextual text diff row.
- [x] Add a regression test proving a row includes surrounding text plus delete/insert spans.

### Task 2.7: Long Row Wrapping

- [x] Remove `whitespace-nowrap` / ellipsis from diff rows.
- [x] Allow long rows and highlighted spans to wrap with `overflow-wrap:anywhere`.
- [x] Add a regression test proving long diff rows carry wrapping classes.

### Task 3: Verification And PR Update

- [x] Run `pnpm test`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build` or record the known Google Fonts network blocker if it recurs.
- [x] Commit and push to the PR branch.

## Verification

- `pnpm exec vitest run tests/unit/rich-text-editor.test.tsx`: 13 tests passed.
- `pnpm test`: 68 app test files / 328 tests passed; 9 agent test files / 63 tests passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm lint`: passed with 10 existing warnings outside this change.
- `pnpm build`: passed. Build logged the expected local placeholder `DATABASE_URL` warnings while prerendering template pages.

## Risks

- A character-level diff can be noisy for Chinese text. The panel now scopes diffs to changed text blocks and trims long equal context so users can see where the change happened without rendering the whole field. Very long changed text wraps inside the panel instead of preserving strict visual single-line layout.
- The diff is display-only. The apply path must continue using `replacementTiptapJson` or the existing plain-text fallback.
