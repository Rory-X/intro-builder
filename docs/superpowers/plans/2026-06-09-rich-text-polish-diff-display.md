# Rich Text Polish Diff Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show AI rich-text polish suggestions as a compact inline diff before users apply them.

**Architecture:** Keep all changes inside `components/editor/rich-text-editor.tsx` and its unit test. Capture original plain text at request time, store it on the candidate, compute a small token-level diff in the panel, and render delete/insert spans without changing the existing apply path.

**Tech Stack:** React 19 client component, TipTap editor text extraction, Vitest + Testing Library.

---

## File Structure

- `components/editor/rich-text-editor.tsx`: store original text in `PolishCandidate`, add `PolishDiffView`, and add a small dependency-free diff helper.
- `tests/unit/rich-text-editor.test.tsx`: add coverage for delete/insert diff rendering.

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

### Task 3: Verification And PR Update

- [x] Run `pnpm test`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build` or record the known Google Fonts network blocker if it recurs.
- [x] Commit and push to the existing PR branch.

## Verification

- `pnpm exec vitest run tests/unit/rich-text-editor.test.tsx`: 10 tests passed.
- `pnpm test`: 58 app test files / 299 tests passed; 6 agent test files / 42 tests passed.
- `pnpm tsc --noEmit`: passed.
- `pnpm lint`: passed with 10 existing warnings outside this change.
- `pnpm build`: passed. Build logged the expected local placeholder `DATABASE_URL` warnings while prerendering template pages.

## Risks

- A character-level diff can be noisy for Chinese text. Tokenizing by whitespace/non-whitespace chunks and using LCS keeps the implementation small, but may highlight larger phrase chunks. This is acceptable for the first compact panel.
- The diff is display-only. The apply path must continue using `replacementTiptapJson` or the existing plain-text fallback.
