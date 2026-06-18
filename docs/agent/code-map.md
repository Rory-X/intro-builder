# Agent Code Map

本文档按开发任务列出 Agent 相关代码入口。动手前先看这里，可以少走很多弯路。

## Agent Service

| File | Responsibility |
| --- | --- |
| `apps/agent/package.json` | Agent package scripts and dependencies |
| `apps/agent/src/index.ts` | process entrypoint, listen, shutdown |
| `apps/agent/src/config.ts` | env parsing and validation |
| `apps/agent/src/http.ts` | health/ready routing, protected business routes, request ids, JSON errors |
| `apps/agent/src/redis.ts` | Redis client factory and readiness |
| `apps/agent/src/rate-limit.ts` | Redis-backed rate limiting primitive |
| `apps/agent/src/errors.ts` | JSON error envelope helpers |
| `apps/agent/src/rich-text-polish.ts` | Rich text polish request validation, prompt builder, provider parser |
| `apps/agent/src/resume-helpers.ts` | Resume helper IDs, validation, prompt builder, provider parser |
| `apps/agent/src/agent-messages.ts` | Phase 3B: Agent Mode message validation, prompt builder, provider parser, AG-UI event shaping |
| `apps/agent/src/agent-tools.ts` | Phase 3B: minimal resume tool names and `ResumeOperation` validation |
| `apps/agent/tests/config.test.ts` | config behavior |
| `apps/agent/tests/http.test.ts` | health/ready/404/405 behavior |
| `apps/agent/tests/redis.test.ts` | Redis dependency behavior |
| `apps/agent/tests/rate-limit.test.ts` | rate limit primitive |
| `apps/agent/tests/rich-text-polish.test.ts` | rich text polish validation and parser behavior |
| `apps/agent/tests/resume-helpers.test.ts` | resume helper validation, prompt rules, parser behavior |
| `apps/agent/tests/agent-messages.test.ts` | Phase 3B: Agent message contract, prompt/parser behavior, AG-UI event conversion |
| `apps/agent/tests/agent-tools.test.ts` | Phase 3B: minimal tool and `ResumeOperation` validation |
| `apps/agent/Dockerfile` | production image |
| `apps/agent/compose.yaml` | local/server compose shape |
| `apps/agent/Caddyfile` | reverse proxy template |
| `apps/agent/.env.example` | env hints |

Phase 0C additions:

| File | Responsibility |
| --- | --- |
| `apps/agent/src/auth.ts` | Agent JWT verification |
| `apps/agent/tests/auth.test.ts` | token validation cases |
| `apps/agent/tests/http.test.ts` | protected `/v1/session` route behavior |

## Web Agent Client

Web side entrypoints:

| File | Responsibility |
| --- | --- |
| `lib/agent/client.ts` | server-side Agent HTTP client |
| `lib/agent/token.ts` | short-lived Agent JWT signer |
| `lib/agent/resume-helper-context.ts` | RHF resume content to capped helper context |
| `lib/agent/agent-message-contract.ts` | Phase 3B: browser-safe Agent message/tool/operation types |
| `lib/agent/ag-ui-stream.ts` | Phase 3B: shared AG-UI SSE encoder/reader and tool result extraction |
| `lib/agent/chat-context.ts` | Phase 3B: RHF resume content to capped Agent chat context |
| `app/api/agent/session/route.ts` | protected session smoke route |
| `app/api/agent/rich-text/polish/route.ts` | Web BFF for rich text polish |
| `app/api/agent/resume/helpers/[helperId]/route.ts` | Web BFF for Phase 2A resume helpers |
| `app/api/agent/messages/route.ts` | Phase 3B: assistant-ui Agent Mode BFF AG-UI SSE proxy with JSON debug fallback |
| `app/api/agent/floating/chat/route.ts` | Env-gated floating assistant chat route, request-scoped model config, direct resume operations, floating session persistence |
| `app/api/agent/floating/models/route.ts` | Env-gated floating assistant model list route using user-provided service settings |
| `app/api/agent/floating/sessions/route.ts` | Env-gated floating assistant session list/create route |
| `app/api/agent/floating/sessions/[sessionId]/route.ts` | Env-gated floating assistant session detail/delete route |
| `lib/agent/floating-chat-session-store.ts` | Floating-only DB session/message persistence helpers |
| `lib/agent/surface.ts` | Web editor Agent surface env selection |
| `tests/unit/agent-token.test.ts` | signer behavior |
| `tests/unit/agent-client.test.ts` | timeout/error mapping |
| `tests/unit/agent-session-route.test.ts` | Web BFF smoke route behavior |
| `tests/unit/agent-rich-text-polish-route.test.ts` | rich text polish BFF behavior |
| `tests/unit/agent-resume-helper-context.test.ts` | helper context extraction and caps |
| `tests/unit/agent-resume-helper-route.test.ts` | resume helper BFF auth/ownership/proxy behavior |
| `tests/unit/agent-chat-context.test.ts` | Phase 3B: Agent chat context extraction and field paths |
| `tests/unit/agent-messages-route.test.ts` | Phase 3B: Agent message BFF auth/ownership/proxy behavior |
| `tests/unit/agent-floating-chat-route.test.ts` | Floating assistant local chat route and persistence behavior |
| `tests/unit/agent-floating-models-route.test.ts` | Floating assistant model list route behavior |
| `tests/unit/agent-floating-sessions-route.test.ts` | Floating assistant session list/detail/delete route behavior |
| `tests/unit/agent-surface.test.ts` | Agent surface env parsing |

