# Agent Mode Streaming Phase 3B Design

## Goal

Complete the remaining Phase 3 Agent Mode work by upgrading the chat path from one-shot JSON to an AG-UI-compatible stream-capable conversation flow, keeping assistant-ui in the Agent panel, and adding a mobile Agent Sheet without changing the Web-owned resume state boundary.

## Scope

Phase 3B ships three product-visible upgrades:

- AG-UI streaming chat: Agent responses appear progressively in assistant-ui using AG-UI events instead of waiting for the full provider response.
- Streaming-safe resume operation tools: AG-UI `TOOL_CALL_*` events carry minimal resume operations that still render as Web-owned confirmation cards.
- Mobile Agent Sheet: on small screens, `Agent 模式` opens a focused Sheet-like Agent panel instead of trying to render the desktop split view.

This phase does not migrate OCR, resume import, or existing AI parsing. It does not let the Agent service write Postgres or mutate React Hook Form directly.

## Architecture

Phase 3B keeps the Phase 3A trust boundary:

```text
Browser AgentPanel
  -> Web BFF /api/agent/messages
  -> short-lived agent:chat JWT
  -> Agent service /v1/agent/messages
  -> provider
  -> AG-UI SSE events
```

The streaming protocol is AG-UI over `text/event-stream`, encoded by `@ag-ui/encoder` and typed by `@ag-ui/core`.

Required event sequence for a normal response:

- `RUN_STARTED`
- `TEXT_MESSAGE_START`
- one or more `TEXT_MESSAGE_CONTENT`
- zero or more resume operation tool events:
  - `TOOL_CALL_START`
  - `TOOL_CALL_ARGS`
  - `TOOL_CALL_END`
  - `TOOL_CALL_RESULT`
- `TEXT_MESSAGE_END`
- `RUN_FINISHED`

Errors use `RUN_ERROR` and then close the stream.

assistant-ui integration remains `LocalRuntime` with a custom `ChatModelAdapter`, but the adapter returns an async generator. This uses the installed `@assistant-ui/react@0.14.15` LocalRuntime streaming support while the transport itself follows AG-UI.

## Minimal Resume Operation Tools

Phase 3B replaces the earlier broad proposal-style tools with a smaller, more product-native tool set. These tools are still proposals until Web confirmation applies them:

- `resume_read`: inspect the current capped resume context.
- `resume_update_section`: replace one allowlisted section field.
- `resume_delete_section`: remove or hide an allowlisted section entry.
- `resume_reorder_sections`: update `sectionOrder`.
- `resume_insert_section`: create a new allowlisted section entry only when Web supports an explicit confirmation path.

This tool set maps to user-visible editing operations rather than prompt-specific writing categories. STAR optimization and list-preserving rewrites become instructions inside `resume_update_section`, not separate tool names.

## AG-UI Compatibility Choices

- Agent service accepts the existing Web JSON body for backward compatibility, then converts the parsed provider output into AG-UI events.
- Web BFF remains the only browser-visible endpoint, but forwards `Accept: text/event-stream` to Agent.
- Agent and Web use official AG-UI package types and `EventEncoder`.
- assistant-ui still renders the thread/composer. The adapter consumes AG-UI events and yields assistant text updates to LocalRuntime.
- Tool calls are shown as AG-UI-derived operation cards, then converted into Web-owned confirmation actions.

## Mobile Sheet

Desktop remains the approved Phase 3A layout: left editor column switches to Agent panel and right `LivePreview` stays visible.

Mobile cannot use that split layout. Phase 3B uses the existing `components/ui/sheet.tsx` primitive if present; otherwise it uses a small local fixed overlay in the editor. The mobile panel must:

- Preserve RHF and autosave state.
- Show a clear “切回编辑”/close action.
- Not hide save feedback permanently.
- Keep operation confirmation identical to desktop.

## Safety Invariants

- No partial stream chunk writes to RHF.
- No Agent-generated change writes before the user clicks `应用`.
- Operation field paths remain allowlisted.
- Stream errors render as Chinese user-facing errors and do not break normal editor typing.
- Request cancellation must abort the browser fetch and stop yielding assistant-ui chunks.
- Web BFF remains the only browser-visible Agent endpoint in this phase.

## Success Criteria

- Desktop Agent Mode streams assistant text progressively through assistant-ui.
- Preset workflows and free-form composer both use the same streaming path.
- AG-UI tool call cards and confirmation cards still appear from streamed metadata.
- Mobile users can open Agent Mode in a Sheet-like panel.
- `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`, and `pnpm agent:build` pass.
