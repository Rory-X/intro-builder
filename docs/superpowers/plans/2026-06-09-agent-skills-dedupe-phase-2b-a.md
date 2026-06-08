# Agent Skills Dedupe Phase 2B-A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first apply-capable resume helper: `skills:dedupe`, which proposes a structure-preserving skills section cleanup and applies it only after user confirmation.

**Architecture:** Keep the existing Web -> Agent boundary: Web owns Auth.js, resume ownership, React Hook Form state, preview, autosave, and final writeback; Agent owns prompt/provider/rate limit/JWT validation and returns a proposed replacement only. This slice extends the existing resume helper endpoint instead of adding assistant-ui, and reuses the rich-text structure-preservation strategy so TipTap lists remain lists after AI output.

**Tech Stack:** Next.js 16 App Router, React 19, React Hook Form, TipTap JSON, Node/TypeScript Agent service, Redis rate limit/replay guard, OpenAI-compatible provider, Vitest/jsdom.

---

## Product Decision

Recommended next slice: **Phase 2B-A: `skills:dedupe` with explicit apply/cancel**.

Why this before `summary:suggest`, `experience:quantify`, `project:impact`, or assistant-ui:

| Option | Value | Risk | Decision |
| --- | --- | --- | --- |
| `skills:dedupe` first | Validates safe AI writeback on one bounded rich-text field | Low factual risk; main risk is preserving list formatting | Do now |
| `summary:suggest` next | High perceived value, creates content | Higher fabrication risk; needs resume-wide fact grounding | Defer to Phase 2B-B |
| `experience:quantify` / `project:impact` next | Strong job-search value | Must not invent metrics; needs question-first flow | Defer to Phase 2B-C |
| assistant-ui panel | Unlocks multi-turn Agent | More runtime, stream, tool-call, bundle complexity | Keep Phase 3 |

`skills:dedupe` output is not autonomous editing. The user sees a before/after preview and must click apply. Cancel leaves RHF content untouched.

## Non-Negotiable Boundaries

- Existing OCR, import resume, and AI parsing remain out of scope.
- Agent never connects to Postgres and never writes `resume.content`.
- Web verifies user session and resume ownership before signing a short-lived `resume:helper` JWT.
- Web forwards the current RHF `skills` TipTap JSON snapshot because autosave can lag behind editor state.
- Agent must not return arbitrary TipTap JSON authored by the model.
- Agent asks the model for ordered text blocks, then code clones the original TipTap tree and replaces text block content.
- If text block counts do not match, Agent returns a structured provider parse error instead of unsafe replacement.
- Web applies replacement only after user confirmation and then dispatches `resume:flush-autosave`.
- assistant-ui remains Phase 3 and is not imported into this button-based helper.

## Target User Experience

In the Skills section:

1. User clicks `AI 去重归类`.
2. Button sends current `skills` TipTap JSON and plain text to Web BFF.
3. Web validates auth/ownership and proxies to Agent with `resume:helper` token.
4. Agent returns a replacement proposal with summary, change summary, risk flags, plain text preview, and structure-preserving `replacementTiptapJson`.
5. Web shows before/after rows in a compact card.
6. User clicks `应用到技能` to set RHF `skills`.
7. Web dispatches `resume:flush-autosave`.

Failure behavior:

- Missing provider / timeout / rate limit: show existing non-blocking error state.
- Too little skills text: return suggestion-only message with `too_little_context`; no apply button.
- Unsafe parse / formatting mismatch: show error and keep original content.

## Contract Extension

Extend the existing endpoint:

```text
POST /v1/resume/helpers/:helperId
Authorization: Bearer <agent-jwt with scope resume:helper>
```

New helper ID:

```ts
type ResumeHelperId =
  | "resume-diagnose"
  | "section-next-steps"
  | "skills:dedupe";
```

