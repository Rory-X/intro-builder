# Floating Assistant Dock Design

## Goal

Let the floating AI 简历助手 expand into the desktop editor's left form column while keeping the existing floating chat UI and conversation behavior unchanged.

## User Need

The floating assistant currently opens as a movable overlay. Users need a larger reading and typing surface without losing the live preview on the right. The requested behavior is a panel mode that reuses the current floating conversation flow instead of switching to the older `AgentPanel` interaction.

## Approved Behavior

- Add an enlarged icon button in the `AgentBubble` title bar, next to the minimize button.
- Clicking the button docks the assistant into the left editor column.
- The left form editing area is replaced by the same `FloatingAgentChat` conversation flow.
- The right live preview remains visible and keeps its current width behavior.
- The floating overlay and bubble are not rendered while the assistant is docked, preventing a second hidden chat instance from mounting.
- Returning to the form editor restores the normal floating bubble entry point.
- The docked view exposes a clear icon button to return to the form editor.
- History, new chat, model settings, message rendering, tool cards, streaming, input behavior, and operation application continue to come from `FloatingAgentChat`.

## Non-Goals

- Do not reuse or modify `AgentPanel` for this flow.
- Do not change Agent API routes, streaming protocol, model configuration storage, session persistence, or resume operation semantics.
- Do not change mobile behavior in this slice.
- Do not add a new visual language; the docked chat should feel like the existing floating chat in a larger container.

## Architecture

`EditorClient` remains the owner of desktop layout state. In floating mode it gains a docked-chat state that uses the existing left-column replacement slot currently used by panel mode. `AgentBubble` becomes a controlled entry surface for docking by accepting an optional callback for the title-bar dock button.

To avoid duplicating chat logic, create one `floatingChat` element from `FloatingAgentChat` and render it either inside `AgentBubble` or inside the left editor column. Only one instance is mounted at a time so there are no duplicate session fetches or split message state.

## Interaction Details

When the assistant is floating:

1. The bubble opens the overlay as it does today.
2. The title bar shows a dock icon button.
3. Pressing the dock icon calls back into `EditorClient`.
4. `EditorClient` sets the docked state, closes the overlay, hides template panel if open, and swaps the left editor column for the floating chat.

When the assistant is docked:

1. The left column renders a small top bar with a return-to-editor icon button.
2. Below the bar, `FloatingAgentChat` fills the remaining column height.
3. The resize handle is hidden, matching existing agent mode behavior.
4. Pressing the return icon restores the form editor.

## Testing

- Add a unit test in `apps/web/tests/unit/editor-client-live-preview.test.tsx`.
- The test renders `EditorClient` with `agentSurface="floating"`, opens the floating assistant, clicks the dock button, then asserts:
  - the docked chat is visible in the editor column,
  - the old `AgentPanel` controls are not visible,
  - the form editor content is replaced while docked,
  - the return button restores the form editor.

## Risks

- Mounting two `FloatingAgentChat` instances at once would duplicate session loading and lose in-memory message state. The implementation must render only one instance depending on docked vs floating state.
- `AgentBubble` owns overlay open state today. The dock callback must also close the overlay so the same chat is not visible twice.
- Existing tests use jsdom and fake timers; the new test should use role labels and existing test setup instead of layout-dependent assertions.
