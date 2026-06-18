# Fogot-Inspired Long Loop Agent Design

## Goal

Bring intro-builder Agent Mode in line with
`docs/agent/fogot-inspired-long-loop-agent.md`: one true long-loop product path,
observable step-by-step tool execution, hard `resume_ask` interruption and resume,
resume-specific diagnostic tools, and risk-aware apply behavior.

## Current Gap

The repository already has the right core: `/api/agent/direct-runs` bootstraps a
direct browser-to-Agent stream, `/v1/agent/chat` runs `runResumeLoop()` for AG-UI
SSE requests, `DraftState` keeps writes out of the real resume, and
`ResumeOperation` is the Web-side mutation boundary.

The incomplete parts are:

- Tool results are emitted only at the tail of the run, so the panel cannot show
  step progress while the loop is running.
- `resume_ask` collects questions but does not force the loop to stop.
- Shared/Web tool contracts still reject or ignore several real loop tools.
- Loop step count is hard-coded and telemetry does not report actual step
  behavior.
- Resume-specific read/evaluation tools are missing.
- Auto-apply applies every proposed operation, including risky operations.
- Agent docs still describe legacy routes and an older tool taxonomy.

## Final Shape

The product path is:

```text
AgentPanel / assistant-ui
  -> Web BFF /api/agent/direct-runs
  -> Agent /v1/agent/chat
  -> AI SDK streamText + resume-domain tools
  -> DraftState checkpoints
  -> AG-UI step events + workspace deltas
  -> user confirmation or question card
  -> Web applyResumeOperation + RHF + autosave
```

The Agent never writes the real resume. It may read context, diagnose, stage
draft edits, and ask questions. The Web app owns auth, resume ownership, RHF,
preview, autosave, and final apply.

## Phase Scope

Phase 0 updates docs and contracts so the route/tool reality is explicit.

Phase 1 makes true loop behavior configurable and observable. The fallback JSON
provider may remain as a debug/non-SSE path, but product UI continues to rely
only on `/api/agent/direct-runs` plus `/v1/agent/chat` SSE.

Phase 2 emits completed tool results and workspace deltas as each loop step
finishes. Running-state events can be added later if AI SDK lifecycle hooks make
that reliable; this phase must still make step progress visible before the tail.

Phase 3 turns `resume_ask` into a hard interrupt. Once called, the loop stops,
stores the draft/workspace snapshot, and returns an `input_required` interrupt.

Phase 4 adds resume-specific read/evaluation tools:
`role_match_read`, `ats_check`, `content_claim_audit`, `layout_fit_check`, and
`section_quality_score`. These tools are read-only and may contribute quality
reports, risk flags, and tool timeline entries, but do not mutate the real
resume.

Phase 5 makes auto-apply safe: only low-risk update/insert operations may be
auto-applied. Risk flags, delete, reorder, and unsupported operations require
manual confirmation.

## Key Decisions

- Do not add shell, file, browser, or database tools to the Agent. This remains
  a resume-domain agent.
- Keep `ResumeOperation` as the only write boundary.
- Keep direct browser-to-Agent data plane as the current product path, documented
  as intentional rather than accidental.
- Prefer step-completed streaming now over fragile fake running events.
- Reuse the existing AgentPanel artifact list before designing a new visual
  timeline. A separate visual PoC is only needed if a later iteration replaces
  the current artifact layout.

## Acceptance

- Existing AgentPanel requests use the direct-runs bootstrap and AG-UI SSE chat
  route.
- New loop tests prove per-step tool results are emitted before final
  `RUN_FINISHED`.
- `resume_ask` stops the loop and produces a restorable question interrupt.
- Session snapshots preserve draft/workspace progress across step deltas.
- Diagnostic tools appear in contracts, server validation, Web extraction, and
  tool card labels.
- Auto-apply refuses risky operations.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass before the
  goal is marked complete.
