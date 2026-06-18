# Floating Agent Design

## Why

We want an A/B-testable resume assistant surface: a draggable floating bubble
opens a compact chat window, and the assistant behaves as a mostly autonomous
resume editor. The existing Agent Panel remains the default fallback so the
deployment can compare panel versus floating assistant without removing the
current workflow.

## What

- Add an environment switch that resolves to either the existing panel surface
  or the floating assistant surface.
- When enabled, `/resume/[id]/edit` keeps the editor and preview visible and
  mounts a floating assistant bubble/window.
- The floating assistant uses a compact chat header, history/new-chat/model
  actions, rounded avatar message bubbles, and a draggable shell adapted to
  Intro Builder colors.
- The floating branch uses a Web-local Next route, request-scoped model
  configuration, and no built-in/default model.
- The floating branch owns DB-backed chat sessions: list/create sessions,
  load/delete a session, send chat with `sessionId`, rename a fresh session from
  the first user message, and persist user/assistant messages with tool
  metadata.
- Tool calls returned by the route are converted into existing
  `ResumeOperation` objects, applied to the editor form, and flushed through the
  existing autosave queue.
- User-facing copy must not expose implementation or experiment names. The UI
  says "连接模型" and "模型服务地址 / 访问密钥 / 模型名称".
- When disabled or unset, the existing Agent Panel entry and manual-confirm
  workflow remain unchanged.

## Architecture

- `apps/web/lib/agent/surface.ts` owns env parsing for
  `AGENT_ASSISTANT_SURFACE` and `NEXT_PUBLIC_AGENT_ASSISTANT_SURFACE`.
- `AGENT_ASSISTANT_SURFACE=floating` enables the floating assistant; any other
  value falls back to the current panel.
- `app/(app)/resume/[id]/edit/page.tsx` reads the surface on the server and
  passes it to `EditorClient`.
- `EditorClient` chooses between the current in-column/sheet Agent Panel and
  `AgentBubble` + `FloatingAgentChat`.
- `AgentBubble` owns floating shell behavior only: draggable bubble, draggable
  window, persisted position, responsive sizing, and minimized/open state.
- `FloatingAgentChat` owns the floating-only chat UI, local conversation state,
  session history/new-chat controls, model connection dialog, and call to
  `/api/agent/floating/chat`.
- `/api/agent/floating/chat` runs in the Next Node runtime, constructs the model
  client only from request data, validates the optional session, streams AI SDK
  text/tool parts with a step loop, persists ordered message parts, declares
  semantic resume tools, and returns `operations` for the editor to apply.
- `/api/agent/floating/models` runs in the Next Node runtime and lists available
  models from the user-provided service address and access key. The result is
  used only to populate the model picker in the connection dialog.
- `/api/agent/floating/sessions` lists and creates sessions for the current
  resume.
- `/api/agent/floating/sessions/[sessionId]` loads paginated messages and
  deletes owned sessions.
- `agent_floating_chat_session` and `agent_floating_chat_message` persist
  floating-only history without changing the existing Agent Panel data flow.

## Non-Goals

- Do not remove the existing Agent Panel fallback.
- Do not add a default model or server-side model key for this branch.
- Do not expose model setup internals as product copy.
- Do not migrate the existing Agent Panel to the floating session tables in this
  slice.

## Acceptance Criteria

- `AGENT_ASSISTANT_SURFACE=floating` enables the floating assistant.
- Any other value, or no env value, falls back to the existing panel.
- Floating mode does not show the old Agent toolbar toggle or old resume-title
  dropdown inside the chat window.
- Floating mode renders user and assistant avatar bubbles.
- Floating mode does not expose "自动应用" or the manual-confirm toggle; resume
  operations returned by the local route are applied directly to the editor form.
- After the user fills model service address and access key, the connection
  dialog can fetch available models and let the user select one.
- Floating mode creates or loads a chat session on mount, sends `sessionId` with
  chat requests, persists the last user message and assistant response, shows
  history, supports new chat, and can delete an owned session.
- The floating UI contains no implementation or experiment keywords.
- Existing panel tests and assistant-ui tests continue to pass.
- Full local gates pass: `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `pnpm build`.
