# v0.5 Editor Onboarding with BYOK Design

**Date:** 2026-07-31
**Status:** Implemented (awaiting review and release)
**Depends on:** `docs/superpowers/specs/2026-07-31-v0.4.2-reactivation-baseline.md`
**PoC verdict:** B "learn by doing" selected; the throwaway prototype was
deleted after its interaction decisions were absorbed here.

## 1. Why This Slice Exists

The editor already supports structured forms, live A4 preview, templates,
layout controls, undo/redo, version history, AI helpers, and a conversational
Agent. A first-time user sees all of that at once and receives no explanation
of how the surfaces relate. The earlier standalone three-step creation PoC was
rejected because it delayed the moment when the user learns the real product.

This slice teaches the existing editor in place. The approved direction is the
non-blocking B variant: a compact mission path stays inside the editor while
the user performs real actions. BYOK configuration is the first mission so the
Agent is ready before the guide introduces it.

## 2. Goals

1. Auto-open a desktop editor onboarding path on a user's first editor visit.
2. Teach six ordered concepts: connect Agent model (BYOK), edit content, live
   preview, layout and recovery controls, AI helpers, and the Agent surface.
3. Reuse the existing model settings dialog and storage contract. Never send a
   model request automatically during onboarding.
4. Keep manual editing available even when BYOK is absent. The user may dismiss
   the guide instead of configuring a provider.
5. Persist completion or dismissal per authenticated user and onboarding
   version, then expose a toolbar action to restart the guide.
6. Highlight whichever Agent entry is active in the deployment: toolbar panel
   mode or floating bubble mode.

## 3. Non-Goals

- No standalone `/resume/new` route and no separate onboarding dashboard.
- No change to resume schema, database schema, autosave, or Agent protocols.
- No provider credential upload to the application database. Base URL and
  model name remain in local storage; the API key remains session-scoped under
  the existing model-settings contract.
- No attempt to route AI polish, section suggestions, or resume diagnosis
  through the conversational Agent BYOK configuration in this slice.
- No mobile editor onboarding; the editor itself remains desktop-only.
- No model connectivity probe beyond the existing optional "获取模型" action.

## 4. User Experience

### 4.1 Entry and persistence

After hydration, the editor checks a versioned, user-scoped local-storage
record. If no `completed` or `dismissed` record exists, the mission path opens.
It does not flash during SSR. Completing or dismissing the path prevents future
automatic opening for that user and version on the same browser.

A toolbar button labelled `新手引导` always reopens the path. Restarting does
not erase the saved outcome; it creates an explicit review session.

### 4.2 Six missions

1. **连接 Agent 模型** — show whether BYOK is configured. When missing, the
   primary action opens the existing model settings dialog. Later mission
   nodes stay disabled until configuration succeeds. `以后再说` dismisses the
   entire guide and leaves the editor usable.
2. **编辑内容** — highlight the form column and explain autosave.
3. **实时预览** — highlight the preview pane and its PDF fidelity.
4. **排版与安全** — highlight the editor toolbar; explain template, layout,
   undo/redo, versions, and saved state.
5. **AI 辅助** — highlight an existing section-level AI entry and explain that
   suggestions/diffs require user choice before writeback.
6. **认识 Agent** — highlight the active Agent entry and explain single-step
   versus cross-section work, confirmation/direct modes, and visible progress.

The path is navigable by mission nodes once BYOK is configured. It does not
simulate editing, send prompts, or mark a mission complete based on hidden
implementation events; the explicit `完成这一步` action advances it.

### 4.3 BYOK states

- **Missing:** status `未连接`; show `配置 BYOK` and `以后再说`. No model call.
- **Configured:** status `已连接`; show base host/model summary without the API
  key and enable `开始认识编辑器`.
- **Dialog saved but incomplete:** remain on the first mission and explain that
  service address, API key, and model name are all required.
- **Session key expired:** the next browser session naturally returns to the
  missing state because the API key is deliberately session-scoped.

## 5. Architecture

- `lib/editor-onboarding-storage.ts` owns the versioned per-user outcome key
  and parsing. Corrupt storage fails open by showing onboarding.
- `components/editor/editor-onboarding.tsx` owns the mission state, BYOK status,
  controlled model settings dialog, persistence, and target highlighting.
- `EditorClient` receives `userId`, mounts the onboarding below the toolbar,
  adjusts the editor viewport height only while it is open, and exposes the
  restart action.
- Existing editor and Agent controls receive stable
  `data-editor-onboarding-target` attributes. The guide queries only this
  documented UI seam and removes highlight classes on every transition and
  unmount.
- The model settings dialog remains the single credential entry. The guide
  consumes `isAgentModelConfigured` and never duplicates provider validation.

## 6. Visual Direction

The mission path uses the editor's current neutral surfaces and primary blue.
Numbered knots encode a real ordered sequence; emerald marks completed nodes;
the existing fuchsia treatment remains reserved for AI helper controls. The
distinctive element is the focus path, not another floating card or modal.

The bar stays compact, supports dark mode, exposes keyboard focus, and respects
reduced-motion preferences. At narrower desktop widths, explanatory copy may
collapse before mission labels or actions become unusable.

## 7. Risks and Mitigations

- **Session-scoped key makes BYOK look lost:** this is intentional security
  behavior; the first mission clearly says the key lasts for the browser
  session and provides a fast re-entry path.
- **Guide obscures editor space:** use a fixed-height inline strip and subtract
  the same height from the editor viewport; no overlay or modal outside BYOK.
- **AI target absent for an empty section:** target the section-level AI helper,
  which renders even before an item exists; the guide does not require a rich
  text item.
- **Agent surface varies by deployment:** both panel toggle and floating bubble
  implement the same target attribute, while only one is rendered.
- **Local storage shared across resumes:** this is desired; onboarding belongs
  to the user, not a document. Including user ID prevents cross-account bleed.

## 8. Acceptance Criteria

- A first editor visit opens at `连接 Agent 模型` for a user with no outcome.
- Missing BYOK prevents advancing within the guide but never blocks editing or
  dismissing the guide.
- Saving a complete existing model configuration enables all later missions.
- Completion and dismissal stop automatic reopening for the same user/version.
- A toolbar action reopens the guide after either outcome.
- Every mission points at a real existing editor control/surface.
- No onboarding action sends a model request or exposes the stored API key.
- Focused tests, full repository gates, and a desktop manual smoke pass.
