# Resume Version Diff And Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build resume version history with structured Diff View plus editor-level undo/redo.

**Architecture:** Persist durable resume snapshots for Agent/restore events in a new `resume_version` table. Keep session-level undo/redo in the editor client as a bounded snapshot stack. Render Diff View as a read-only A4 resume comparison layer that preserves resume sections and TipTap rich-text structure.

**Tech Stack:** Next.js 16 App Router server actions, Drizzle/Postgres, React Hook Form, TipTap JSON, Vitest/Testing Library, existing `diff` package.

---

## File Structure

- `apps/web/db/schema.ts`: add `resumeVersions`.
- `apps/web/db/migrations/0013_add_resume_versions.sql`: migration.
- `apps/web/app/(app)/resume/[id]/edit/actions.ts`: add version list/get/create/restore server actions.
- `apps/web/lib/resume-versions.ts`: pure helpers for metadata formatting and operation count. Not split in this slice; metadata formatting stays in the colocated server action and Chinese popover.
- `apps/web/lib/resume-diff.ts`: pure resume + TipTap diff model.
- `apps/web/hooks/use-resume-history.ts`: client undo/redo snapshot stack.
- `apps/web/components/preview/resume-diff-preview.tsx`: A4 read-only Diff renderer.
- `apps/web/components/editor/version-history-popover.tsx`: Chinese version history popover.
- `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`: wire toolbar, Agent version creation, restore, Diff View, undo/redo controls.
- `apps/web/tests/unit/resume-diff.test.ts`: rich-text/resume diff unit coverage.
- `apps/web/tests/unit/use-resume-history.test.ts`: undo/redo unit coverage.
- `apps/web/tests/unit/resume-version-actions.test.ts`: action/store coverage.
- `apps/web/tests/unit/editor-client-version-history.test.tsx`: editor integration coverage.

## Tasks

### Task 1: Durable Version Model

- [x] Add failing tests proving `resumeVersions` schema exists and migration creates `resume_version`.
- [x] Add Drizzle table with indexes on `(resumeId, createdAt)` and `userId`.
- [x] Add SQL migration `0013_add_resume_versions.sql`.
- [x] Run focused schema/migration tests until green.

### Task 2: Version Server Actions

- [x] Add failing server action tests for list, create, get, restore, unauthorized access, and restore creating a new version.
- [x] Implement actions in `app/(app)/resume/[id]/edit/actions.ts`.
- [x] Validate every content write with `ResumeContent.safeParse`.
- [x] Run focused action tests until green.

### Task 3: Undo/Redo Stack

- [x] Add failing tests for push, undo, redo, branch clearing after new push, capacity 50, and debounced merge.
- [x] Implement `useResumeHistory` with explicit `capture`, `undo`, `redo`, `replaceBaseline`.
- [x] Run focused hook tests until green.

### Task 4: Structured Diff

- [x] Add failing tests for Chinese inline changes, English word changes, added/removed blocks, bold/link mark preservation, list item changes, and resume section changes.
- [x] Implement token diff and TipTap diff model in `lib/resume-diff.ts`.
- [x] Run focused diff tests until green.

### Task 5: Diff Preview UI

- [x] Add component tests for Chinese labels, added/removed classes, read-only toolbar, history active state, restore confirmation, and close behavior.
- [x] Implement `ResumeDiffPreview` and `VersionHistoryPopover`.
- [x] Run focused component tests until green.

### Task 6: Editor Integration

- [x] Add integration tests for toolbar version entry, Agent apply creating a version, restore wiring, undo/redo shortcut behavior, and exiting Diff View.
- [x] Wire actions and components into `editor-client.tsx`.
- [x] Make Agent operation capture discrete history snapshots and create version records after applying.
- [x] Make template switch and restore create discrete undo steps.
- [x] Run focused integration tests until green.

### Task 7: Verification

- [x] Run `pnpm --filter @intro-builder/web test -- tests/unit/resume-diff.test.ts tests/unit/use-resume-history.test.ts tests/unit/resume-version-actions.test.ts tests/unit/editor-client-version-history.test.tsx`.
- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm tsc --noEmit`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.
- [x] Run desktop smoke with `pnpm dev`: verified the editor opens on `http://localhost:52847`, version history empty state, temporary Agent-style version entry, Diff View read-only lock, added/removed diff tokens, close back to editor, and cleanup. Restore confirmation hit an in-app browser CDP timeout; restore + undo restore are covered by `editor-client-version-history.test.tsx`.

## Notes

- Work must stay on a `codex/` branch, not `main`.
- All user-facing strings must be Chinese.
- Diff View is read-only and must not mutate RHF state until restore is confirmed.
- Restore must write a new `source=restore` version row.
- If build fails because external Google Fonts are blocked, capture exact network error and still report other gates separately.
