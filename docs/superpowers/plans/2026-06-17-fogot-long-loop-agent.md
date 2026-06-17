# Fogot-Inspired Long Loop Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete every phase in `docs/agent/fogot-inspired-long-loop-agent.md` so Agent Mode behaves like an observable, resume-domain long-loop agent with safe human-in-the-loop writes.

**Architecture:** Keep Web as the product-state authority and Agent as the reasoning/tool-loop authority. The Agent mutates only `DraftState`, streams step-level AG-UI events and workspace deltas, and returns `ResumeOperation` objects that Web applies through the existing allowlisted dispatcher.

**Tech Stack:** Next.js 16 Route Handlers, React 19, assistant-ui, AG-UI, AI SDK v6 `streamText` tools, Vitest, TypeScript, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-17-fogot-long-loop-agent-design.md`

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/agent/README.md` | Current route summary and phase status |
| `docs/agent/architecture.md` | Control plane + direct data plane architecture |
| `docs/agent/service-contracts.md` | `/api/agent/direct-runs` and `/v1/agent/chat` contracts |
| `packages/shared/src/types/agent.ts` | Shared visible/internal tool names and operation contract |
| `apps/agent/src/agent-tools.ts` | Agent-side tool validation and tool taxonomy |
| `apps/agent/src/workflows/tools.ts` | Resume-domain tool implementations |
| `apps/agent/src/workflows/draft.ts` | Draft sandbox, pending ask, checkpoint serialization |
| `apps/agent/src/workflows/loop-runtime.ts` | Configurable long loop, hard ask interrupt, step summary |
| `apps/agent/src/workflows/resume-workspace.ts` | Workspace snapshots and quality report surface |
| `apps/agent/src/http.ts` | AG-UI stream event timing, step deltas, telemetry logging |
| `apps/agent/src/config.ts` | Environment-driven loop step defaults |
| `apps/web/lib/agent/ag-ui-stream.ts` | Client-side AG-UI event extraction and tool validation |
| `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx` | Auto-apply guard and interrupt extraction |
| `apps/web/components/agent/agent-panel.tsx` | Tool timeline and safe apply behavior |
| `apps/web/components/agent/agent-tool-card.tsx` | Resume-domain tool labels and statuses |
| `apps/web/tests/unit/*` | Web contract/runtime tests |
| `apps/agent/src/**/*.test.ts` | Agent loop/tool/session tests |

---

## Task 1: Phase 0 Contract Alignment

**Files:**
- Modify: `docs/agent/README.md`
- Modify: `docs/agent/architecture.md`
- Modify: `docs/agent/service-contracts.md`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `apps/agent/src/agent-tools.ts`
- Modify: `apps/web/lib/agent/ag-ui-stream.ts`
- Test: `apps/web/tests/unit/agent-ag-ui-stream.test.ts`

- [x] Add failing Web tests proving `extractAgUiResumeToolResult()` accepts every real loop tool (`resume_polish_text`, `resume_set_text`, `resume_ask`, `set_goal`, `get_completeness`) and future diagnostic tools.
- [x] Run `pnpm --filter @intro-builder/web test -- agent-ag-ui-stream` and confirm the new tests fail because tool names are rejected.
- [x] Expand shared and Agent-side tool taxonomies into internal loop tools and visible operation tools while keeping `ResumeOperation` unchanged.
- [x] Update Web AG-UI extraction to accept the same tool taxonomy.
- [x] Update docs to make `/api/agent/direct-runs` + `/v1/agent/chat` the current route path, and mark `/api/agent/messages` plus non-SSE JSON provider parsing as legacy/debug.
- [x] Re-run the focused Web tests and confirm they pass.

## Task 2: Phase 1 True Loop Policy And Telemetry

**Files:**
- Modify: `apps/agent/src/config.ts`
- Modify: `apps/agent/src/workflows/loop-runtime.ts`
- Modify: `apps/agent/src/http.ts`
- Test: `apps/agent/src/workflows/loop-runtime.test.ts`

- [x] Add failing Agent tests for workflow-specific max steps and loop summary fields (`maxSteps`, `actualSteps`, `toolCallCount`, `questionCount`, `reachedStepLimit`).
- [x] Run `pnpm --filter @intro-builder/agent test -- loop-runtime` and confirm failure.
- [x] Replace hard-coded `LOOP_MAX_STEPS` default usage with `AGENT_LOOP_MAX_STEPS` plus per-workflow defaults.
- [x] Return loop summary metadata from `runResumeLoop()` and log it in `streamAgentLoopEvents()`.
- [x] Make step-limit completion a continue-able outcome in text/telemetry rather than a generic failure.
- [x] Re-run focused Agent tests.

## Task 3: Phase 2 Step Tool Events And Checkpoints