Request extension for apply-capable rich-text helpers:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "target": {
    "kind": "section",
    "section": "skills",
    "fieldPath": "skills"
  },
  "context": {
    "resumeTitle": "前端开发工程师",
    "completeness": {
      "overall": 72,
      "sections": [
        { "key": "skills", "label": "技能", "score": 6, "max": 10 }
      ]
    },
    "sections": [
      {
        "key": "skills",
        "label": "技能",
        "plainText": "React、React.js、Next.js、Node、Node.js、Docker"
      }
    ]
  },
  "content": {
    "format": "tiptap_json",
    "plainText": "React、React.js、Next.js、Node、Node.js、Docker",
    "tiptapJson": {
      "type": "doc",
      "content": [
        {
          "type": "bulletList",
          "content": [
            {
              "type": "listItem",
              "content": [
                {
                  "type": "paragraph",
                  "content": [{ "type": "text", "text": "React、React.js、Next.js" }]
                }
              ]
            }
          ]
        }
      ]
    }
  },
  "intent": {
    "mode": "dedupe",
    "maxSuggestions": 3,
    "strategy": "plain"
  }
}
```

Response union:

```ts
type ResumeHelperResponse = {
  status: "ok";
  requestId: string;
  helperId: ResumeHelperId;
  result: ResumeHelperSuggestionResult | ResumeHelperReplacementResult;
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};

type ResumeHelperSuggestionResult = {
  kind: "suggestions";
  summary: string;
  suggestions: ResumeHelperSuggestion[];
};

type ResumeHelperReplacementResult = {
  kind: "replacement";
  summary: string;
  replacement: {
    format: "tiptap_json";
    polishedText: string;
    replacementTiptapJson: unknown;
    changeSummary: string;
    riskFlags: Array<{
      type: "possible_fabrication" | "changed_entity" | "too_little_context" | "formatting_risk";
      message: string;
    }>;
  };
};
```

Provider JSON schema for `skills:dedupe`:

```json
{
  "summary": "技能项存在重复别名，已按前端/后端/工具归类。",
  "replacement": {
    "polishedText": "前端：React、Next.js\n后端：Node.js\n工具：Docker",
    "polishedBlocks": [
      "前端：React、Next.js",
      "后端：Node.js",
      "工具：Docker"
    ],
    "changeSummary": "合并 React/React.js 与 Node/Node.js，并按类别整理。",
    "riskFlags": []
  }
}
```

## File Structure

Agent service:

| File | Responsibility |
| --- | --- |
| `apps/agent/src/tiptap-replacement.ts` | Shared TipTap text block extraction and safe block replacement |
| `apps/agent/tests/tiptap-replacement.test.ts` | Preserve paragraphs, bullet lists, ordered lists, marks, and attrs |
| `apps/agent/src/rich-text-polish.ts` | Reuse shared TipTap replacement helper |
| `apps/agent/src/resume-helpers.ts` | Add `skills:dedupe` validation, prompt, parser, replacement result |
| `apps/agent/src/http.ts` | Route `skills:dedupe` through existing provider/rate-limit/auth path |
| `apps/agent/tests/resume-helpers.test.ts` | Domain tests for skills dedupe validation and parsing |
| `apps/agent/tests/http.test.ts` | Route tests for happy path, missing content, format mismatch, provider failure |

Web:

| File | Responsibility |
| --- | --- |
| `lib/agent/client.ts` | Add `skills:dedupe` request/response union types |
| `app/api/agent/resume/helpers/[helperId]/route.ts` | Accept optional `content`, preserve auth/ownership/signing |
| `tests/unit/agent-client.test.ts` | Client request and replacement response tests |
| `tests/unit/agent-resume-helper-route.test.ts` | BFF validation and proxy tests for `skills:dedupe` |
| `components/agent/resume-helper-replacement-card.tsx` | Reusable before/after replacement preview and apply/cancel UI |
| `components/agent/skills-dedupe-button.tsx` | Skills helper trigger, request state, apply handler |
| `components/editor/skills-editor.tsx` | Add `AI 去重归类` entry beside existing skills helper/polish path |
| `tests/unit/resume-helper-replacement-card.test.tsx` | Preview, risk flags, apply/cancel tests |
| `tests/unit/skills-dedupe-button.test.tsx` | Request, apply, autosave flush, error tests |

Docs:

| File | Responsibility |
| --- | --- |
| `docs/agent/service-contracts.md` | Add Phase 2B-A replacement result contract |
| `docs/agent/proto/intro_builder_agent_v1.proto` | Mirror replacement result draft |
| `docs/agent/frontend-integration.md` | Record UI reuse and apply/cancel semantics |
| `docs/agent/implementation-roadmap.md` | Mark Phase 2B-A plan and defer remaining helpers |

## Task 1: Contract And Documentation Update

**Files:**

- Modify: `docs/agent/service-contracts.md`
- Modify: `docs/agent/proto/intro_builder_agent_v1.proto`
- Modify: `docs/agent/frontend-integration.md`
- Modify: `docs/agent/implementation-roadmap.md`

- [ ] **Step 1: Update JSON contract**

Add `skills:dedupe` to the Resume Helper Contract in `docs/agent/service-contracts.md`:

```markdown
| `skills:dedupe` | Deduplicate and regroup the skills section with explicit user confirmation |
```

Add this rule block:

```markdown
`skills:dedupe` is the first Phase 2B apply-capable helper. It requires `target.kind=section`, `target.section=skills`, `target.fieldPath=skills`, and `content.format=tiptap_json`. The Agent must return `result.kind=replacement`; Web must show preview and apply only after user confirmation.
```

- [ ] **Step 2: Add protobuf draft messages**

Append these messages to `docs/agent/proto/intro_builder_agent_v1.proto` near the existing resume helper draft:

```proto
message ResumeHelperContent {
  string format = 1;
  string plain_text = 2;
  string tiptap_json = 3;
}

