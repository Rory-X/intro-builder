# Agent Resume Helpers Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first resume-level Agent helper slice: structured resume diagnosis and section next-step suggestions that return user-confirmed suggestions only.

**Architecture:** Web keeps Auth.js session, resume ownership checks, React Hook Form state, preview, autosave, and final writeback authority. The Agent microservice accepts a short-lived `resume:helper` JWT, validates one helper request, calls the OpenAI-compatible provider, enforces Redis rate limits, and returns structured suggestions without writing Postgres. Phase 2A stays button/card based and does not introduce assistant-ui chat runtime.

**Tech Stack:** Next.js 16 App Router, React 19, React Hook Form, TipTap JSON, Node/TypeScript Agent service, Redis rate limit/replay guard, OpenAI-compatible provider, Vitest/jsdom.

**Implementation status (2026-06-08):** Agent domain/route, Web client/BFF/context, and editor UI entrypoints are implemented locally. Targeted verification passed for Agent route/domain tests and Web/UI helper tests. Full verification passed with `pnpm verify` and `pnpm agent:build`.

---

## Product Decision

Recommended path: implement **Phase 2A: resume diagnosis + section next steps** before the assistant-ui panel.

Options considered:

| Option | What it does | Tradeoff | Decision |
| --- | --- | --- | --- |
| A. Section helpers first | Adds small helper buttons per section | Fast UI value, but lacks resume-level prioritization | Include as `section-next-steps` |
| B. Resume diagnostic first | Gives global top issues and next actions | Safer because it suggests, not rewrites | Include as `resume-diagnose` |
| C. assistant-ui panel first | Adds chat-style Agent surface | More moving parts: runtime, stream protocol, tool display, bundle cost | Defer to Phase 3 |

Phase 2A implements only two helper IDs:

| Helper ID | Scope | User outcome |
| --- | --- | --- |
| `resume-diagnose` | Whole resume summary | User sees top resume gaps, risks, and suggested next edits |
| `section-next-steps` | One section | User sees 2-3 concrete improvement suggestions for the active section |

Phase 2A does **not** generate direct replacement patches. Suggestions may include example wording, but Web does not auto-apply them to RHF. Content-generating helpers such as `experience-quantify`, `project-impact`, and `skills-dedupe` need a separate Phase 2B plan because they require apply/cancel writeback semantics per section type.

## Non-Negotiable Boundaries

- Existing OCR, import resume, and AI parsing stay in the current production paths. They are not migrated into the Agent service in this phase.
- Agent never connects to Postgres and never writes `resume.content`.
- Web verifies the user session and resume ownership before signing a `resume:helper` Agent JWT.
- Web may forward the current unsaved RHF content snapshot because DB content can lag behind autosave.
- Agent output is a suggestion list only. User confirmation remains required for any edit.
- assistant-ui remains Phase 3 and is not imported into the editor main bundle in this phase.
- The endpoint is HTTP/JSON. Protobuf remains an IDL draft that mirrors the JSON contract.

## Target Contract

Agent endpoint:

```text
POST /v1/resume/helpers/:helperId
Authorization: Bearer <agent-jwt with scope resume:helper>
```

Web BFF endpoint:

```text
POST /api/agent/resume/helpers/[helperId]
```

Request shape:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "target": {
    "kind": "resume",
    "section": null,
    "fieldPath": null
  },
  "context": {
    "resumeTitle": "前端开发工程师",
    "completeness": {
      "overall": 68,
      "sections": [
        { "key": "experience", "label": "工作经历", "score": 7, "max": 10 }
      ]
    },
    "sections": [
      {
        "key": "experience",
        "label": "工作经历",
        "plainText": "负责业务系统前端开发，优化页面性能。"
      }
    ]
  },
  "intent": {
    "mode": "diagnose",
    "maxSuggestions": 5,
    "strategy": "star"
  }
}
```

Successful response shape:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "helperId": "resume-diagnose",
  "result": {
    "summary": "整体内容完整，但工作经历缺少可验证结果，项目经历对业务影响解释不足。",
    "suggestions": [
      {
        "id": "sug_experience_result",
        "section": "experience",
        "fieldPath": "experience",
        "severity": "high",
        "title": "为工作经历补充可验证结果",
        "rationale": "当前经历描述了动作，但没有说明产出或影响。",
        "actionLabel": "补充结果",
        "example": "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
        "riskFlags": [
          {
            "type": "needs_user_fact",
            "message": "结果数据必须由用户提供，Agent 不应编造。"
          }
        ]
      }
    ]
  },
  "usage": {
    "provider": "openai-compatible",
    "model": "deepseek-chat",
    "inputTokens": 620,
    "outputTokens": 180
  }
}
```

Supported suggestion severities:

```ts
type ResumeHelperSeverity = "high" | "medium" | "low";
```

Supported risk flag types:

```ts
type ResumeHelperRiskFlagType =
  | "needs_user_fact"
  | "possible_fabrication"
  | "too_little_context"
  | "formatting_risk";
```

## File Structure

Agent service:

| File | Responsibility |
| --- | --- |
| `apps/agent/src/resume-helpers.ts` | Helper IDs, request validation, prompt builder, provider response parser, OpenAI-compatible provider factory |
| `apps/agent/src/http.ts` | Route `POST /v1/resume/helpers/:helperId`, auth, resumeId match, rate limit, provider invocation |
| `apps/agent/src/index.ts` | Wire the resume helper provider into `createAgentServer` |
| `apps/agent/tests/resume-helpers.test.ts` | Unit tests for validation, prompt rules, parser behavior |
| `apps/agent/tests/http.test.ts` | Route tests for auth, scope, resume mismatch, provider missing, happy path |

Web:

| File | Responsibility |
| --- | --- |
| `lib/agent/client.ts` | Shared request/response types and `runResumeHelper()` client method |
| `app/api/agent/resume/helpers/[helperId]/route.ts` | Web BFF: session, ownership, request validation, Agent JWT signing, proxy |
| `tests/unit/agent-client.test.ts` | Client method tests |
| `tests/unit/agent-resume-helper-route.test.ts` | BFF auth/ownership/proxy/error tests |
| `lib/agent/resume-helper-context.ts` | Pure helpers that summarize RHF resume content into capped plain-text context |
| `tests/unit/agent-resume-helper-context.test.ts` | Context extraction and length cap tests |
| `components/agent/resume-helper-card.tsx` | Reusable suggestion card UI |
| `components/agent/resume-diagnose-button.tsx` | Toolbar/popover trigger for whole-resume diagnosis |
| `components/agent/section-helper-button.tsx` | Section header helper trigger for active section |
| `tests/unit/resume-helper-card.test.tsx` | UI render and dismiss tests |
| `tests/unit/resume-diagnose-button.test.tsx` | Request state and suggestion display tests |
| `app/(app)/resume/[id]/edit/editor-client.tsx` | Whole-resume diagnosis entry in the editor toolbar area |
| `components/editor/section-editor-header.tsx` | Section helper entry point beside each section add button |

Docs:

| File | Responsibility |
| --- | --- |
| `docs/agent/service-contracts.md` | Add Phase 2A JSON contract |
| `docs/agent/proto/intro_builder_agent_v1.proto` | Add `ResumeHelperService` draft |
| `docs/agent/frontend-integration.md` | Add concrete Phase 2A UI reuse notes |
| `docs/agent/assistant-ui-research.md` | Keep Phase 3 deferral note current |