**Files:**
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/src/session-store.ts`
- Test: `apps/agent/src/http.test.ts` or nearest existing Agent route test
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] Add failing stream tests proving a two-step loop emits `TOOL_CALL_RESULT` and `STATE_DELTA /workspace` for step 1 before final run events.
- [x] Run the focused Agent test and confirm tool events are still tail-only.
- [x] Pass `onStepFinish` from `streamAgentLoopEvents()` into `runResumeLoop()`.
- [x] On every step, emit tool result events with the matching operations and emit a workspace delta built from the current draft.
- [x] Ensure the recorder persists these events so `session-store` can restore workspace snapshots after refresh.
- [x] Add or update Web tests that duplicate tool events are not appended twice.
- [x] Re-run focused Agent and Web tests.

## Task 4: Phase 3 Hard `resume_ask` Interrupt And Resume

**Files:**
- Modify: `apps/agent/src/workflows/tools.ts`
- Modify: `apps/agent/src/workflows/draft.ts`
- Modify: `apps/agent/src/workflows/loop-runtime.ts`
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/src/session-store.ts`
- Test: `apps/agent/src/workflows/loop-runtime.test.ts`
- Test: `apps/agent/src/session-store.test.ts`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`

- [x] Add failing tests proving `resume_ask` stops the loop and no later write operation is emitted after the ask.
- [x] Add failing session tests proving pending question interrupts and draft workspace survive snapshot load.
- [x] Introduce a `ResumeAskInterrupt` or equivalent control-flow result from `resume_ask`.
- [x] Catch the ask interrupt in `runResumeLoop()` and return `isAskPending: true` with the collected questions.
- [x] Emit `RUN_FINISHED` with `input_required` interrupt and the latest workspace delta.
- [x] Verify answering a question starts a new run with the stored snapshot instead of a fresh draft.
- [x] Re-run focused Agent and Web tests.

## Task 5: Phase 4 Resume Diagnostic Tools

**Files:**
- Modify: `apps/agent/src/workflows/tools.ts`
- Modify: `apps/agent/src/workflows/resume-workspace.ts`
- Modify: `apps/agent/src/agent-tools.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `apps/web/components/agent/agent-tool-card.tsx`
- Test: `apps/agent/src/workflows/tools.test.ts`
- Test: `apps/web/tests/unit/agent-ag-ui-stream.test.ts`

- [x] Add failing tool tests for `role_match_read`, `ats_check`, `content_claim_audit`, `layout_fit_check`, and `section_quality_score`.
- [x] Implement the tools as deterministic read/evaluation helpers over request context and draft snapshots.
- [x] Make evaluation tools return structured risk/score summaries and never create `ResumeOperation` directly.
- [x] Surface diagnostic tool calls in Web extraction and tool card labels.
- [x] Feed quality risks into workspace `qualityReport` where applicable.
- [x] Re-run focused Agent and Web tests.

## Task 6: Phase 5 Safe Auto-Apply

**Files:**
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`
- Modify: `apps/web/components/agent/agent-panel.tsx`
- Modify: `apps/web/lib/agent/apply-operation.ts`
- Test: `apps/web/tests/unit/agent-panel-assistant-ui.test.tsx`
- Test: `apps/web/tests/unit/agent-apply-operation.test.ts`

- [x] Add failing tests proving auto-apply skips operations with `riskFlags`, `delete_section`, `reorder_sections`, and unsupported operation shapes.
- [x] Add `isAutoApplicableOperation()` near the Web apply boundary and reuse it in the runtime provider and panel apply-all path.
- [x] Keep risky operations visible as confirmation cards with risk messaging.
- [x] Re-run focused Web tests.

## Task 7: Final Verification

**Files:**
- Modify as needed from Tasks 1-6.

- [x] Run `pnpm test`.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.
- [x] Start `pnpm dev:web` and `pnpm dev:agent` if environment variables are available; smoke AgentPanel open, send message, tool card display, question card, and safe apply behavior.
- [x] Update this plan with completed checkboxes and any deviations discovered during implementation.

**Verification notes:**
- `pnpm lint` exited 0 with 12 existing warnings in unrelated Web files.
- Dev smoke used the already-running local Agent on `127.0.0.1:8787` and already-running Web dev server on `localhost:3002`; the attempted duplicate starts failed cleanly because those services were already active.
- Web smoke covered `/`, `/login`, `/dashboard`, `/templates`, and `/api/agent/direct-runs` create-from-zero bootstrap.
- Agent smoke covered `/health`, `/ready`, and authenticated `/v1/agent/chat` entry. The live message stream stopped at `dependency_unavailable` because local Agent model config is not configured, so tool-card/question-card/safe-apply behavior is verified by the focused component and HTTP tests rather than a live model run.