message ResumeHelperReplacement {
  string format = 1;
  string polished_text = 2;
  string replacement_tiptap_json = 3;
  string change_summary = 4;
  repeated ResumeHelperRiskFlag risk_flags = 5;
}

message ResumeHelperResult {
  string kind = 1;
  string summary = 2;
  repeated ResumeHelperSuggestion suggestions = 3;
  ResumeHelperReplacement replacement = 4;
}
```

- [ ] **Step 3: Record frontend behavior**

Add to `docs/agent/frontend-integration.md`:

```markdown
Phase 2B-A adds a reusable replacement preview card for apply-capable helpers. The Skills section uses it for `skills:dedupe`; user confirmation writes to RHF `skills`, dispatches `resume:flush-autosave`, and leaves preview/autosave ownership in Web.
```

- [ ] **Step 4: Update roadmap**

In `docs/agent/implementation-roadmap.md`, change Phase 2 status to:

```markdown
Status: Phase 2A deployed; Phase 2B-A planned as `skills:dedupe` apply/cancel MVP.
```

- [ ] **Step 5: Verify docs diff**

Run:

```bash
git diff -- docs/agent/service-contracts.md docs/agent/proto/intro_builder_agent_v1.proto docs/agent/frontend-integration.md docs/agent/implementation-roadmap.md
```

Expected: only contract/docs updates, no code changes.

## Task 2: Extract Shared TipTap Replacement Helpers

**Files:**

- Create: `apps/agent/src/tiptap-replacement.ts`
- Create: `apps/agent/tests/tiptap-replacement.test.ts`
- Modify: `apps/agent/src/rich-text-polish.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/agent/tests/tiptap-replacement.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  applyTipTapTextBlocks,
  extractTipTapTextBlocks,
} from "../src/tiptap-replacement.js";