## Task 1: Update Contracts Before Code

**Files:**

- Modify: `docs/agent/service-contracts.md`
- Modify: `docs/agent/proto/intro_builder_agent_v1.proto`
- Modify: `docs/agent/frontend-integration.md`
- Modify: `docs/agent/assistant-ui-research.md`

- [ ] **Step 1: Add the JSON contract to `docs/agent/service-contracts.md`**

Add this section after the rich text polish contract:

````markdown
## Resume Helper Contract

Phase 2A adds structured helper suggestions. It is not a chat interface and it does not write resume content.

### `POST /v1/resume/helpers/:helperId`

Supported helper IDs:

| Helper ID | Meaning |
| --- | --- |
| `resume-diagnose` | Diagnose whole-resume gaps and next edits |
| `section-next-steps` | Suggest next edits for one section |

Authentication: `Authorization: Bearer <agent-jwt>`, scope must be `resume:helper`. JWT `resumeId` must match request body `resumeId`.

Request:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "target": {
    "kind": "resume",
    "section": null,
    "fieldPath": null
  },
  "context": {
    "resumeTitle": "前端开发工程师",
    "completeness": {
      "overall": 68,
      "sections": [
        { "key": "experience", "label": "工作经历", "score": 7, "max": 10 }
      ]
    },
    "sections": [
      {
        "key": "experience",
        "label": "工作经历",
        "plainText": "负责业务系统前端开发，优化页面性能。"
      }
    ]
  },
  "intent": {
    "mode": "diagnose",
    "maxSuggestions": 5,
    "strategy": "star"
  }
}
```

Response:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "helperId": "resume-diagnose",
  "result": {
    "summary": "整体内容完整，但工作经历缺少可验证结果。",
    "suggestions": [
      {
        "id": "sug_experience_result",
        "section": "experience",
        "fieldPath": "experience",
        "severity": "high",
        "title": "为工作经历补充可验证结果",
        "rationale": "当前经历描述了动作，但没有说明产出或影响。",
        "actionLabel": "补充结果",
        "example": "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
        "riskFlags": [
          {
            "type": "needs_user_fact",
            "message": "结果数据必须由用户提供，Agent 不应编造。"
          }
        ]
      }
    ]
  },
  "usage": {
    "provider": "openai-compatible",
    "model": "deepseek-chat",
    "inputTokens": 620,
    "outputTokens": 180
  }
}
```

Rules:

- `resume-diagnose` accepts `target.kind=resume`.
- `section-next-steps` accepts `target.kind=section` and requires `target.section`.
- `context.sections[*].plainText` is capped by Web before forwarding and capped again by Agent validation.
- Agent suggestions cannot claim facts, numbers, technologies, companies, schools, awards, or outcomes not present in the provided context.
- Web displays suggestions and lets users edit manually. Phase 2A does not auto-apply generated patches.
````

- [ ] **Step 2: Add protobuf service draft**

Append these messages to `docs/agent/proto/intro_builder_agent_v1.proto`:

```proto
service ResumeHelperService {
  rpc RunResumeHelper(RunResumeHelperRequest) returns (RunResumeHelperResponse);
}

message RunResumeHelperRequest {
  string request_id = 1;
  string helper_id = 2;
  string resume_id = 3;
  string locale = 4;
  ResumeHelperTarget target = 5;
  ResumeHelperContext context = 6;
  ResumeHelperIntent intent = 7;
}

message ResumeHelperTarget {
  ResumeHelperTargetKind kind = 1;
  ResumeSection section = 2;
  string field_path = 3;
}

message ResumeHelperContext {
  string resume_title = 1;
  CompletenessSnapshot completeness = 2;
  repeated ResumeHelperSection sections = 3;
}

message CompletenessSnapshot {
  uint32 overall = 1;
  repeated CompletenessSection sections = 2;
}

message CompletenessSection {
  string key = 1;
  string label = 2;
  uint32 score = 3;
  uint32 max = 4;
}

message ResumeHelperSection {
  string key = 1;
  string label = 2;
  string plain_text = 3;
}

message ResumeHelperIntent {
  ResumeHelperMode mode = 1;
  uint32 max_suggestions = 2;
  PolishStrategy strategy = 3;
}

message RunResumeHelperResponse {
  string status = 1;
  string request_id = 2;
  string helper_id = 3;
  ResumeHelperResult result = 4;
  Usage usage = 5;
}

message ResumeHelperResult {
  string summary = 1;
  repeated ResumeHelperSuggestion suggestions = 2;
}

message ResumeHelperSuggestion {
  string id = 1;
  string section = 2;
  string field_path = 3;
  ResumeHelperSeverity severity = 4;
  string title = 5;
  string rationale = 6;
  string action_label = 7;
  string example = 8;
  repeated ResumeHelperRiskFlag risk_flags = 9;
}

message ResumeHelperRiskFlag {
  ResumeHelperRiskFlagType type = 1;
  string message = 2;
}

enum ResumeHelperTargetKind {
  RESUME_HELPER_TARGET_KIND_UNSPECIFIED = 0;
  RESUME_HELPER_TARGET_KIND_RESUME = 1;
  RESUME_HELPER_TARGET_KIND_SECTION = 2;
}

enum ResumeHelperMode {
  RESUME_HELPER_MODE_UNSPECIFIED = 0;
  RESUME_HELPER_MODE_DIAGNOSE = 1;
  RESUME_HELPER_MODE_NEXT_STEPS = 2;
}

enum ResumeHelperSeverity {
  RESUME_HELPER_SEVERITY_UNSPECIFIED = 0;
  RESUME_HELPER_SEVERITY_HIGH = 1;
  RESUME_HELPER_SEVERITY_MEDIUM = 2;
  RESUME_HELPER_SEVERITY_LOW = 3;
}

enum ResumeHelperRiskFlagType {
  RESUME_HELPER_RISK_FLAG_TYPE_UNSPECIFIED = 0;
  RESUME_HELPER_RISK_FLAG_TYPE_NEEDS_USER_FACT = 1;
  RESUME_HELPER_RISK_FLAG_TYPE_POSSIBLE_FABRICATION = 2;
  RESUME_HELPER_RISK_FLAG_TYPE_TOO_LITTLE_CONTEXT = 3;
  RESUME_HELPER_RISK_FLAG_TYPE_FORMATTING_RISK = 4;
}
```

- [ ] **Step 3: Update frontend integration notes**

Add Phase 2A notes to `docs/agent/frontend-integration.md`:

```markdown
### Phase 2A: Resume Helpers

Use `resume-diagnose` near `CompletenessScore` for whole-resume next actions. Use `section-next-steps` in section headers for targeted suggestions. The UI shows suggestion cards only; it does not apply generated patches to RHF in Phase 2A.
```

- [ ] **Step 4: Preserve assistant-ui deferral**

Add this sentence to the conclusion in `docs/agent/assistant-ui-research.md`:

```markdown
Phase 2A resume helpers still use local buttons and cards; assistant-ui remains reserved for Phase 3 because helpers do not need multi-turn message state.
```

- [ ] **Step 5: Commit the contract update**

Run:

```bash
git add docs/agent/service-contracts.md docs/agent/proto/intro_builder_agent_v1.proto docs/agent/frontend-integration.md docs/agent/assistant-ui-research.md
git commit -m "docs(agent): define resume helper contract"
```

## Task 2: Add Agent Resume Helper Domain Tests

**Files:**

