# Agent Code Map

本文档按开发任务列出 Agent 相关代码入口。动手前先看这里，可以少走很多弯路。

## Agent Service

| File | Responsibility |
| --- | --- |
| `apps/agent/package.json` | Agent package scripts and dependencies |
| `apps/agent/src/index.ts` | process entrypoint, listen, shutdown |
| `apps/agent/src/config.ts` | env parsing and validation |
| `apps/agent/src/http.ts` | health/ready routing, protected routes, request ids, JSON errors |
| `apps/agent/src/redis.ts` | Redis client factory and readiness |
| `apps/agent/src/rate-limit.ts` | Redis-backed rate limiting primitive |
| `apps/agent/src/errors.ts` | JSON error envelope helpers |
| `apps/agent/src/rich-text-polish.ts` | Rich text polish request validation, prompt builder, provider parser |
| `apps/agent/src/resume-helpers.ts` | Resume helper IDs, validation, prompt builder, provider parser |
| `apps/agent/src/agent-messages.ts` | Phase 3A: Agent Mode message validation, prompt builder, provider parser |
| `apps/agent/src/agent-tools.ts` | Phase 3A: basic resume tool names and `ResumePatch` validation |
| `apps/agent/tests/config.test.ts` | config behavior |
| `apps/agent/tests/http.test.ts` | health/ready/404/405 behavior |
| `apps/agent/tests/redis.test.ts` | Redis dependency behavior |
| `apps/agent/tests/rate-limit.test.ts` | rate limit primitive |
| `apps/agent/tests/rich-text-polish.test.ts` | rich text polish validation and parser behavior |
| `apps/agent/tests/resume-helpers.test.ts` | resume helper validation, prompt rules, parser behavior |
| `apps/agent/tests/agent-messages.test.ts` | Phase 3A: Agent message contract and prompt/parser behavior |
| `apps/agent/tests/agent-tools.test.ts` | Phase 3A: basic tool and patch validation |
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
| `lib/agent/agent-message-contract.ts` | Phase 3A: browser-safe Agent message/tool/patch types |
| `lib/agent/chat-context.ts` | Phase 3A: RHF resume content to capped Agent chat context |
| `app/api/agent/session/route.ts` | protected session smoke route |
| `app/api/agent/rich-text/polish/route.ts` | Web BFF for rich text polish |
| `app/api/agent/resume/helpers/[helperId]/route.ts` | Web BFF for Phase 2A resume helpers |
| `app/api/agent/messages/route.ts` | Phase 3A: assistant-ui Agent Mode BFF JSON route |
| `tests/unit/agent-token.test.ts` | signer behavior |
| `tests/unit/agent-client.test.ts` | timeout/error mapping |
| `tests/unit/agent-session-route.test.ts` | Web BFF smoke route behavior |
| `tests/unit/agent-rich-text-polish-route.test.ts` | rich text polish BFF behavior |
| `tests/unit/agent-resume-helper-context.test.ts` | helper context extraction and caps |
| `tests/unit/agent-resume-helper-route.test.ts` | resume helper BFF auth/ownership/proxy behavior |
| `tests/unit/agent-chat-context.test.ts` | Phase 3A: Agent chat context extraction and field paths |
| `tests/unit/agent-messages-route.test.ts` | Phase 3A: Agent message BFF auth/ownership/proxy behavior |

Rules:

- Keep this code server-only.
- Do not import provider SDKs into Web client components.
- Do not scatter raw `fetch(AGENT_BASE_URL)` across UI components.
- Web BFF must validate Auth.js session and resume ownership before signing `agent:chat`.
- Browser components must call `/api/agent/messages`, never Agent `/v1/agent/messages` directly in Phase 3A.
- Current Phase 3A backend contract files exist; do not recreate them under different names.

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

Planned components:

| Planned file | Phase | Responsibility |
| --- | --- | --- |
| `components/agent/agent-mode-toggle.tsx` | 3A | toolbar `Agent 模式` toggle with gradient text/icon |
| `components/agent/agent-panel.tsx` | 3A | left-column assistant-ui Agent panel shell |
| `components/agent/agent-runtime-provider.tsx` | 3 | assistant-ui runtime integration |
| `components/agent/agent-preset-workflows.tsx` | 3A | preset workflow chips |
| `components/agent/agent-tool-card.tsx` | 3A | visible tool call/result card |
| `components/agent/agent-confirmation-card.tsx` | 3A | `ResumePatch` apply/ignore card |
| `tests/unit/agent-panel.test.tsx` | 3A | Agent panel workflow and confirmation behavior |
| `tests/unit/editor-client-agent-mode.test.tsx` | 3A | editor mode toggle, preview preservation, RHF writeback |

Reuse:

- `components/ui/button.tsx`
- `components/ui/sheet.tsx` only for later Phase 3B mobile exploration, not Phase 3A desktop
- `components/ui/popover.tsx`
- `components/ui/separator.tsx`
- `sonner`
- `lucide-react`

Phase 3A UI guardrails:

- `Agent 模式` is a left-column mode switch, not a right drawer or floating chat.
- assistant-ui imports should stay behind Agent panel/runtime files and be lazy-loaded where practical.
- `AgentConfirmationCard` calls a Web-owned apply callback; it must not call server actions or mutate persisted content directly.
- Text/icon gradients are allowed for AI affordance; gradient backgrounds are not part of the approved button treatment.

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