describe("tiptap replacement helpers", () => {
  it("extracts list item text blocks in order", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "React、React.js" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Node、Node.js" }] }] },
          ],
        },
      ],
    };

    expect(extractTipTapTextBlocks(doc)).toEqual(["React、React.js", "Node、Node.js"]);
  });

  it("replaces text while preserving list structure and marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "React、React.js", marks: [{ type: "bold" }] }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = applyTipTapTextBlocks(doc, ["前端：React、Next.js"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc).toMatchObject({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "前端：React、Next.js", marks: [{ type: "bold" }] }],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("rejects mismatched block counts", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "React" }] }] };

    expect(applyTipTapTextBlocks(doc, ["前端：React", "工具：Docker"])).toEqual({
      ok: false,
      message: "Expected 1 text blocks but received 2 replacements",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/tiptap-replacement.test.ts
```

Expected: FAIL because `apps/agent/src/tiptap-replacement.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `apps/agent/src/tiptap-replacement.ts`:

```ts
export type TipTapNode = {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  marks?: unknown;
  content?: TipTapNode[];
  [key: string]: unknown;
};

export type ApplyTipTapTextBlocksResult =
  | { ok: true; doc: unknown }
  | { ok: false; message: string };

export function extractTipTapTextBlocks(value: unknown): string[] {
  const blocks: string[] = [];
  if (!isNode(value)) return blocks;
  collectTextBlocks(value, blocks);
  return blocks;
}

export function applyTipTapTextBlocks(
  value: unknown,
  replacements: string[],
): ApplyTipTapTextBlocksResult {
  if (!isNode(value)) return { ok: false, message: "TipTap JSON must be an object" };

  const blockCount = extractTipTapTextBlocks(value).length;
  if (blockCount !== replacements.length) {
    return {
      ok: false,
      message: `Expected ${blockCount} text blocks but received ${replacements.length} replacements`,
    };
  }

  let index = 0;
  const doc = replaceInNode(value, () => replacements[index++] ?? "");
  return { ok: true, doc };
}

function collectTextBlocks(node: TipTapNode, blocks: string[]): void {
  if (node.type === "paragraph") {
    blocks.push(collectInlineText(node));
    return;
  }

  for (const child of node.content ?? []) {
    if (isNode(child)) collectTextBlocks(child, blocks);
  }
}

function collectInlineText(node: TipTapNode): string {
  return (node.content ?? [])
    .map((child) => (isNode(child) && typeof child.text === "string" ? child.text : ""))
    .join("");
}

function replaceInNode(node: TipTapNode, nextText: () => string): TipTapNode {
  if (node.type !== "paragraph") {
    return {
      ...node,
      ...(Array.isArray(node.content)
        ? { content: node.content.map((child) => (isNode(child) ? replaceInNode(child, nextText) : child)) }
        : {}),
    };
  }

  const originalTextNode = (node.content ?? []).find((child) => isNode(child) && typeof child.text === "string");
  const textNode: TipTapNode = {
    type: "text",
    text: nextText(),
    ...(isNode(originalTextNode) && originalTextNode.marks ? { marks: originalTextNode.marks } : {}),
  };

  return {
    ...node,
    content: textNode.text === "" ? [] : [textNode],
  };
}

function isNode(value: unknown): value is TipTapNode {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Reuse helper in rich-text polish**

In `apps/agent/src/rich-text-polish.ts`, remove local duplicated TipTap extraction/replacement helpers and import:

```ts
import {
  applyTipTapTextBlocks,
  extractTipTapTextBlocks,
} from "./tiptap-replacement.js";
```

Keep existing rich-text polish behavior unchanged.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/tiptap-replacement.test.ts apps/agent/tests/rich-text-polish.test.ts
```

Expected: PASS.

## Task 3: Add Agent Domain Support For `skills:dedupe`

**Files:**

- Modify: `apps/agent/src/resume-helpers.ts`
- Modify: `apps/agent/tests/resume-helpers.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add tests to `apps/agent/tests/resume-helpers.test.ts`:

```ts
it("accepts skills:dedupe with skills target and TipTap content", () => {
  const result = validateResumeHelperRequest("skills:dedupe", {
    resumeId: "resume_1",
    locale: "zh-CN",
    target: { kind: "section", section: "skills", fieldPath: "skills" },
    context: minimalHelperContext("React、React.js"),
    content: {
      format: "tiptap_json",
      plainText: "React、React.js",
      tiptapJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "React、React.js" }] }] },
    },
    intent: { mode: "dedupe", maxSuggestions: 3, strategy: "plain" },
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.request.helperId).toBe("skills:dedupe");
  expect(result.request.intent.mode).toBe("dedupe");
});

it("rejects skills:dedupe for non-skills target", () => {
  const result = validateResumeHelperRequest("skills:dedupe", {
    resumeId: "resume_1",
    locale: "zh-CN",
    target: { kind: "section", section: "experience", fieldPath: "experience.0.content" },
    context: minimalHelperContext("React"),
    content: { format: "tiptap_json", plainText: "React", tiptapJson: { type: "doc", content: [] } },
    intent: { mode: "dedupe", maxSuggestions: 3, strategy: "plain" },
  });

  expect(result).toMatchObject({ ok: false, message: "skills:dedupe requires target.section=skills" });
});