- Create: `apps/agent/tests/resume-helpers.test.ts`
- Create: `apps/agent/src/resume-helpers.ts`

- [ ] **Step 1: Create failing tests**

Create `apps/agent/tests/resume-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildResumeHelperPrompt,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
} from "../src/resume-helpers";

describe("resume helper request validation", () => {
  it("accepts a resume diagnosis request", () => {
    const result = validateResumeHelperRequest("resume-diagnose", validResumeBody());

    expect(result).toMatchObject({
      ok: true,
      request: {
        helperId: "resume-diagnose",
        resumeId: "resume_abc",
        locale: "zh-CN",
        target: { kind: "resume" },
        intent: { mode: "diagnose", maxSuggestions: 5, strategy: "star" },
      },
    });
  });

  it("requires section target data for section-next-steps", () => {
    const body = validResumeBody({
      target: { kind: "resume", section: null, fieldPath: null },
      intent: { mode: "next_steps", maxSuggestions: 3, strategy: "star" },
    });

    const result = validateResumeHelperRequest("section-next-steps", body);

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "target.section is required for section-next-steps",
    });
  });

  it("rejects helper context that exceeds the plain text limit", () => {
    const result = validateResumeHelperRequest(
      "resume-diagnose",
      validResumeBody({
        context: {
          ...validResumeBody().context,
          sections: [
            {
              key: "experience",
              label: "工作经历",
              plainText: "x".repeat(12_001),
            },
          ],
        },
      }),
    );

    expect(result).toEqual({
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: "context plain text must be at most 12000 characters",
    });
  });
});

describe("resume helper prompt", () => {
  it("forbids fabricated facts and keeps STAR as suggestion guidance", () => {
    const validation = validateResumeHelperRequest("resume-diagnose", validResumeBody());
    if (!validation.ok) throw new Error("expected valid request");

    const prompt = buildResumeHelperPrompt({
      ...validation.request,
      requestId: "req_helper",
    });

    expect(prompt.system).toContain("不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果");
    expect(prompt.developer).toContain("输出必须是合法 JSON");
    expect(prompt.developer).toContain("STAR");
    expect(prompt.user).toContain("工作经历");
    expect(prompt.user).toContain("负责业务系统前端开发");
  });
});

describe("resume helper provider response parser", () => {
  it("parses structured suggestions", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({
        summary: "整体内容完整，但经历结果不足。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充经历结果",
            rationale: "当前只描述动作，没有说明影响。",
            actionLabel: "补充结果",
            example: "如果你有真实数据，可以补充性能、转化或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供。",
              },
            ],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        summary: "整体内容完整，但经历结果不足。",
        suggestions: [
          {
            id: "sug_experience_result",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充经历结果",
            rationale: "当前只描述动作，没有说明影响。",
            actionLabel: "补充结果",
            example: "如果你有真实数据，可以补充性能、转化或交付周期变化。",
            riskFlags: [
              {
                type: "needs_user_fact",
                message: "结果数据必须由用户提供。",
              },
            ],
          },
        ],
      },
    });
  });

  it("rejects suggestions with unsupported risk flags", () => {
    const parsed = parseResumeHelperProviderResponse(
      JSON.stringify({
        summary: "整体内容完整。",
        suggestions: [
          {
            id: "sug_bad",
            section: "experience",
            fieldPath: "experience",
            severity: "high",
            title: "补充结果",
            rationale: "缺少结果。",
            actionLabel: "补充结果",
            example: "",
            riskFlags: [{ type: "unknown", message: "bad" }],
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: false,
      message: "Provider riskFlags are invalid",
    });
  });
});

function validResumeBody(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    target: {
      kind: "resume",
      section: null,
      fieldPath: null,
    },
    context: {
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [
          { key: "experience", label: "工作经历", score: 7, max: 10 },
        ],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    intent: {
      mode: "diagnose",
      maxSuggestions: 5,
      strategy: "star",
    },
    ...overrides,
  };
}
```

- [ ] **Step 2: Add a minimal stub module**

Create `apps/agent/src/resume-helpers.ts`:

```ts
export function validateResumeHelperRequest(_helperId: string, _body: unknown) {
  return {
    ok: false,
    statusCode: 400,
    error: "bad_request",
    message: "resume helper red-test sentinel",
  } as const;
}

export function buildResumeHelperPrompt(_request: unknown) {
  return { system: "", developer: "", user: "" };
}

export function parseResumeHelperProviderResponse(_content: string) {
  return { ok: false, message: "resume helper parser red-test sentinel" } as const;
}
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/resume-helpers.test.ts
```

Expected: tests fail because the stub returns invalid validation and parser results.

## Task 3: Implement Agent Resume Helper Domain Module

**Files:**

- Modify: `apps/agent/src/resume-helpers.ts`
- Test: `apps/agent/tests/resume-helpers.test.ts`

- [ ] **Step 1: Replace the stub with types, validation, prompt builder, parser, and provider factory**

Implement `apps/agent/src/resume-helpers.ts` with these exported names:

```ts
import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentConfig } from "./config.js";
import type { AgentErrorCode } from "./errors.js";
import { RichTextPolishProviderError } from "./rich-text-polish.js";

export type ResumeHelperId = "resume-diagnose" | "section-next-steps";
export type ResumeHelperSection =
  | "summary"
  | "experience"
  | "projects"
  | "education"
  | "skills"
  | "research"
  | "custom";
export type ResumeHelperSeverity = "high" | "medium" | "low";
export type ResumeHelperRiskFlagType =
  | "needs_user_fact"
  | "possible_fabrication"
  | "too_little_context"
  | "formatting_risk";

export type ResumeHelperRequest = {
  requestId?: string;
  helperId: ResumeHelperId;
  resumeId: string;
  locale: "zh-CN";
  target:
    | { kind: "resume"; section: null; fieldPath: null }
    | { kind: "section"; section: ResumeHelperSection; fieldPath: string | null };
  context: {
    resumeTitle: string;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{ key: string; label: string; plainText: string }>;
  };
  intent: {
    mode: "diagnose" | "next_steps";
    maxSuggestions: number;
    strategy: "plain" | "star";
  };
};

export type ResumeHelperPrompt = {
  system: string;
  developer: string;
  user: string;
};

export type ResumeHelperSuggestion = {
  id: string;
  section: string;
  fieldPath: string;
  severity: ResumeHelperSeverity;
  title: string;
  rationale: string;
  actionLabel: string;
  example: string;
  riskFlags: Array<{ type: ResumeHelperRiskFlagType; message: string }>;
};

export type ResumeHelperResult = {
  summary: string;
  suggestions: ResumeHelperSuggestion[];
};

export type ResumeHelperUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export type ResumeHelperProvider = {
  run: (options: {
    request: ResumeHelperRequest;
    prompt: ResumeHelperPrompt;
    session: AuthenticatedAgentSession;
    requestId: string;
  }) => Promise<{ content: string; usage: ResumeHelperUsage }>;
};
```

Use the same provider request shape as `createOpenAICompatibleRichTextPolishProvider()`: `POST {modelBaseUrl}/chat/completions`, `response_format: { type: "json_object" }`, `thinking: { type: "disabled" }`, system+developer folded into the system role, and `provider_timeout` mapped to `RichTextPolishProviderError`.

- [ ] **Step 2: Enforce these validation constants**

Use these limits in `apps/agent/src/resume-helpers.ts`:

```ts
const MAX_CONTEXT_PLAIN_TEXT_LENGTH = 12_000;
const MAX_SECTION_TEXT_LENGTH = 4_000;
const MAX_SUGGESTIONS = 5;
```

Validation rules:

```ts
// helperId
// - must be "resume-diagnose" or "section-next-steps"
// locale
// - must be "zh-CN"
// resume-diagnose
// - requires target.kind === "resume"
// - coerces intent.mode to "diagnose" if absent
// section-next-steps
// - requires target.kind === "section"
// - requires target.section to be supported
// - coerces intent.mode to "next_steps" if absent
// context.sections
// - requires at least one section
// - total plain text length across sections <= 12000
// - each section plainText <= 4000
// intent.maxSuggestions
// - defaults to 5 for resume-diagnose
// - defaults to 3 for section-next-steps
// - must be 1..5
```

- [ ] **Step 3: Include the safety prompt text**

The prompt builder must include these exact Chinese safety constraints:

```ts
[
  "你是 intro-builder 的中文简历诊断助手。",
  "你的任务是基于用户提供的当前简历内容，给出可执行的简历改进建议。",
  "严格规则：",
  "1. 不得编造事实、数字、公司、学校、职位、技术栈、奖项或结果。",
  "2. 不得把建议写成已经发生的事实。",
  "3. 需要用户补充事实时，必须用 riskFlags 标记 needs_user_fact。",
  "4. 输出建议必须具体到 section 或 fieldPath，但不得直接要求 Agent 写入数据库。",
  "5. 输出必须是合法 JSON，不要 Markdown，不要解释过程。",
].join(\"\\n\")
```

Developer schema text:

```ts
[
  "输出 JSON schema：",
  "{\"summary\":\"string\",\"suggestions\":[{\"id\":\"string\",\"section\":\"string\",\"fieldPath\":\"string\",\"severity\":\"high|medium|low\",\"title\":\"string\",\"rationale\":\"string\",\"actionLabel\":\"string\",\"example\":\"string\",\"riskFlags\":[{\"type\":\"needs_user_fact|possible_fabrication|too_little_context|formatting_risk\",\"message\":\"string\"}]}]}",
  "suggestions 数量必须小于等于 intent.maxSuggestions。",
  "当 strategy=star 时，只能建议用户补充 Situation、Task、Action、Result 中缺失的信息；Result 必须由用户提供事实或数据。",
  "example 可以给写作方向，但不能伪造可量化结果。",
].join(\"\\n\")
```

- [ ] **Step 4: Run domain tests**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/resume-helpers.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the domain module**

Run:

```bash
git add apps/agent/src/resume-helpers.ts apps/agent/tests/resume-helpers.test.ts
git commit -m "feat(agent): add resume helper domain contract"
```

## Task 4: Add Agent HTTP Route Tests

**Files:**

- Modify: `apps/agent/tests/http.test.ts`
- Modify: `apps/agent/src/http.ts`

- [ ] **Step 1: Extend the HTTP test helpers**

In `apps/agent/tests/http.test.ts`, import the provider type:

```ts
import type { ResumeHelperProvider } from "../src/resume-helpers";
```

Extend `listenOnRandomPort()` options:

```ts
resumeHelperProvider?: ResumeHelperProvider;
```

Pass it to `createAgentServer()`:

```ts
resumeHelperProvider: options.resumeHelperProvider,
```

Add a fake provider:

```ts
class FakeResumeHelperProvider implements ResumeHelperProvider {
  readonly calls: Array<{
    request: Parameters<ResumeHelperProvider["run"]>[0]["request"];
    prompt: Parameters<ResumeHelperProvider["run"]>[0]["prompt"];
  }> = [];

  constructor(private readonly content: string) {}

  async run(options: Parameters<ResumeHelperProvider["run"]>[0]) {
    this.calls.push({ request: options.request, prompt: options.prompt });
    return {
      content: this.content,
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 620,
        outputTokens: 180,
      },
    };
  }
}
```

- [ ] **Step 2: Add a happy-path route test**

Append this test in the `describe("agent HTTP service", ...)` block:

```ts
it("returns structured resume helper suggestions from /v1/resume/helpers/:helperId", async () => {
  const provider = new FakeResumeHelperProvider(
    JSON.stringify({
      summary: "整体内容完整，但工作经历缺少可验证结果。",
      suggestions: [
        {
          id: "sug_experience_result",
          section: "experience",
          fieldPath: "experience",
          severity: "high",
          title: "为工作经历补充可验证结果",
          rationale: "当前经历描述了动作，但没有说明产出或影响。",
          actionLabel: "补充结果",
          example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
          riskFlags: [
            {
              type: "needs_user_fact",
              message: "结果数据必须由用户提供，Agent 不应编造。",
            },
          ],
        },
      ],
    }),
  );
  const server = await listenOnRandomPort({
    replayStore: new FakeReplayStore(),
    resumeHelperProvider: provider,
  });
  const token = await signAgentToken({
    sub: "user_123",
    resumeId: "resume_abc",
    scope: "resume:helper",
    jti: "jti_resume_helper_valid",
  });

  const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": "req-client-helper",
    },
    body: JSON.stringify(validResumeHelperBody()),
  });

  expect(response.status).toBe(200);
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]?.request.helperId).toBe("resume-diagnose");
  expect(provider.calls[0]?.prompt.system).toContain("不得编造事实");
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    requestId: "req-client-helper",
    helperId: "resume-diagnose",
    result: {
      summary: "整体内容完整，但工作经历缺少可验证结果。",
      suggestions: [
        {
          id: "sug_experience_result",
          section: "experience",
          fieldPath: "experience",
          severity: "high",
          title: "为工作经历补充可验证结果",
          rationale: "当前经历描述了动作，但没有说明产出或影响。",
          actionLabel: "补充结果",
          example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
          riskFlags: [
            {
              type: "needs_user_fact",
              message: "结果数据必须由用户提供，Agent 不应编造。",
            },
          ],
        },
      ],
    },
    usage: {
      provider: "fake-provider",
      model: "fake-model",
      inputTokens: 620,
      outputTokens: 180,
    },
  });
});
```

- [ ] **Step 3: Add auth and dependency tests**

Add these expected cases:

```ts
it("rejects resume helper tokens with the wrong scope", async () => {
  const server = await listenOnRandomPort({
    replayStore: new FakeReplayStore(),
    resumeHelperProvider: new FakeResumeHelperProvider("{}"),
  });
  const token = await signAgentToken({
    sub: "user_123",
    resumeId: "resume_abc",
    scope: "rich_text:polish",
    jti: "jti_helper_wrong_scope",
  });

  const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": "req-client-helper-scope",
    },
    body: JSON.stringify(validResumeHelperBody()),
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: "forbidden",
    message: "Token scope is not allowed for this route",
    requestId: "req-client-helper-scope",
  });
});

it("rejects resume helper requests whose resumeId does not match the JWT", async () => {
  const server = await listenOnRandomPort({
    replayStore: new FakeReplayStore(),
    resumeHelperProvider: new FakeResumeHelperProvider("{}"),
  });
  const token = await signAgentToken({
    sub: "user_123",
    resumeId: "resume_abc",
    scope: "resume:helper",
    jti: "jti_helper_resume_mismatch",
  });

  const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": "req-client-helper-resume",
    },
    body: JSON.stringify({
      ...validResumeHelperBody(),
      resumeId: "resume_other",
    }),
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: "forbidden",
    message: "Token resumeId does not match request resumeId",
    requestId: "req-client-helper-resume",
  });
});

it("returns dependency_unavailable when no resume helper provider is configured", async () => {
  const server = await listenOnRandomPort({
    replayStore: new FakeReplayStore(),
  });
  const token = await signAgentToken({
    sub: "user_123",
    resumeId: "resume_abc",
    scope: "resume:helper",
    jti: "jti_helper_no_provider",
  });

  const response = await fetch(server.url("/v1/resume/helpers/resume-diagnose"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-request-id": "req-client-helper-provider",
    },
    body: JSON.stringify(validResumeHelperBody()),
  });

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "dependency_unavailable",
    message: "Resume helper provider is not configured",
    requestId: "req-client-helper-provider",
    dependency: "provider",
  });
});
```

