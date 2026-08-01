# v0.5 Editor Onboarding with BYOK Implementation Plan

**Spec:** `docs/superpowers/specs/2026-07-31-editor-onboarding-byok.md`
**Goal:** Teach the real editor through a non-blocking six-mission path that
connects Agent BYOK before introducing AI and Agent capabilities.
**Architecture:** A user-scoped local-storage outcome plus a controlled editor
onboarding component reuses the existing model settings dialog and highlights
stable target attributes without changing resume or Agent protocols.

## File Structure

- ADD: `apps/web/lib/editor-onboarding-storage.ts`
- ADD: `apps/web/components/editor/editor-onboarding.tsx`
- ADD: `apps/web/tests/unit/editor-onboarding.test.tsx`
- MOD: `apps/web/app/(app)/resume/[id]/edit/page.tsx`
- MOD: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`
- MOD: `apps/web/components/agent/section-helper-button.tsx`
- MOD: `apps/web/components/agent/agent-mode-toggle.tsx`
- MOD: `apps/web/components/agent/agent-bubble.tsx`
- MOD: `apps/web/app/globals.css`
- MOD: `AGENTS.md`
- MOD: `docs/superpowers/README.md`
- DEL: `docs/superpowers/pocs/2026-07-31-editor-onboarding-poc.html` after
  production behavior absorbs the approved decision.

## Tasks

### Task 1: Specify storage and first-visit behavior

- [x] Add a failing public-behavior test: a user with no outcome sees the BYOK
      mission on first desktop editor render.
- [x] Add the versioned per-user outcome parser/writer and minimal onboarding
      shell required to make the test green.
- [x] Prove corrupt or another user's storage does not suppress onboarding.

### Task 2: Implement the BYOK gate

- [x] Add a failing test that later missions are unavailable before model
      settings are complete and the existing settings dialog opens from the
      first mission.
- [x] Reuse `ModelSettingsDialog`; after a complete save, show `已连接` and
      enable progression without sending a request.
- [x] Add the incomplete-save behavior and focused tests.

### Task 3: Build the six-mission path

- [x] Add one failing interaction test for advancing through real mission
      labels and observing the active target.
- [x] Implement the responsive focus path, active copy, explicit next/back
      actions, dark mode, keyboard focus, and reduced-motion styling.
- [x] Add stable target attributes for editor, preview, toolbar, section AI,
      panel Agent, and floating Agent surfaces.

### Task 4: Persist outcomes and restart

- [x] Add failing tests for `以后再说`, `完成上手`, and the toolbar restart
      action using two distinct user IDs.
- [x] Persist `dismissed`/`completed` per user and onboarding version.
- [x] Add the `新手引导` toolbar action and reopen semantics.

### Task 5: Integrate and clean up

- [x] Pass authenticated `userId` into `EditorClient` and update its test
      fixtures.
- [x] Subtract the onboarding strip height from editor/diff viewport only while
      open; preserve all existing toolbar, autosave, preview, and Agent tests.
- [x] Delete the throwaway PoC after the production component matches the
      approved B direction and record the verdict in this plan.

PoC verdict: B "learn by doing" was selected, with BYOK added as mission 1.
The throwaway prototype was deleted after the production component absorbed
the focus path, inline editor placement, and Agent/AI target behavior.

### Task 6: Verify the release slice

- [x] Run the focused onboarding/model-settings/editor tests after every TDD
      cycle.
- [x] Run `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, and `pnpm build`.
- [x] Run a desktop manual smoke for first visit, BYOK configuration, dismiss,
      completion, restart, AI target, and both available Agent target variants.
- [x] Update this plan with exact verification output and any scope changes.

Manual smoke used the panel Agent surface; focused component tests verify the
same target contract on the floating Agent bubble. No model request was sent.
The temporary fake BYOK settings used during the smoke were cleared through the
application UI before shutting down the dev servers.

## Verification Results

Verified on 2026-08-01 from branch `codex/v0.5-editor-onboarding`:

| Gate | Result |
|---|---|
| Focused onboarding/editor/Agent tests | Passed: 5 files, 32 tests |
| `pnpm test` | Passed: Web 642 passed / 1 skipped; Agent 175 passed; PartyKit 11 passed |
| `pnpm typecheck` | Passed |
| `pnpm tsc --noEmit` | Passed |
| `pnpm lint` | Passed: 0 errors, 12 existing warnings |
| `pnpm build` | Passed for Agent, PartyKit, and Next.js |
| Desktop manual smoke | Passed: BYOK gate, unlock, all real targets, complete, restart, no console errors |
| `git diff --check` and conflict-marker scan | Passed |

Implementation discovery: `ModelSettingsDialog` deliberately permits saving an
incomplete draft. The onboarding layer therefore reuses the canonical
`isAgentModelConfigured` check, keeps later missions locked, and explains which
three values are required instead of forking the settings form.

## Definition of Done

- [x] The six missions and BYOK-first behavior meet the spec.
- [x] No automatic model request occurs during onboarding.
- [x] Outcomes are isolated by user and onboarding version.
- [x] Existing editor and Agent behavior remains green.
- [x] The throwaway PoC is removed and `.codebuddy/` remains untouched.
- [x] Full local verification gates pass.