Rules:

- Keep this code server-only.
- Do not import provider SDKs into Web client components.
- Do not scatter raw `fetch(AGENT_BASE_URL)` across UI components.
- Web BFF must validate Auth.js session and resume ownership before signing `agent:chat`.
- Browser components must call `/api/agent/messages`, never Agent `/v1/agent/messages` directly.
- Browser Agent Mode must request AG-UI SSE (`Accept: text/event-stream`); JSON is only a non-browser debug fallback.
- The env-gated floating assistant is the exception to the AG-UI BFF path: it
  stays inside Web Next routes, uses request-scoped model settings from the
  browser, persists its own chat sessions, and returns `ResumeOperation[]` for
  the editor to apply through the existing autosave path.
- Current Phase 3B backend contract files exist; do not recreate them under different names.

## Editor Page

| File | Why it matters |
| --- | --- |
| `app/(app)/resume/[id]/edit/page.tsx` | server fetch for resume, templates, auth |
| `app/(app)/resume/[id]/edit/editor-client.tsx` | main editor client state |
| `app/(app)/resume/[id]/edit/actions.ts` | save, template, share server actions |
| `hooks/use-resume-autosave.ts` | save queue and flush event |
| `components/preview/live-preview.tsx` | RHF-driven preview |

Rules:

- Do not pass full resume content down into preview as a prop.
- Do not bypass `useResumeAutosave`.
- Do not let Agent panel own resume state.
- Phase 3A Agent Mode replaces the left editor column; it is not a right-side drawer.
- Right `LivePreview` must remain visible in desktop Agent Mode.

## Rich Text

| File | Why it matters |
| --- | --- |
| `components/editor/rich-text-editor.tsx` | Phase 1 polish button entry |
| `lib/tiptap-types.ts` | TipTap JSON types |
| `lib/tiptap-extensions.ts` | TipTap extension list |
| `lib/rich-text-font-size.ts` | font size mark helpers |
| `lib/rich-text-prose.ts` | prose class and font size constants |
| `components/preview/rich-text-renderer.tsx` | read-only rendering |

Rules:

- TipTap content is JSON, not HTML.
- AI input/output must preserve safe TipTap JSON.
- Suggestion apply should call the existing `onChange` path.

## Agent UI Components

Implemented components:

| File | Phase | Responsibility |
| --- | --- | --- |
| `components/agent/resume-diagnose-button.tsx` | 2A | whole-resume diagnosis popover trigger and request state |
| `components/agent/section-helper-button.tsx` | 2A | section-level next-step suggestion trigger |
| `components/agent/resume-helper-card.tsx` | 2A | reusable structured suggestion card |
| `tests/unit/resume-diagnose-button.test.tsx` | 2A | diagnosis request and suggestion display |
| `tests/unit/section-helper-button.test.tsx` | 2A | section helper request shape |
| `tests/unit/resume-helper-card.test.tsx` | 2A | suggestion card rendering |

Phase 3B components:

| File | Phase | Responsibility |
| --- | --- | --- |
| `components/agent/agent-mode-toggle.tsx` | 3B | toolbar `Agent 模式` toggle with gradient text/icon |
| `components/agent/agent-panel.tsx` | 3B | left-column Agent panel shell using assistant-ui thread/composer primitives, AG-UI workflow calls, tool/operation cards |
| `components/agent/agent-runtime-provider.tsx` | 3B | assistant-ui LocalRuntime seam isolated from product state |
| `components/agent/agent-preset-workflows.tsx` | 3B | preset workflow chips |
| `components/agent/agent-tool-card.tsx` | 3B | visible tool call/result card |
| `components/agent/agent-confirmation-card.tsx` | 3B | `ResumeOperation` apply/ignore card |
| `components/agent/agent-bubble.tsx` | floating AB | draggable floating assistant bubble/window shell |
| `components/agent/floating-agent-chat.tsx` | floating AB | compact chat UI, session history, model connection, direct operation apply |
| `lib/agent/assistant-ui-react-compat.ts` | 3B | localized React 19 internals alias for assistant-ui/tap webpack build |
| `next.config.ts` | 3B | targeted `NormalModuleReplacementPlugin` for tap dispatcher only |
| `tests/unit/agent-panel.test.tsx` | 3B | Agent panel workflow and confirmation behavior |
| `tests/unit/agent-panel-assistant-ui.test.tsx` | 3B | assistant-ui composer/thread drives Web BFF AG-UI messages |
| `tests/unit/editor-client-live-preview.test.tsx` | 3B | editor mode toggle and preview preservation coverage |

Status note:

- These files shipped in PR #43 and are now the canonical Phase 3B implementation.
- Do not recreate parallel files such as `agent-chat-panel.tsx` or `editor-client-agent-mode.test.tsx` unless the plan is updated first.

Reuse:

- `components/ui/button.tsx`
- `components/ui/sheet.tsx` for Phase 3B mobile Agent Sheet, not desktop Agent Mode
- `components/ui/popover.tsx`
- `components/ui/separator.tsx`
- `sonner`
- `lucide-react`

Phase 3B UI guardrails:

- 默认 `Agent 模式` is a left-column mode switch, not a right drawer. The
  env-gated AB variant `AGENT_ASSISTANT_SURFACE=floating` is the only
  supported floating-chat exception.
- Agent message streaming must stay AG-UI-first: `@ag-ui/core` event types, `@ag-ui/encoder` SSE encoding, Web parser validation with `BaseEventSchema`.
- assistant-ui imports should stay behind Agent panel/runtime files and be lazy-loaded where practical.
- assistant-ui/tap React compatibility is localized to `lib/agent/assistant-ui-react-compat.ts`; do not alias React globally.
- `AgentConfirmationCard` calls a Web-owned apply callback; it must not call server actions or mutate persisted content directly.
- Text/icon gradients are allowed for AI affordance; gradient backgrounds are not part of the approved button treatment.
- Tool names must match the service contract: `resume_read`、`resume_update_section`、`resume_delete_section`、`resume_reorder_sections`、`resume_insert_section`.
- Do not add workflow-specific tool names; workflows only change prompts and policy, not the tool set.

## Dashboard and Templates

Do not start here for Agent work.

| File | Note |
| --- | --- |
| `app/(app)/dashboard/page.tsx` | resume list, not Agent MVP surface |
| `app/(app)/templates/page.tsx` | template selection, not Agent panel |
| `components/templates/template-preview-drawer.tsx` | not a container for Agent UI |

## Public Resume and PDF

Agent changes should not affect these until explicitly planned.

| File | Note |
| --- | --- |
| `app/r/[slug]/page.tsx` | public read-only resume |
| `app/api/pdf/[id]/route.tsx` | PDF generation |
| `app/(app)/resume/[id]/preview/page.tsx` | preview page reused by PDF |
| `lib/pdf-route-helpers.ts` | Puppeteer launch and timeout helpers |

## Dev Preview

| File | Note |
| --- | --- |
| `app/dev-preview/page.tsx` | DB-backed template preview index, now dynamic |
| `app/dev-preview/template/[id]/page.tsx` | DB-backed template preview detail |

Reason:

- These pages are for template development, not Agent product UI.
- Keep them dynamic because they query DB.

## Test Commands by Surface

Agent service only:

```bash
pnpm agent:test
pnpm agent:typecheck
pnpm agent:build
```

Web integration:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Full gate:

```bash
pnpm verify
pnpm agent:build
```