Add this helper in the test file:

```ts
function validResumeHelperBody() {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    target: {
      kind: "resume",
      section: null,
      fieldPath: null,
    },
    context: {
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [
          { key: "experience", label: "工作经历", score: 7, max: 10 },
        ],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    intent: {
      mode: "diagnose",
      maxSuggestions: 5,
      strategy: "star",
    },
  };
}
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/http.test.ts
```

Expected: tests fail until `createAgentServer()` supports `resumeHelperProvider` and the new route.

## Task 5: Implement Agent HTTP Route and Provider Wiring

**Files:**

- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/src/index.ts`
- Test: `apps/agent/tests/http.test.ts`

- [ ] **Step 1: Add the provider option to `CreateAgentServerOptions`**

In `apps/agent/src/http.ts`, import:

```ts
import {
  buildResumeHelperPrompt,
  createOpenAICompatibleResumeHelperProvider,
  parseResumeHelperProviderResponse,
  RichTextPolishProviderError,
  validateResumeHelperRequest,
  type ResumeHelperProvider,
} from "./resume-helpers.js";
```

If `RichTextPolishProviderError` remains exported only from `rich-text-polish.ts`, import it from there and do not duplicate the class.

Extend `CreateAgentServerOptions`:

```ts
resumeHelperProvider?: ResumeHelperProvider;
```

Thread `resumeHelperProvider` through `createAgentServer()` and `routeRequest()` in the same style as `richTextPolishProvider`.

- [ ] **Step 2: Add route matching**

In `routeRequest()`, add the resume helper branch before the final 404:

```ts
const resumeHelperMatch = url.pathname.match(/^\/v1\/resume\/helpers\/([^/]+)$/);
if (resumeHelperMatch) {
  if (method !== "POST") return methodNotAllowed(response, context, "POST");
  const helperId = decodeURIComponent(resumeHelperMatch[1]);

  const auth = await authenticateAgentRequest({
    authorizationHeader: headerValue(request.headers.authorization),
    expectedScope: "resume:helper",
    config,
    replayStore,
    now: now(),
  });

  if (!auth.ok) {
    logAuthFailure(auth, context, url.pathname, method);
    return sendError(response, auth.statusCode, context, {
      error: auth.error,
      message: auth.message,
      dependency: auth.dependency,
    });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    return sendError(response, 400, context, {
      error: "bad_request",
      message: body.message,
    });
  }

  const validation = validateResumeHelperRequest(helperId, body.value);
  if (!validation.ok) {
    return sendError(response, validation.statusCode, context, {
      error: validation.error,
      message: validation.message,
    });
  }

  if (auth.session.resumeId !== validation.request.resumeId) {
    return sendError(response, 403, context, {
      error: "forbidden",
      message: "Token resumeId does not match request resumeId",
    });
  }

  if (!resumeHelperProvider) {
    return sendError(response, 503, context, {
      error: "dependency_unavailable",
      message: "Resume helper provider is not configured",
      dependency: "provider",
    });
  }

  if (rateLimitStore) {
    try {
      const rateLimit = await checkRateLimit({
        redis: rateLimitStore,
        scope: "resume:helper",
        identityHash: hashIdentity(auth.session.userId),
        limit: config.rateLimitMaxRequests,
        windowSeconds: config.rateLimitWindowSeconds,
        now: now(),
      });
      if (!rateLimit.allowed) {
        return sendError(response, 429, context, {
          error: "rate_limited",
          message: "Too many resume helper requests",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        });
      }
    } catch {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: "Rate limit store is unavailable",
        dependency: "redis",
      });
    }
  }

  const prompt = buildResumeHelperPrompt({
    ...validation.request,
    requestId: context.requestId,
  });

  try {
    const providerResult = await resumeHelperProvider.run({
      request: validation.request,
      prompt,
      session: auth.session,
      requestId: context.requestId,
    });
    const parsed = parseResumeHelperProviderResponse(providerResult.content);
    if (!parsed.ok) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: parsed.message,
        dependency: "provider",
      });
    }

    return sendJson(
      response,
      200,
      {
        status: "ok",
        requestId: context.requestId,
        helperId: validation.request.helperId,
        result: parsed.result,
        usage: providerResult.usage,
      },
      context,
    );
  } catch (error) {
    if (error instanceof RichTextPolishProviderError) {
      return sendError(response, error.code === "provider_timeout" ? 504 : 503, context, {
        error: error.code,
        message: error.message,
        dependency: error.code === "dependency_unavailable" ? "provider" : undefined,
      });
    }
    return sendError(response, 500, context, {
      error: "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
    });
  }
}
```

- [ ] **Step 3: Wire provider in `apps/agent/src/index.ts`**

Add import:

```ts
import { createOpenAICompatibleResumeHelperProvider } from "./resume-helpers.js";
```

Pass the provider:

```ts
resumeHelperProvider: createOpenAICompatibleResumeHelperProvider(config),
```

- [ ] **Step 4: Run Agent tests**

Run:

```bash
pnpm --filter @intro-builder/agent test
```

Expected: Agent tests pass.

- [ ] **Step 5: Commit Agent route implementation**

Run:

```bash
git add apps/agent/src/http.ts apps/agent/src/index.ts apps/agent/src/resume-helpers.ts apps/agent/tests/http.test.ts
git commit -m "feat(agent): add resume helper endpoint"
```

## Task 6: Add Web Agent Client Support

**Files:**

- Modify: `lib/agent/client.ts`
- Modify: `tests/unit/agent-client.test.ts`

- [ ] **Step 1: Add client types**

Add these types to `lib/agent/client.ts`:

```ts
export type ResumeHelperId = "resume-diagnose" | "section-next-steps";

export type ResumeHelperRequest = {
  resumeId: string;
  locale: "zh-CN";
  target:
    | { kind: "resume"; section: null; fieldPath: null }
    | {
        kind: "section";
        section:
          | "summary"
          | "experience"
          | "projects"
          | "education"
          | "skills"
          | "research"
          | "custom";
        fieldPath: string | null;
      };
  context: {
    resumeTitle: string;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{ key: string; label: string; plainText: string }>;
  };
  intent: {
    mode: "diagnose" | "next_steps";
    maxSuggestions: number;
    strategy: "plain" | "star";
  };
};