it("parses a skills replacement response into structure-preserving TipTap JSON", () => {
  const result = parseResumeHelperProviderResponse(
    JSON.stringify({
      summary: "技能已去重并按类别整理。",
      replacement: {
        polishedText: "前端：React、Next.js",
        polishedBlocks: ["前端：React、Next.js"],
        changeSummary: "合并 React/React.js。",
        riskFlags: [],
      },
    }),
    {
      helperId: "skills:dedupe",
      tiptapJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "React、React.js" }] }] },
    },
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.result.kind).toBe("replacement");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/resume-helpers.test.ts
```

Expected: FAIL because `skills:dedupe`, `intent.mode=dedupe`, and replacement parsing are unsupported.

- [ ] **Step 3: Extend types and validation**

In `apps/agent/src/resume-helpers.ts`:

```ts
export type ResumeHelperId =
  | "resume-diagnose"
  | "section-next-steps"
  | "skills:dedupe";

export type ResumeHelperIntentMode = "diagnose" | "next_steps" | "dedupe";

export type ResumeHelperRequest = {
  // existing fields
  content?: {
    format: "tiptap_json";
    plainText: string;
    tiptapJson: unknown;
  };
};
```

Validation rules:

```ts
if (helperId === "skills:dedupe") {
  if (target.value.kind !== "section" || target.value.section !== "skills") {
    return badRequest("skills:dedupe requires target.section=skills");
  }
  if (target.value.fieldPath !== "skills") {
    return badRequest("skills:dedupe requires target.fieldPath=skills");
  }
  if (!isRecord(body.content)) return badRequest("content is required");
  if (body.content.format !== "tiptap_json") return badRequest("content.format must be tiptap_json");
}
```

- [ ] **Step 4: Add prompt rules**

For `skills:dedupe`, build a specialized prompt section:

```ts
const skillsDedupeRules = [
  "skills:dedupe 的目标是合并重复技能、规范别名、按类别整理技能表达。",
  "不得新增用户没有提供的技能、工具、证书或熟练度。",
  "React 和 React.js 可视为同一技能；Node 和 Node.js 可视为同一技能。",
  "不要给技能补熟练程度，如 精通/熟悉/掌握，除非原文已有。",
  "当 content.format=tiptap_json 时，必须输出 replacement.polishedBlocks，数量必须等于 textBlockCount。",
  "不得自行添加 Markdown 列表符号或编号；保留原 TipTap 列表结构由系统完成。",
];
```

- [ ] **Step 5: Parse replacement result**

Extend `parseResumeHelperProviderResponse()` to accept an options object:

```ts
export function parseResumeHelperProviderResponse(
  content: string,
  options: { helperId?: ResumeHelperId; tiptapJson?: unknown } = {},
): ResumeHelperParseResult
```

If `options.helperId === "skills:dedupe"`, parse `replacement.polishedBlocks`, call `applyTipTapTextBlocks(options.tiptapJson, polishedBlocks)`, and return:

```ts
{
  kind: "replacement",
  summary,
  replacement: {
    format: "tiptap_json",
    polishedText,
    replacementTiptapJson,
    changeSummary,
    riskFlags,
  },
}
```

- [ ] **Step 6: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/resume-helpers.test.ts
```

Expected: PASS.

## Task 4: Wire Agent HTTP Route

**Files:**

- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/tests/http.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `apps/agent/tests/http.test.ts`:

```ts
it("runs skills:dedupe and returns replacement result", async () => {
  const provider: ResumeHelperProvider = {
    run: vi.fn(async () => ({
      content: JSON.stringify({
        summary: "技能已去重。",
        replacement: {
          polishedText: "前端：React、Next.js",
          polishedBlocks: ["前端：React、Next.js"],
          changeSummary: "合并重复技能。",
          riskFlags: [],
        },
      }),
      usage: { provider: "test", model: "test-model", inputTokens: 10, outputTokens: 8 },
    })),
  };

  const server = createAgentServer({
    config: testConfig(),
    resumeHelperProvider: provider,
    verifyAgentToken: async () => ({
      subject: "user_1",
      resumeId: "resume_1",
      scope: "resume:helper",
      expiresAt: new Date(Date.now() + 60_000),
      jti: "jti_1",
    }),
    rateLimiter: allowAllRateLimiter,
  });

  const response = await server.fetch(new Request("http://agent.test/v1/resume/helpers/skills:dedupe", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(skillsDedupeRequestBody()),
  }));

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.kind).toBe("replacement");
  expect(body.result.replacement.replacementTiptapJson).toBeTruthy();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/http.test.ts
```

