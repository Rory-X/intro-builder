# Agent Code Map

本文档按开发任务列出 Agent 相关代码入口。动手前先看这里，可以少走很多弯路。

## Agent Service

| File | Responsibility |
| --- | --- |
| `apps/agent/package.json` | Agent package scripts and dependencies |
| `apps/agent/src/index.ts` | process entrypoint, listen, shutdown |
| `apps/agent/src/config.ts` | env parsing and validation |
| `apps/agent/src/http.ts` | health/ready routing, request ids, JSON errors |
| `apps/agent/src/redis.ts` | Redis client factory and readiness |
| `apps/agent/src/rate-limit.ts` | Redis-backed rate limiting primitive |
| `apps/agent/src/errors.ts` | JSON error envelope helpers |
| `apps/agent/tests/config.test.ts` | config behavior |
| `apps/agent/tests/http.test.ts` | health/ready/404/405 behavior |
| `apps/agent/tests/redis.test.ts` | Redis dependency behavior |
| `apps/agent/tests/rate-limit.test.ts` | rate limit primitive |
| `apps/agent/Dockerfile` | production image |
| `apps/agent/compose.yaml` | local/server compose shape |
| `apps/agent/Caddyfile` | reverse proxy template |
| `apps/agent/.env.example` | env hints |

Phase 0C likely additions:

| Planned file | Responsibility |
| --- | --- |
| `apps/agent/src/auth.ts` | Agent JWT verification |
| `apps/agent/src/request-context.ts` | request id, scope, user hash |
| `apps/agent/tests/auth.test.ts` | token validation cases |

## Web Agent Client

These files do not exist yet, but should be the Web side entrypoints:

| Planned file | Responsibility |
| --- | --- |
| `lib/agent/client.ts` | server-side Agent HTTP client |
| `lib/agent/token.ts` | short-lived Agent JWT signer |
| `app/api/agent/session/route.ts` | protected session smoke route |
| `app/api/agent/messages/route.ts` | Phase 3 assistant-ui BFF stream route |
| `tests/unit/agent-token.test.ts` | signer behavior |
| `tests/unit/agent-client.test.ts` | timeout/error mapping |

Rules:

- Keep this code server-only.
- Do not import provider SDKs into Web client components.
- Do not scatter raw `fetch(AGENT_BASE_URL)` across UI components.

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

Planned components:

| Planned file | Phase | Responsibility |
| --- | --- | --- |
| `components/agent/rich-text-polish-button.tsx` | 1 | toolbar button and request state |
| `components/agent/polish-suggestion-popover.tsx` | 1 | apply/cancel suggestion UI |
| `components/agent/section-helper-button.tsx` | 2 | section-level helper trigger |
| `components/agent/agent-suggestion-card.tsx` | 2 | reusable suggestion display |
| `components/agent/agent-panel-trigger.tsx` | 3 | open assistant panel |
| `components/agent/agent-panel.tsx` | 3 | assistant-ui panel shell |
| `components/agent/agent-runtime-provider.tsx` | 3 | assistant-ui runtime integration |

Reuse:

- `components/ui/button.tsx`
- `components/ui/sheet.tsx`
- `components/ui/popover.tsx`
- `components/ui/separator.tsx`
- `sonner`
- `lucide-react`

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