export type ResumeHelperResponse = {
  status: "ok";
  requestId: string;
  helperId: ResumeHelperId;
  result: {
    summary: string;
    suggestions: Array<{
      id: string;
      section: string;
      fieldPath: string;
      severity: "high" | "medium" | "low";
      title: string;
      rationale: string;
      actionLabel: string;
      example: string;
      riskFlags: Array<{
        type:
          | "needs_user_fact"
          | "possible_fabrication"
          | "too_little_context"
          | "formatting_risk";
        message: string;
      }>;
    }>;
  };
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};
```

- [ ] **Step 2: Add client method**

Extend `AgentClient`:

```ts
runResumeHelper: (options: {
  token: string;
  helperId: ResumeHelperId;
  request: ResumeHelperRequest;
  requestId?: string;
}) => Promise<AgentClientResult<ResumeHelperResponse>>;
```

Add implementation in `createAgentClient()`:

```ts
runResumeHelper({ token, helperId, request, requestId = createRequestId() }) {
  return requestJson<ResumeHelperResponse>({
    baseUrl,
    path: `/v1/resume/helpers/${encodeURIComponent(helperId)}`,
    method: "POST",
    token,
    requestId,
    body: request,
    timeoutMs,
    fetchFn,
  });
},
```

- [ ] **Step 3: Add client test**

Add this test to `tests/unit/agent-client.test.ts`:

```ts
it("posts resume helper requests with bearer token and request id", async () => {
  const fetchMock = vi.fn(async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        status: "ok",
        requestId: "req_agent_helper",
        helperId: "resume-diagnose",
        result: {
          summary: "整体内容完整，但工作经历缺少可验证结果。",
          suggestions: [],
        },
        usage: {
          provider: "fake-provider",
          model: "fake-model",
          inputTokens: 620,
          outputTokens: 180,
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_agent_helper",
        },
      },
    );
  });
  const client = createAgentClient({
    baseUrl: "https://agent.test/intro-builder/agent",
    fetchFn: fetchMock as unknown as typeof fetch,
    createRequestId: () => "req_web_helper",
  });
  const request = {
    resumeId: "resume_abc",
    locale: "zh-CN" as const,
    target: { kind: "resume" as const, section: null, fieldPath: null },
    context: {
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ],
    },
    intent: { mode: "diagnose" as const, maxSuggestions: 5, strategy: "star" as const },
  };

  const result = await client.runResumeHelper({
    token: "jwt-token",
    helperId: "resume-diagnose",
    request,
  });

  expect(result.requestId).toBe("req_agent_helper");
  expect(result.data.result.summary).toContain("工作经历");
  expect(fetchMock).toHaveBeenCalledWith(
    "https://agent.test/intro-builder/agent/v1/resume/helpers/resume-diagnose",
    expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer jwt-token",
        "X-Request-Id": "req_web_helper",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    }),
  );
});
```

- [ ] **Step 4: Run client tests**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit client support**

Run:

```bash
git add lib/agent/client.ts tests/unit/agent-client.test.ts
git commit -m "feat(agent): add web resume helper client"
```

## Task 7: Add Web BFF Route

**Files:**

- Create: `app/api/agent/resume/helpers/[helperId]/route.ts`
- Create: `tests/unit/agent-resume-helper-route.test.ts`

- [ ] **Step 1: Write route tests**

Create `tests/unit/agent-resume-helper-route.test.ts` using the same mock pattern as `tests/unit/agent-rich-text-polish-route.test.ts`.

Required cases:

```ts
it("requires a Web user session", async () => {
  (currentUserId as unknown as Mock).mockResolvedValue(null);

  const response = await POST(jsonRequest(validBody()), {
    params: Promise.resolve({ helperId: "resume-diagnose" }),
  });

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "未登录" });
});

it("requires the resume to belong to the Web user", async () => {
  (currentUserId as unknown as Mock).mockResolvedValue("user_123");
  (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue(null);

  const response = await POST(jsonRequest(validBody()), {
    params: Promise.resolve({ helperId: "resume-diagnose" }),
  });

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "简历不存在" });
});

it("signs a resume:helper token and proxies the request to Agent", async () => {
  (currentUserId as unknown as Mock).mockResolvedValue("user_123");
  (db.query.resumes.findFirst as unknown as Mock).mockResolvedValue({
    id: "resume_abc",
  });
  (signAgentToken as unknown as Mock).mockResolvedValue({
    token: "signed-helper-token",
    expiresAt: new Date("2026-06-08T08:02:00.000Z"),
  });
  const runResumeHelper = vi.fn().mockResolvedValue({
    requestId: "req_agent_helper",
    data: {
      status: "ok",
      requestId: "req_agent_helper",
      helperId: "resume-diagnose",
      result: {
        summary: "整体内容完整，但工作经历缺少可验证结果。",
        suggestions: [],
      },
      usage: {
        provider: "fake-provider",
        model: "fake-model",
        inputTokens: 620,
        outputTokens: 180,
      },
    },
  });
  (createAgentClient as unknown as Mock).mockReturnValue({ runResumeHelper });

  const response = await POST(jsonRequest(validBody()), {
    params: Promise.resolve({ helperId: "resume-diagnose" }),
  });

  expect(response.status).toBe(200);
  expect(signAgentToken).toHaveBeenCalledWith({
    userId: "user_123",
    resumeId: "resume_abc",
    scope: "resume:helper",
  });
  expect(runResumeHelper).toHaveBeenCalledWith({
    token: "signed-helper-token",
    helperId: "resume-diagnose",
    request: validBody(),
  });
});
```

- [ ] **Step 2: Implement route**

Create `app/api/agent/resume/helpers/[helperId]/route.ts`:

```ts
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  AgentClientError,
  createAgentClient,
  type ResumeHelperId,
  type ResumeHelperRequest,
} from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ helperId: string }>;
};

export async function POST(req: Request, context: RouteContext) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { helperId: rawHelperId } = await context.params;
  if (!isSupportedHelperId(rawHelperId)) {
    return Response.json({ error: "helperId 不支持" }, { status: 404 });
  }

  const parsed = await readResumeHelperRequest(req, rawHelperId);
  if (!parsed.ok) {
    return Response.json({ error: parsed.message }, { status: 400 });
  }

  const resume = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, parsed.request.resumeId), eq(resumes.userId, userId)),
  });
  if (!resume) {
    return Response.json({ error: "简历不存在" }, { status: 404 });
  }

  try {
    const signed = await signAgentToken({
      userId,
      resumeId: parsed.request.resumeId,
      scope: "resume:helper",
    });
    const agent = createAgentClient();
    const result = await agent.runResumeHelper({
      token: signed.token,
      helperId: rawHelperId,
      request: parsed.request,
    });

    return Response.json({
      status: "ok",
      tokenExpiresAt: signed.expiresAt.toISOString(),
      requestId: result.requestId,
      helperId: result.data.helperId,
      result: result.data.result,
      usage: result.data.usage,
    });
  } catch (error) {
    if (error instanceof AgentClientError) {
      return Response.json(
        {
          error: "Agent 服务暂不可用",
          code: error.error,
          requestId: error.requestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.statusCode },
      );
    }

    console.error("[agent-resume-helper] route failed:", error);
    return Response.json({ error: "Agent 服务暂不可用" }, { status: 503 });
  }
}
```

Implement local validation helpers in the same file with these user-facing messages:

```ts
"请求体必须是合法 JSON"
"请求体必须是对象"
"缺少 resumeId"
"locale 必须是 zh-CN"
"target 不合法"
"context 不合法"
"intent 不合法"
"section-next-steps 需要 target.section"
"context.sections 不能为空"
"context plainText 不能超过 12000 字"
```

- [ ] **Step 3: Run route tests**

Run:

```bash
pnpm vitest run tests/unit/agent-resume-helper-route.test.ts
```

Expected: route tests pass.

- [ ] **Step 4: Commit BFF route**

Run:

```bash
git add app/api/agent/resume/helpers/[helperId]/route.ts tests/unit/agent-resume-helper-route.test.ts
git commit -m "feat(agent): add resume helper web route"
```

## Task 8: Add Resume Helper Context Builder

**Files:**

- Create: `lib/agent/resume-helper-context.ts`
- Create: `tests/unit/agent-resume-helper-context.test.ts`

- [ ] **Step 1: Write context builder tests**

Create `tests/unit/agent-resume-helper-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildResumeHelperContext } from "@/lib/agent/resume-helper-context";
import type { ResumeContent } from "@/lib/resume-schema";