Expected: FAIL until route passes TipTap JSON into parser.

- [ ] **Step 3: Pass parser options**

In `apps/agent/src/http.ts`, when parsing provider response for resume helpers:

```ts
const parsed = parseResumeHelperProviderResponse(providerResult.content, {
  helperId: request.helperId,
  tiptapJson: request.content?.tiptapJson,
});
```

- [ ] **Step 4: Verify rate limit still runs**

Add one assertion in existing rate-limit test:

```ts
expect(rateLimiter.check).toHaveBeenCalledWith(expect.objectContaining({
  scope: "resume:helper",
}));
```

Keep helper-specific splitting as a follow-up if current rate limiter cannot include helper ID without changing its public contract.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @intro-builder/agent vitest run apps/agent/tests/http.test.ts
```

Expected: PASS.

## Task 5: Extend Web Client And BFF

**Files:**

- Modify: `lib/agent/client.ts`
- Modify: `app/api/agent/resume/helpers/[helperId]/route.ts`
- Modify: `tests/unit/agent-client.test.ts`
- Modify: `tests/unit/agent-resume-helper-route.test.ts`

- [ ] **Step 1: Write failing client test**

Add to `tests/unit/agent-client.test.ts`:

```ts
it("posts skills:dedupe content to the Agent helper endpoint", async () => {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({
    status: "ok",
    requestId: "req_helper",
    helperId: "skills:dedupe",
    result: {
      kind: "replacement",
      summary: "技能已去重。",
      replacement: {
        format: "tiptap_json",
        polishedText: "前端：React",
        replacementTiptapJson: { type: "doc", content: [] },
        changeSummary: "合并重复技能。",
        riskFlags: [],
      },
    },
    usage: { provider: "test", model: "test", inputTokens: 1, outputTokens: 1 },
  }), { status: 200, headers: { "content-type": "application/json" } }));

  const client = createAgentClient({ baseUrl: "https://agent.test/intro-builder/agent", fetchFn, createRequestId: () => "req_helper" });
  await client.runResumeHelper({
    token: "jwt",
    helperId: "skills:dedupe",
    request: skillsDedupeWebRequest(),
  });

  expect(fetchFn).toHaveBeenCalledWith(
    "https://agent.test/intro-builder/agent/v1/resume/helpers/skills%3Adedupe",
    expect.objectContaining({ method: "POST" }),
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-resume-helper-route.test.ts
```

Expected: FAIL because `"skills:dedupe"` and `content` are unsupported in Web types/route.

- [ ] **Step 3: Extend Web types**

In `lib/agent/client.ts`:

```ts
export type ResumeHelperId =
  | "resume-diagnose"
  | "section-next-steps"
  | "skills:dedupe";

export type ResumeHelperRequest = {
  // existing fields
  content?: {
    format: "tiptap_json";
    plainText: string;
    tiptapJson: unknown;
  };
  intent: {
    mode: "diagnose" | "next_steps" | "dedupe";
    maxSuggestions: number;
    strategy: "plain" | "star";
  };
};
```

Update `ResumeHelperResponse.result` to the union in the Contract Extension section.

- [ ] **Step 4: Extend Web BFF validation**

In `app/api/agent/resume/helpers/[helperId]/route.ts`, allow `skills:dedupe` only with:

```ts
helperId === "skills:dedupe"
body.target?.kind === "section"
body.target?.section === "skills"
body.target?.fieldPath === "skills"
body.content?.format === "tiptap_json"
```

Return `400` with `"请求参数无效"` for invalid combinations.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-resume-helper-route.test.ts
```

Expected: PASS.

## Task 6: Add Skills Dedupe UI

**Files:**

- Create: `components/agent/resume-helper-replacement-card.tsx`
- Create: `components/agent/skills-dedupe-button.tsx`
- Modify: `components/editor/skills-editor.tsx`
- Create: `tests/unit/resume-helper-replacement-card.test.tsx`
- Create: `tests/unit/skills-dedupe-button.test.tsx`

- [ ] **Step 1: Write replacement card test**

Create `tests/unit/resume-helper-replacement-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ResumeHelperReplacementCard } from "@/components/agent/resume-helper-replacement-card";

describe("ResumeHelperReplacementCard", () => {
  it("shows change summary and applies only when clicked", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <ResumeHelperReplacementCard
        beforeText="React、React.js"
        replacement={{
          polishedText: "前端：React",
          changeSummary: "合并重复技能。",
          riskFlags: [],
        }}
        onApply={onApply}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("合并重复技能。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "应用到简历" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement replacement card**

Create `components/agent/resume-helper-replacement-card.tsx`:

```tsx
"use client";

import { AlertTriangle, Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ResumeHelperReplacementView = {
  polishedText: string;
  changeSummary: string;
  riskFlags: Array<{ type: string; message: string }>;
};

export function ResumeHelperReplacementCard({
  beforeText,
  replacement,
  onApply,
  onCancel,
}: {
  beforeText: string;
  replacement: ResumeHelperReplacementView;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <article className="rounded-xl border bg-background p-3 shadow-sm">
      <p className="text-sm font-semibold text-foreground">AI 建议修改</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{replacement.changeSummary}</p>
      <div className="mt-3 grid gap-2 text-xs leading-5">
        <div className="rounded-lg bg-muted/50 p-2">
          <p className="mb-1 font-medium text-muted-foreground">当前</p>
          <p className="whitespace-pre-wrap text-foreground">{beforeText}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="mb-1 font-medium text-emerald-700 dark:text-emerald-300">建议</p>
          <p className="whitespace-pre-wrap text-foreground">{replacement.polishedText}</p>
        </div>
      </div>
      {replacement.riskFlags.map((flag) => (
        <p key={`${flag.type}:${flag.message}`} className="mt-2 flex gap-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{flag.message}</span>
        </p>
      ))}
      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          取消
        </Button>
        <Button type="button" size="sm" onClick={onApply}>
          <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          应用到简历
        </Button>
      </div>
    </article>
  );
}
```

- [ ] **Step 3: Write skills button test**

Create `tests/unit/skills-dedupe-button.test.tsx` with mocked `fetch`:

```tsx
it("applies replacement and flushes autosave after confirmation", async () => {
  const dispatchSpy = vi.spyOn(window, "dispatchEvent");
  global.fetch = vi.fn(async () => new Response(JSON.stringify({
    status: "ok",
    requestId: "req_1",
    helperId: "skills:dedupe",
    result: {
      kind: "replacement",
      summary: "技能已去重。",
      replacement: {
        format: "tiptap_json",
        polishedText: "前端：React",
        replacementTiptapJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "前端：React" }] }] },
        changeSummary: "合并重复技能。",
        riskFlags: [],
      },
    },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  renderSkillsDedupeButtonWithForm({ skillsText: "React、React.js" });

  await userEvent.click(screen.getByRole("button", { name: /AI 去重归类/ }));
  await userEvent.click(await screen.findByRole("button", { name: "应用到简历" }));

  expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "resume:flush-autosave" }));
});
```

- [ ] **Step 4: Implement `SkillsDedupeButton`**

Create `components/agent/skills-dedupe-button.tsx`:

```tsx
"use client";

import { Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { useFormContext } from "react-hook-form";

import { ResumeHelperReplacementCard } from "@/components/agent/resume-helper-replacement-card";
import { Button } from "@/components/ui/button";
import { buildResumeHelperContext, tiptapPlainText } from "@/lib/agent/resume-helper-context";
import type { ResumeContent } from "@/lib/resume-schema";

export function SkillsDedupeButton({ resumeId }: { resumeId: string }) {
  const form = useFormContext<ResumeContent>();
  const [isPending, startTransition] = useTransition();
  const [replacement, setReplacement] = useState<{
    polishedText: string;
    replacementTiptapJson: unknown;
    changeSummary: string;
    riskFlags: Array<{ type: string; message: string }>;
  } | null>(null);
  const skills = form.watch("skills");
  const beforeText = tiptapPlainText(skills);

  function run() {
    startTransition(async () => {
      const response = await fetch("/api/agent/resume/helpers/skills%3Adedupe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resumeId,
          locale: "zh-CN",
          target: { kind: "section", section: "skills", fieldPath: "skills" },
          context: buildResumeHelperContext(form.getValues(), { targetSection: "skills" }),
          content: { format: "tiptap_json", plainText: beforeText, tiptapJson: skills },
          intent: { mode: "dedupe", maxSuggestions: 3, strategy: "plain" },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "AI 去重暂不可用");
      if (body.result?.kind === "replacement") setReplacement(body.result.replacement);
    });
  }

  function apply() {
    if (!replacement) return;
    form.setValue("skills", replacement.replacementTiptapJson as ResumeContent["skills"], { shouldDirty: true });
    setReplacement(null);
    window.dispatchEvent(new Event("resume:flush-autosave"));
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" size="sm" onClick={run} disabled={isPending || beforeText.trim().length === 0}>
        <Sparkles className="mr-1 h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
        AI 去重归类
      </Button>
      {replacement ? (
        <ResumeHelperReplacementCard
          beforeText={beforeText}
          replacement={replacement}
          onApply={apply}
          onCancel={() => setReplacement(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Integrate into skills editor**

In `components/editor/skills-editor.tsx`, render the new button inside the open section body, near `RichTextEditor`:

```tsx
{resumeId ? <SkillsDedupeButton resumeId={resumeId} /> : null}
```

Place it above the editor so the user sees the action before editing raw skills text.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm vitest run tests/unit/resume-helper-replacement-card.test.tsx tests/unit/skills-dedupe-button.test.tsx
```

Expected: PASS.

## Task 7: Final Verification And Manual Smoke

**Files:**

- No new files.

- [ ] **Step 1: Run targeted Agent tests**

```bash
pnpm --filter @intro-builder/agent test
```

Expected: PASS.

- [ ] **Step 2: Run targeted Web tests**

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-resume-helper-route.test.ts tests/unit/resume-helper-replacement-card.test.tsx tests/unit/skills-dedupe-button.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full gates**

```bash
pnpm verify
pnpm agent:build
```

Expected: both commands exit 0. Existing lint warnings may remain warnings only.

- [ ] **Step 4: Manual local smoke**

Start Web and Agent with real local provider env:

```bash
pnpm agent:dev
pnpm dev
```

Smoke:

1. Open `/resume/<id>/edit`.
2. Add duplicated skills like `React、React.js、Next.js、Node、Node.js`.
3. Click `AI 去重归类`.
4. Confirm preview keeps list/paragraph structure.
5. Click `应用到简历`.
6. Confirm preview updates.
7. Confirm autosave runs after apply.

- [ ] **Step 5: Post-merge production smoke**

After PR merge and CD:

```bash
curl -fsS https://api.rory-x.me/intro-builder/agent/health
curl -fsS https://api.rory-x.me/intro-builder/agent/ready
```

Then test the Web UI with a logged-in user and a resume that has duplicated skills.

## Deferred Work

- `summary:suggest`: needs resume-wide grounding and apply/cancel for summary field.
- `experience:quantify`: should likely be question-first when metrics are missing.
- `project:impact`: same fabrication risk as experience metrics.
- `skills:dedupe` structured skill chips: wait until product decides whether skills should remain rich text or become typed tags.
- assistant-ui Agent panel: remains Phase 3 after button-based helpers prove the tool/action model.

## Self-Review Notes

- Spec coverage: covers contract, Agent parser/route, Web client/BFF, UI apply/cancel, verification, and deployment smoke.
- Placeholder scan: no unfinished placeholder markers; deferred work is explicitly scoped out.
- Type consistency: `skills:dedupe`, `result.kind="replacement"`, `content.format="tiptap_json"`, and `resume:helper` are consistent across Agent, Web, docs, and tests.
- Scope check: one helper plus shared TipTap utility extraction; intentionally does not implement all Phase 2B helpers.