describe("buildResumeHelperContext", () => {
  it("extracts capped plain text from resume content", () => {
    const context = buildResumeHelperContext(validContent(), {
      overall: 68,
      sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
    });

    expect(context).toEqual({
      resumeTitle: "前端开发工程师",
      completeness: {
        overall: 68,
        sections: [{ key: "experience", label: "工作经历", score: 7, max: 10 }],
      },
      sections: expect.arrayContaining([
        {
          key: "experience",
          label: "工作经历",
          plainText: "负责业务系统前端开发，优化页面性能。",
        },
      ]),
    });
  });

  it("caps total context plain text to 12000 characters", () => {
    const long = "x".repeat(13_000);
    const context = buildResumeHelperContext(
      {
        ...validContent(),
        basics: { ...validContent().basics, summary: long },
      },
      { overall: 20, sections: [] },
    );

    const total = context.sections.reduce((sum, section) => sum + section.plainText.length, 0);
    expect(total).toBeLessThanOrEqual(12_000);
  });
});

function validContent(): ResumeContent {
  return {
    basics: {
      name: "张三",
      title: "前端开发工程师",
      email: "zhangsan@example.com",
      phone: "13800000000",
      location: "上海",
      website: "",
      summary: "3 年前端开发经验。",
      photo: "",
    },
    experience: [
      {
        id: "exp_1",
        company: "示例公司",
        title: "前端开发",
        start: "2023-01",
        end: "",
        current: true,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "负责业务系统前端开发，优化页面性能。" }],
            },
          ],
        },
      },
    ],
    education: [],
    projects: [],
    skills: { type: "doc", content: [] },
    custom: [],
  };
}
```

- [ ] **Step 2: Implement context builder**

Create `lib/agent/resume-helper-context.ts`:

```ts
import { getSectionMeta } from "@/lib/section-meta";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TipTapJSON } from "@/lib/tiptap-types";

const MAX_TOTAL_CONTEXT_CHARS = 12_000;
const MAX_SECTION_CHARS = 4_000;

export type ResumeHelperContextSnapshot = {
  resumeTitle: string;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
  sections: Array<{ key: string; label: string; plainText: string }>;
};

export function buildResumeHelperContext(
  content: ResumeContent,
  completeness: ResumeHelperContextSnapshot["completeness"],
): ResumeHelperContextSnapshot {
  const sections = [
    section("summary", getSectionMeta("summary").label, content.basics.summary ?? ""),
    ...content.experience.map((item, index) =>
      section("experience", `${getSectionMeta("experience").label} ${index + 1}`, tiptapText(item.content)),
    ),
    ...content.projects.map((item, index) =>
      section("projects", `${getSectionMeta("projects").label} ${index + 1}`, tiptapText(item.content)),
    ),
    section("skills", getSectionMeta("skills").label, tiptapText(content.skills)),
    ...content.custom.map((item) =>
      section(item.id || "custom", item.title || getSectionMeta(item.id).label, tiptapText(item.content)),
    ),
  ].filter((item) => item.plainText.trim() !== "");

  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const capped = [];
  for (const item of sections) {
    if (remaining <= 0) break;
    const text = item.plainText.slice(0, Math.min(MAX_SECTION_CHARS, remaining));
    remaining -= text.length;
    capped.push({ ...item, plainText: text });
  }

  return {
    resumeTitle: content.basics.title?.trim() || "未填写目标岗位",
    completeness,
    sections: capped,
  };
}

function section(key: string, label: string, plainText: string) {
  return { key, label, plainText: plainText.trim() };
}

function tiptapText(doc: TipTapJSON | undefined): string {
  if (!doc) return "";
  return nodeText(doc).replace(/\s+/g, " ").trim();
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (!Array.isArray(record.content)) return "";
  return record.content.map(nodeText).filter(Boolean).join(" ");
}
```

- [ ] **Step 3: Run context tests**

Run:

```bash
pnpm vitest run tests/unit/agent-resume-helper-context.test.ts
```

Expected: context tests pass.

- [ ] **Step 4: Commit context builder**

Run:

```bash
git add lib/agent/resume-helper-context.ts tests/unit/agent-resume-helper-context.test.ts
git commit -m "feat(agent): build resume helper context"
```

## Task 9: Add Minimal Web UI Entrypoints

**Files:**

- Create: `components/agent/resume-helper-card.tsx`
- Create: `components/agent/resume-diagnose-button.tsx`
- Create: `components/agent/section-helper-button.tsx`
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx`
- Modify: `components/editor/section-editor-header.tsx`
- Modify: the section editor files that already pass `resumeId` and section metadata, such as `components/editor/experience-editor.tsx`, `components/editor/projects-editor.tsx`, `components/editor/education-editor.tsx`, `components/editor/custom-section-editor.tsx`, and `components/editor/research-editor.tsx`
- Create: `tests/unit/resume-helper-card.test.tsx`
- Create: `tests/unit/resume-diagnose-button.test.tsx`

- [ ] **Step 1: Add suggestion card component test**

Create `tests/unit/resume-helper-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResumeHelperCard } from "@/components/agent/resume-helper-card";

describe("ResumeHelperCard", () => {
  it("renders a structured suggestion without an apply button", () => {
    render(
      <ResumeHelperCard
        suggestion={{
          id: "sug_experience_result",
          section: "experience",
          fieldPath: "experience",
          severity: "high",
          title: "为工作经历补充可验证结果",
          rationale: "当前经历描述了动作，但没有说明产出或影响。",
          actionLabel: "补充结果",
          example: "如果原文已有真实数据，可以补充加载速度、转化率或交付周期变化。",
          riskFlags: [
            {
              type: "needs_user_fact",
              message: "结果数据必须由用户提供。",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("为工作经历补充可验证结果")).toBeInTheDocument();
    expect(screen.getByText("当前经历描述了动作，但没有说明产出或影响。")).toBeInTheDocument();
    expect(screen.getByText("结果数据必须由用户提供。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /应用/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement card component**

Create `components/agent/resume-helper-card.tsx`:

```tsx
"use client";

import { AlertTriangle, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

export type ResumeHelperSuggestionView = {
  id: string;
  section: string;
  fieldPath: string;
  severity: "high" | "medium" | "low";
  title: string;
  rationale: string;
  actionLabel: string;
  example: string;
  riskFlags: Array<{ type: string; message: string }>;
};

export function ResumeHelperCard({
  suggestion,
}: {
  suggestion: ResumeHelperSuggestionView;
}) {
  return (
    <article className="rounded-xl border bg-background p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <CircleDot
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            suggestion.severity === "high"
              ? "text-rose-500"
              : suggestion.severity === "medium"
                ? "text-amber-500"
                : "text-emerald-500",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{suggestion.rationale}</p>
          {suggestion.example && (
            <p className="mt-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs leading-5 text-foreground">
              {suggestion.example}
            </p>
          )}
        </div>
      </div>
      {suggestion.riskFlags.length > 0 && (
        <div className="mt-2 space-y-1">
          {suggestion.riskFlags.map((flag) => (
            <p
              key={`${flag.type}:${flag.message}`}
              className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{flag.message}</span>
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 3: Implement diagnose button as a popover**

Create `components/agent/resume-diagnose-button.tsx`. The component reads current RHF content with `useFormContext<ResumeContent>()` and `useCompletenessScore()`, builds a capped context with `buildResumeHelperContext()`, and posts to the Web BFF. Keep all request state local to the button so typing in the editor is unaffected.

```ts
type ResumeDiagnoseButtonProps = {
  resumeId: string;
};
```

Required behavior:

- `POST /api/agent/resume/helpers/resume-diagnose`.
- Loading label is `诊断中`.
- Idle label is `AI 诊断`.
- Request body uses `target: { kind: "resume", section: null, fieldPath: null }`.
- Request body uses `intent: { mode: "diagnose", maxSuggestions: 5, strategy: "star" }`.
- Success renders `summary` plus a `ResumeHelperCard` list.
- Failure renders `Agent 服务暂不可用，请稍后再试`.
- There is no apply button in Phase 2A.

Use a gradient text/icon style consistent with the existing `AI 润色` button in `components/editor/rich-text-editor.tsx`: gradient applies to text and icon, not to the button background.

- [ ] **Step 4: Implement section helper button**

Create `components/agent/section-helper-button.tsx`. The component accepts the target section and a prebuilt section context from the caller. It must not subscribe to the full form inside every collapsed section unless that section helper is rendered.

```ts
type SectionHelperButtonProps = {
  resumeId: string;
  section: "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom";
  fieldPath: string | null;
  label: string;
  plainText: string;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
};
```

Required behavior:

- `POST /api/agent/resume/helpers/section-next-steps`.
- Loading label is `分析中`.
- Idle `aria-label` is `AI 建议`.
- Request body uses `target: { kind: "section", section, fieldPath }`.
- Request body uses `intent: { mode: "next_steps", maxSuggestions: 3, strategy: section === "experience" || section === "projects" ? "star" : "plain" }`.
- Success renders `summary` plus a `ResumeHelperCard` list.
- Failure renders `Agent 服务暂不可用，请稍后再试`.
- No automatic RHF writeback.

- [ ] **Step 5: Wire whole-resume diagnosis in `EditorClient`**

Modify `app/(app)/resume/[id]/edit/editor-client.tsx`:

- Import `ResumeDiagnoseButton`.
- Render it beside `CompletenessScore` in the editor toolbar/header area where save/export/template controls already live.
- Pass only `resumeId={id}`.
- Do not pass `content` into `LivePreview`; the button reads RHF state through the existing `FormProvider`.
- Do not import assistant-ui.

- [ ] **Step 6: Wire section suggestions through section headers**

Modify `components/editor/section-editor-header.tsx`:

- Add optional prop `helper?: React.ReactNode`.
- Render `helper` immediately before the existing add button when present.
- Keep the existing add button behavior unchanged.

Modify section editors:

- `components/editor/experience-editor.tsx`: pass a `SectionHelperButton` for `experience` using joined plain text from visible experience item content.
- `components/editor/projects-editor.tsx`: pass a `SectionHelperButton` for `projects`.
- `components/editor/education-editor.tsx`: pass a `SectionHelperButton` for `education`.
- `components/editor/custom-section-editor.tsx`: pass a `SectionHelperButton` for custom sections that have text content.
- `components/editor/research-editor.tsx`: pass a `SectionHelperButton` for `research`.

If extracting TipTap plain text in multiple editors becomes repetitive, add a small pure helper to `lib/agent/resume-helper-context.ts` and test it in `tests/unit/agent-resume-helper-context.test.ts`.

- [ ] **Step 7: Run UI tests**

Run:

```bash
pnpm vitest run tests/unit/resume-helper-card.test.tsx tests/unit/resume-diagnose-button.test.tsx
```

Expected: UI tests pass.

- [ ] **Step 8: Commit UI slice**

Run:

```bash
git add components/agent components/editor tests/unit/resume-helper-card.test.tsx tests/unit/resume-diagnose-button.test.tsx
git commit -m "feat(editor): show agent resume helper suggestions"
```

## Task 10: Verification and Manual Smoke

**Files:**

- Modify: `docs/agent/README.md`
- Modify: `docs/agent/code-map.md`
- Modify: `docs/agent/implementation-roadmap.md`

- [ ] **Step 1: Update docs after implementation**

Record that Phase 2A exists in `docs/agent/README.md`, `docs/agent/code-map.md`, and `docs/agent/implementation-roadmap.md`. The docs must mention:

```text
POST /v1/resume/helpers/:helperId
POST /api/agent/resume/helpers/[helperId]
Supported helper IDs: resume-diagnose, section-next-steps
Phase 2A returns suggestions only and does not auto-apply generated patches.
```

- [ ] **Step 2: Run local gates**

Run:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Expected:

```text
All commands complete successfully.
```

- [ ] **Step 3: Run Agent-specific build**

Run:

```bash
pnpm agent:build
```

Expected:

```text
@intro-builder/agent builds successfully.
```

- [ ] **Step 4: Manual local smoke**

Start Web and Agent locally with Redis running:

```bash
redis-cli ping
pnpm --filter @intro-builder/agent dev
pnpm dev
```

Smoke path:

1. Open a resume editor page.
2. Trigger `AI 诊断`.
3. Confirm a summary and suggestion cards render.
4. Confirm typing in the editor still works while the Agent result is visible.
5. Confirm no suggestion is written into the editor automatically.
6. Trigger a section helper and confirm the section-scoped suggestions render.
7. Stop Agent and confirm the UI shows a Chinese unavailable message without breaking editor typing, preview, or autosave.

- [ ] **Step 5: Commit docs and verification notes**

Run:

```bash
git add docs/agent/README.md docs/agent/code-map.md docs/agent/implementation-roadmap.md
git commit -m "docs(agent): document resume helper phase"
```

## Final Definition of Done

- `docs/agent/service-contracts.md` and protobuf draft describe the Phase 2A contract.
- Agent route `POST /v1/resume/helpers/:helperId` accepts only `resume:helper` tokens.
- Web route `POST /api/agent/resume/helpers/[helperId]` verifies session and resume ownership before proxying.
- Agent rate limits helper calls using Redis with scope `resume:helper`.
- Provider prompt forbids fabricated facts and marks missing user facts with `needs_user_fact`.
- Web UI shows suggestion cards only and does not auto-apply generated patches.
- Existing OCR, import resume, and AI parsing code paths are untouched.
- assistant-ui is not imported or used in Phase 2A.
- `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`, and `pnpm agent:build` pass.

## Handoff Notes

- Phase 2A is deliberately suggestion-only for stability. It validates the resume-level Agent contract without adding per-section writeback complexity.
- Phase 2B can add content-generating helpers after this slice proves stable. That separate plan should reuse the same endpoint and add helper-specific apply/cancel semantics.
- Phase 3 assistant-ui panel should start only after helper contracts and stream protocol decisions are stable.
