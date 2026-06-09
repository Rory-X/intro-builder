# Agent Mode assistant-ui Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first shippable Agent Mode: the desktop editor toolbar can switch the left editor column into an assistant-ui Agent panel, run one resume workflow, show tool reasoning, and apply basic resume edit patches only after explicit user confirmation.

**Architecture:** Web remains the authority for Auth.js session, resume ownership, React Hook Form state, preview, autosave, and confirmed writeback. The Agent microservice owns `POST /v1/agent/messages`, prompt/tool planning, provider calls, Redis-backed replay/rate limits, and returns structured messages plus proposed patches. The first runtime is assistant-ui `LocalRuntime` or a thin custom adapter in Web, calling the Web BFF `POST /api/agent/messages`; streaming/DataStream is deferred until the JSON contract proves stable.

**Tech Stack:** Next.js 16 App Router, React 19, React Hook Form, assistant-ui React runtime, TypeScript, Vitest, Node HTTP Agent service, OpenAI-compatible provider, Redis rate limit/replay guard.

## Current Status — 2026-06-09

Phase 3A is implemented in the current development branch as the approved Agent Mode
left-column replacement:

- `components/agent/agent-panel.tsx` uses assistant-ui `ThreadPrimitive` and
  `ComposerPrimitive`; it no longer keeps a parallel textarea/message state for the
  visible chat thread.
- `components/agent/agent-runtime-provider.tsx` uses assistant-ui `LocalRuntime`
  and adapts runs to Web BFF `POST /api/agent/messages`.
- Preset workflows call `useThreadRuntime().append(...)` and pass
  `workflowId` through `runConfig.custom`, so workflow chips and free-form composer
  sends share the same assistant-ui runtime path.
- Tool calls and `ResumePatch` cards remain product UI owned by Web; patches only
  write to RHF after the user clicks `应用`.
- Browser manual smoke in the Codex in-app browser was blocked by the browser URL
  policy for the local app. The smoke checklist is covered by automated tests for
  Agent Mode toggle, preview preservation, assistant-ui composer/thread send,
  workflow BFF request shape, tool/patch card rendering, confirmed RHF writeback,
  autosave flush dispatch, and unsaved editor value preservation when switching back.

---

## Non-Negotiable Boundaries

- This slice is only for new Agent capabilities. Existing OCR, resume import, and AI parsing are not migrated and are not part of this microservice work.
- The Agent service must not connect to Postgres and must not persist resume content.
- The Agent service can propose `ResumePatch` objects, but Web is the only place that can apply them to React Hook Form.
- No Agent-generated change may write to RHF until the user clicks an explicit `应用` action.
- The right `LivePreview` remains visible in desktop Agent Mode and still updates only from RHF.
- assistant-ui is only used for Phase 3 Agent panel; it is not used for single rich-text polish buttons.
- The first implementation must include the most basic resume modification tools for Agent reasoning, not just generic chat:
  - `inspect_resume`
  - `propose_rich_text_rewrite`
  - `propose_summary_rewrite`
  - `propose_bullet_rewrite`
  - `draft_section_item`

## File Structure

### Docs and Contracts

- Modify: `docs/agent/service-contracts.md`
  - Add `POST /v1/agent/messages` request/response contract.
  - Define `AgentMessage`, `AgentToolCall`, `ResumePatch`, and confirmation semantics.
- Modify: `docs/agent/proto/intro_builder_agent_v1.proto`
  - Add draft `AgentMessageService` and message shapes to keep the proto contract aligned with HTTP JSON.
- Modify: `docs/agent/frontend-integration.md`
  - Replace the old right-side Sheet recommendation with the approved A方案: Agent Mode replaces the left editor panel while preview remains visible.
- Modify: `docs/agent/implementation-roadmap.md`
  - Update Phase 3 deliverables and exit gates to mention the basic resume modification tools.
- Modify: `docs/agent/code-map.md`
  - Add the new Phase 3 files after implementation.

### Shared Web Types and Context

- Create: `lib/agent/agent-message-contract.ts`
  - Browser-safe shared TypeScript types for Web route, Agent panel, tool cards, and tests.
  - No server-only imports.
- Create: `lib/agent/chat-context.ts`
  - Build a capped Agent chat context from current RHF `ResumeContent`.
  - Reuse `tiptapPlainText` from `lib/agent/resume-helper-context.ts`.
- Modify: `lib/agent/resume-helper-context.ts`
  - Export the existing cap constants if needed by `chat-context.ts`.
- Modify: `lib/agent/client.ts`
  - Add `sendAgentMessage()` for Web server code to call Agent `POST /v1/agent/messages`.

### Agent Service

- Create: `apps/agent/src/agent-tools.ts`
  - Define basic tool names, tool input validation, tool result schemas, and `ResumePatch` validation.
  - Tools are reasoning tools that return proposed patches, not write tools.
- Create: `apps/agent/src/agent-messages.ts`
  - Validate request body.
  - Build prompts for workflow/chat mode.
  - Parse provider JSON response into assistant message, visible tool calls, and proposed patches.
  - Provide a deterministic fallback provider for tests.
- Modify: `apps/agent/src/http.ts`
  - Add `POST /v1/agent/messages`.
  - Require Agent JWT scope `agent:chat`.
  - Apply Redis rate limit with scope `agent:chat`.
- Modify: `apps/agent/src/index.ts`
  - Wire OpenAI-compatible Agent message provider into `createAgentServer()`.
- Modify: `apps/agent/src/config.ts`
  - Reuse existing model envs; do not add provider-specific Web envs.

### Web BFF

- Create: `app/api/agent/messages/route.ts`
  - Next.js 16 route handler using `POST`.
  - Validate Auth.js session or existing dev bypass pattern.
  - Validate resume ownership on the server.
  - Sign short-lived Agent JWT with scope `agent:chat`.
  - Proxy request to Agent with request id propagation.
  - Return structured JSON to the browser.

### Agent UI

- Create: `components/agent/agent-mode-toggle.tsx`
  - Toolbar button with selected state.
  - Text/icon gradient only; no gradient background.
- Create: `components/agent/agent-panel.tsx`
  - Desktop left-column panel shell, workflow chips, assistant-ui thread/composer area.
  - Does not own resume content state.
- Create: `components/agent/agent-runtime-provider.tsx`
  - assistant-ui runtime adapter that calls `/api/agent/messages`.
  - Translates assistant-ui messages into the Web BFF contract.
- Create: `components/agent/agent-preset-workflows.tsx`
  - Workflow chips:
    - `诊断整份简历`
    - `目标岗位匹配`
    - `经历 STAR 优化`
    - `终检导出前检查`
- Create: `components/agent/agent-tool-card.tsx`
  - Human-readable tool call/result card.
- Create: `components/agent/agent-confirmation-card.tsx`
  - Shows proposed `ResumePatch` changes and `应用` / `忽略`.
  - Calls a Web-owned apply callback.
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx`
  - Add `agentMode` state.
  - Add `AgentModeToggle` to toolbar.
  - Replace left editor content with `AgentPanel` while keeping `FormProvider` mounted.
  - Disable/hide resize handle while Agent Mode is active in Phase 3A.
  - Pass `resumeId`, current title/template id, `form.getValues`, `form.setValue`, and an autosave flush helper to the panel.

### Tests

- Create: `apps/agent/tests/agent-tools.test.ts`
- Create: `apps/agent/tests/agent-messages.test.ts`
- Modify: `apps/agent/tests/http.test.ts`
- Create: `tests/unit/agent-chat-context.test.ts`
- Modify: `tests/unit/agent-client.test.ts`
- Create: `tests/unit/agent-messages-route.test.ts`
- Create: `tests/unit/agent-panel.test.tsx`
- Create: `tests/unit/editor-client-agent-mode.test.tsx`

---

## Contract Shape

Use this exact JSON shape in docs and tests before implementation.

### Web BFF Request

```ts
export type AgentMessageRequest = {
  resumeId: string;
  locale: "zh-CN";
  workflowId:
    | "resume-diagnose"
    | "target-role-match"
    | "experience-star"
    | "pre-export-check"
    | null;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
  }>;
  context: AgentResumeContext;
};
```

### Agent Resume Context

```ts
export type AgentResumeContext = {
  resumeTitle: string;
  templateId: string;
  activeSection: string | null;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
  sections: Array<{
    key: string;
    label: string;
    fieldPath: string;
    plainText: string;
  }>;
};
```

### Agent Response

```ts
export type AgentMessageResponse = {
  status: "ok";
  requestId: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
  };
  toolCalls: AgentToolCall[];
  proposedPatches: ResumePatch[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};
```

### Basic Resume Modification Tools

These tools are available to the Agent for reasoning. They do not write to Web state by themselves.

```ts
export type AgentToolName =
  | "inspect_resume"
  | "propose_rich_text_rewrite"
  | "propose_summary_rewrite"
  | "propose_bullet_rewrite"
  | "draft_section_item";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};
```

### Resume Patch Envelope

```ts
export type ResumePatch = {
  id: string;
  toolCallId: string;
  label: string;
  section: "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom";
  fieldPath: string;
  operation: "replace_plain_text" | "replace_tiptap_json";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  changeSummary: string;
  riskFlags: Array<{
    type: "needs_user_fact" | "possible_fabrication" | "formatting_risk" | "unsafe_claim";
    message: string;
  }>;
};
```

Rules:

- `fieldPath` must point to an allowlisted editable field.
- Phase 3A allowlist starts with:
  - `basics.summary`
  - `experience.<index>.content`
  - `projects.<index>.content`
  - `research.<index>.content`
  - `education.<index>.highlights`
  - `skills`
  - `custom.<index>.content`
- `replace_plain_text` can only target plain summary text in Phase 3A.
- `replace_tiptap_json` can target rich text fields and must preserve list structure when the original content is a bullet or ordered list.
- If the Agent is missing facts or metrics, it must add `needs_user_fact` instead of inventing numbers.

---

## Task 1: Document the Phase 3A Contract

**Files:**
- Modify: `docs/agent/service-contracts.md`
- Modify: `docs/agent/proto/intro_builder_agent_v1.proto`
- Modify: `docs/agent/frontend-integration.md`
- Modify: `docs/agent/implementation-roadmap.md`
- Modify: `docs/agent/code-map.md`

- [ ] **Step 1: Update `docs/agent/service-contracts.md`**

Add a new section before `## Planned API Versioning`:

```markdown
## Agent Messages Contract

### `POST /v1/agent/messages`

用途：Phase 3 assistant-ui Agent panel 的消息入口。它接收 Web 端裁剪后的当前 RHF 简历快照、聊天消息和 preset workflow，返回 assistant 消息、可见 tool calls 和待用户确认的 `ResumePatch`。

认证：`Authorization: Bearer <agent-jwt>`，scope 必须是 `agent:chat`。JWT 的 `resumeId` 必须与请求体 `resumeId` 一致。

重要边界：

- Agent 只返回建议和 patch envelope，不直接保存简历。
- Web 在用户点击 `应用` 后才把 patch 写入 RHF。
- Agent 不连接 Postgres，不读取 Web session，不接收 provider key from browser。
- 现有 OCR、导入简历、AI 解析不迁入这个接口。

Request:

```json
{
  "resumeId": "resume_abc",
  "locale": "zh-CN",
  "workflowId": "resume-diagnose",
  "messages": [
    {
      "id": "msg_user_1",
      "role": "user",
      "content": "请诊断这份简历，并优先指出最值得修改的一处。"
    }
  ],
  "context": {
    "resumeTitle": "前端工程师",
    "templateId": "professional",
    "activeSection": null,
    "completeness": {
      "overall": 76,
      "sections": [
        { "key": "experience", "label": "工作经历", "score": 18, "max": 25 }
      ]
    },
    "sections": [
      {
        "key": "experience",
        "label": "工作经历 1",
        "fieldPath": "experience.0.content",
        "plainText": "负责后台系统开发，优化页面性能。"
      }
    ]
  }
}
```

Success response:

```json
{
  "status": "ok",
  "requestId": "req_01H...",
  "message": {
    "id": "msg_assistant_1",
    "role": "assistant",
    "content": "我先看了整体结构，最值得优先优化的是第一段工作经历：它有动作，但缺少业务背景和结果证据。"
  },
  "toolCalls": [
    {
      "id": "tool_1",
      "name": "inspect_resume",
      "status": "completed",
      "title": "检查简历结构",
      "summary": "已检查 1 个工作经历段落，发现结果证据不足。",
      "input": { "scope": "resume" },
      "result": { "topIssue": "工作经历缺少结果证据" }
    }
  ],
  "proposedPatches": [
    {
      "id": "patch_1",
      "toolCallId": "tool_1",
      "label": "优化工作经历第一段",
      "section": "experience",
      "fieldPath": "experience.0.content",
      "operation": "replace_tiptap_json",
      "beforePlainText": "负责后台系统开发，优化页面性能。",
      "afterPlainText": "围绕后台系统的页面性能问题，梳理核心页面加载链路并推进前端优化；请补充具体指标后再写入最终结果。",
      "replacementTiptapJson": {
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "围绕后台系统的页面性能问题，梳理核心页面加载链路并推进前端优化；请补充具体指标后再写入最终结果。"
              }
            ]
          }
        ]
      },
      "changeSummary": "按 STAR 补足任务与行动，但没有编造结果指标。",
      "riskFlags": [
        {
          "type": "needs_user_fact",
          "message": "需要用户补充性能提升指标或业务影响。"
        }
      ]
    }
  ],
  "usage": {
    "provider": "openai-compatible",
    "model": "deepseek-chat",
    "inputTokens": 1000,
    "outputTokens": 300
  }
}
```
```

- [ ] **Step 2: Update proto draft**

Append this service and messages to `docs/agent/proto/intro_builder_agent_v1.proto`:

```proto
service AgentMessageService {
  rpc SendAgentMessage(SendAgentMessageRequest) returns (SendAgentMessageResponse);
}

message SendAgentMessageRequest {
  string request_id = 1;
  string resume_id = 2;
  string locale = 3;
  AgentWorkflowId workflow_id = 4;
  repeated AgentChatMessage messages = 5;
  AgentResumeContext context = 6;
}

message AgentChatMessage {
  string id = 1;
  AgentChatRole role = 2;
  string content = 3;
}

message AgentResumeContext {
  string resume_title = 1;
  string template_id = 2;
  string active_section = 3;
  CompletenessSnapshot completeness = 4;
  repeated AgentResumeSection sections = 5;
}

message AgentResumeSection {
  string key = 1;
  string label = 2;
  string field_path = 3;
  string plain_text = 4;
}

message SendAgentMessageResponse {
  string status = 1;
  string request_id = 2;
  AgentChatMessage message = 3;
  repeated AgentToolCall tool_calls = 4;
  repeated ResumePatch proposed_patches = 5;
  Usage usage = 6;
}

message AgentToolCall {
  string id = 1;
  AgentToolName name = 2;
  string status = 3;
  string title = 4;
  string summary = 5;
  google.protobuf.Struct input = 6;
  google.protobuf.Struct result = 7;
}

message ResumePatch {
  string id = 1;
  string tool_call_id = 2;
  string label = 3;
  ResumeSection section = 4;
  string field_path = 5;
  ResumePatchOperation operation = 6;
  string before_plain_text = 7;
  string after_plain_text = 8;
  google.protobuf.Struct replacement_tiptap_json = 9;
  string change_summary = 10;
  repeated AgentPatchRiskFlag risk_flags = 11;
}

message AgentPatchRiskFlag {
  AgentPatchRiskFlagType type = 1;
  string message = 2;
}

enum AgentWorkflowId {
  AGENT_WORKFLOW_ID_UNSPECIFIED = 0;
  AGENT_WORKFLOW_ID_RESUME_DIAGNOSE = 1;
  AGENT_WORKFLOW_ID_TARGET_ROLE_MATCH = 2;
  AGENT_WORKFLOW_ID_EXPERIENCE_STAR = 3;
  AGENT_WORKFLOW_ID_PRE_EXPORT_CHECK = 4;
}

enum AgentChatRole {
  AGENT_CHAT_ROLE_UNSPECIFIED = 0;
  AGENT_CHAT_ROLE_USER = 1;
  AGENT_CHAT_ROLE_ASSISTANT = 2;
}

enum AgentToolName {
  AGENT_TOOL_NAME_UNSPECIFIED = 0;
  AGENT_TOOL_NAME_INSPECT_RESUME = 1;
  AGENT_TOOL_NAME_PROPOSE_RICH_TEXT_REWRITE = 2;
  AGENT_TOOL_NAME_PROPOSE_SUMMARY_REWRITE = 3;
  AGENT_TOOL_NAME_PROPOSE_BULLET_REWRITE = 4;
  AGENT_TOOL_NAME_DRAFT_SECTION_ITEM = 5;
}

enum ResumePatchOperation {
  RESUME_PATCH_OPERATION_UNSPECIFIED = 0;
  RESUME_PATCH_OPERATION_REPLACE_PLAIN_TEXT = 1;
  RESUME_PATCH_OPERATION_REPLACE_TIPTAP_JSON = 2;
}

enum AgentPatchRiskFlagType {
  AGENT_PATCH_RISK_FLAG_TYPE_UNSPECIFIED = 0;
  AGENT_PATCH_RISK_FLAG_TYPE_NEEDS_USER_FACT = 1;
  AGENT_PATCH_RISK_FLAG_TYPE_POSSIBLE_FABRICATION = 2;
  AGENT_PATCH_RISK_FLAG_TYPE_FORMATTING_RISK = 3;
  AGENT_PATCH_RISK_FLAG_TYPE_UNSAFE_CLAIM = 4;
}
```

- [ ] **Step 3: Update frontend and roadmap docs**

Replace Phase 3 docs so they say:

```markdown
Phase 3A uses Agent Mode Replaces Left Editor, not a right-side drawer. The Web editor keeps `FormProvider` mounted, keeps preview visible, and uses assistant-ui only for the Agent panel thread/composer/tool UI. The first workflow must prove tool reasoning and confirmed writeback with at least one `ResumePatch`.
```

- [ ] **Step 4: Commit docs**

Run:

```bash
git add docs/agent/service-contracts.md docs/agent/proto/intro_builder_agent_v1.proto docs/agent/frontend-integration.md docs/agent/implementation-roadmap.md docs/agent/code-map.md
git commit -m "docs(agent): define phase 3a message contract"
```

Expected: commit succeeds.

---

## Task 2: Add Shared Agent Message Types and Context Builder

**Files:**
- Create: `lib/agent/agent-message-contract.ts`
- Create: `lib/agent/chat-context.ts`
- Modify: `lib/agent/resume-helper-context.ts`
- Test: `tests/unit/agent-chat-context.test.ts`

- [ ] **Step 1: Write failing context tests**

Create `tests/unit/agent-chat-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import type { ResumeContent } from "@/lib/resume-schema";

const richText = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function baseContent(): ResumeContent {
  return {
    basics: {
      name: "张三",
      title: "前端工程师",
      email: "zhangsan@example.com",
      phone: "",
      location: "",
      website: "",
      summary: "三年前端经验，关注工程质量。",
    },
    sectionOrder: ["basics", "experience", "projects", "education", "skills"],
    experience: [
      {
        id: "exp_1",
        company: "示例科技",
        role: "前端工程师",
        startDate: "2024-01",
        endDate: "",
        current: true,
        location: "",
        content: richText("负责后台系统开发，优化页面性能。"),
      },
    ],
    education: [],
    projects: [
      {
        id: "proj_1",
        name: "简历项目",
        role: "",
        startDate: "",
        endDate: "",
        link: "",
        content: richText("搭建在线简历编辑器。"),
      },
    ],
    research: [],
    skills: richText("React, TypeScript"),
    custom: [],
  };
}

describe("buildAgentResumeContext", () => {
  it("builds capped sections with field paths for Agent tools", () => {
    const context = buildAgentResumeContext({
      content: baseContent(),
      templateId: "professional",
      activeSection: null,
      completeness: {
        overall: 80,
        sections: [{ key: "experience", label: "工作经历", score: 18, max: 25 }],
      },
    });

    expect(context.resumeTitle).toBe("前端工程师");
    expect(context.templateId).toBe("professional");
    expect(context.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "summary",
          label: "个人总结",
          fieldPath: "basics.summary",
          plainText: "三年前端经验，关注工程质量。",
        }),
        expect.objectContaining({
          key: "experience",
          label: "工作经历 1",
          fieldPath: "experience.0.content",
          plainText: "负责后台系统开发，优化页面性能。",
        }),
      ]),
    );
  });

  it("caps total plain text so Agent requests stay bounded", () => {
    const content = baseContent();
    content.basics.summary = "很长".repeat(7000);

    const context = buildAgentResumeContext({
      content,
      templateId: "professional",
      activeSection: "summary",
      completeness: { overall: 10, sections: [] },
    });

    const total = context.sections.reduce((sum, section) => sum + section.plainText.length, 0);
    expect(total).toBeLessThanOrEqual(12000);
    expect(context.activeSection).toBe("summary");
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm vitest run tests/unit/agent-chat-context.test.ts
```

Expected: FAIL because `lib/agent/chat-context.ts` does not exist.

- [ ] **Step 3: Create shared contract file**

Create `lib/agent/agent-message-contract.ts`:

```ts
export type AgentWorkflowId =
  | "resume-diagnose"
  | "target-role-match"
  | "experience-star"
  | "pre-export-check";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AgentResumeContext = {
  resumeTitle: string;
  templateId: string;
  activeSection: string | null;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
  sections: Array<{
    key: string;
    label: string;
    fieldPath: string;
    plainText: string;
  }>;
};

export type AgentMessageRequest = {
  resumeId: string;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: AgentChatMessage[];
  context: AgentResumeContext;
};

export type AgentToolName =
  | "inspect_resume"
  | "propose_rich_text_rewrite"
  | "propose_summary_rewrite"
  | "propose_bullet_rewrite"
  | "draft_section_item";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumePatch = {
  id: string;
  toolCallId: string;
  label: string;
  section: "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom";
  fieldPath: string;
  operation: "replace_plain_text" | "replace_tiptap_json";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  changeSummary: string;
  riskFlags: Array<{
    type: "needs_user_fact" | "possible_fabrication" | "formatting_risk" | "unsafe_claim";
    message: string;
  }>;
};

export type AgentMessageResponse = {
  status: "ok";
  requestId: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
  };
  toolCalls: AgentToolCall[];
  proposedPatches: ResumePatch[];
  usage: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};
```

- [ ] **Step 4: Create context builder**

Create `lib/agent/chat-context.ts`:

```ts
import { getSectionMeta } from "@/lib/section-meta";
import type { ResumeContent } from "@/lib/resume-schema";
import { tiptapPlainText } from "@/lib/agent/resume-helper-context";
import type { AgentResumeContext } from "@/lib/agent/agent-message-contract";

const MAX_TOTAL_CONTEXT_CHARS = 12_000;
const MAX_SECTION_CHARS = 4_000;

export type BuildAgentResumeContextInput = {
  content: ResumeContent;
  templateId: string;
  activeSection: string | null;
  completeness: AgentResumeContext["completeness"];
};

export function buildAgentResumeContext({
  content,
  templateId,
  activeSection,
  completeness,
}: BuildAgentResumeContextInput): AgentResumeContext {
  const rawSections: AgentResumeContext["sections"] = [
    textSection("summary", getSectionMeta("summary").label, "basics.summary", content.basics.summary ?? ""),
    ...content.experience.map((item, index) =>
      textSection("experience", `${getSectionMeta("experience").label} ${index + 1}`, `experience.${index}.content`, tiptapPlainText(item.content)),
    ),
    ...content.projects.map((item, index) =>
      textSection("projects", `${getSectionMeta("projects").label} ${index + 1}`, `projects.${index}.content`, tiptapPlainText(item.content)),
    ),
    ...content.education.map((item, index) =>
      textSection("education", `${getSectionMeta("education").label} ${index + 1}`, `education.${index}.highlights`, tiptapPlainText(item.highlights)),
    ),
    ...content.research.map((item, index) =>
      textSection("research", `${getSectionMeta("research").label} ${index + 1}`, `research.${index}.content`, tiptapPlainText(item.content)),
    ),
    textSection("skills", getSectionMeta("skills").label, "skills", tiptapPlainText(content.skills)),
    ...content.custom.map((item, index) =>
      textSection("custom", item.title || getSectionMeta(item.id).label, `custom.${index}.content`, tiptapPlainText(item.content)),
    ),
  ].filter((item) => item.plainText !== "");

  let remaining = MAX_TOTAL_CONTEXT_CHARS;
  const sections: AgentResumeContext["sections"] = [];
  for (const item of rawSections) {
    if (remaining <= 0) break;
    const plainText = item.plainText.slice(0, Math.min(MAX_SECTION_CHARS, remaining));
    remaining -= plainText.length;
    sections.push({ ...item, plainText });
  }

  return {
    resumeTitle: content.basics.title?.trim() || "未填写目标岗位",
    templateId,
    activeSection,
    completeness,
    sections,
  };
}

function textSection(
  key: AgentResumeContext["sections"][number]["key"],
  label: string,
  fieldPath: string,
  plainText: string,
) {
  return {
    key,
    label,
    fieldPath,
    plainText: plainText.trim(),
  };
}
```

- [ ] **Step 5: Run test to verify pass**

Run:

```bash
pnpm vitest run tests/unit/agent-chat-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared context**

Run:

```bash
git add lib/agent/agent-message-contract.ts lib/agent/chat-context.ts tests/unit/agent-chat-context.test.ts
git commit -m "feat(agent): add chat context contract"
```

Expected: commit succeeds.

---

## Task 3: Add Agent Service Message Domain and Basic Tool Planning

**Files:**
- Create: `apps/agent/src/agent-tools.ts`
- Create: `apps/agent/src/agent-messages.ts`
- Test: `apps/agent/tests/agent-tools.test.ts`
- Test: `apps/agent/tests/agent-messages.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `apps/agent/tests/agent-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  validateAgentToolOutput,
  isAllowedPatchFieldPath,
} from "../src/agent-tools.js";

describe("agent tools", () => {
  it("allows the basic resume modification field paths", () => {
    expect(isAllowedPatchFieldPath("basics.summary")).toBe(true);
    expect(isAllowedPatchFieldPath("experience.0.content")).toBe(true);
    expect(isAllowedPatchFieldPath("projects.2.content")).toBe(true);
    expect(isAllowedPatchFieldPath("education.1.highlights")).toBe(true);
    expect(isAllowedPatchFieldPath("research.0.content")).toBe(true);
    expect(isAllowedPatchFieldPath("skills")).toBe(true);
    expect(isAllowedPatchFieldPath("custom.0.content")).toBe(true);
  });

  it("rejects unsafe patch field paths", () => {
    expect(isAllowedPatchFieldPath("templateId")).toBe(false);
    expect(isAllowedPatchFieldPath("isPublic")).toBe(false);
    expect(isAllowedPatchFieldPath("experience.0.company")).toBe(false);
    expect(isAllowedPatchFieldPath("__proto__.polluted")).toBe(false);
  });

  it("validates proposed patches without allowing direct writes", () => {
    const result = validateAgentToolOutput({
      toolCalls: [
        {
          id: "tool_1",
          name: "propose_rich_text_rewrite",
          status: "completed",
          title: "优化经历",
          summary: "将笼统描述改成 STAR 结构。",
          input: { fieldPath: "experience.0.content" },
          result: { patchIds: ["patch_1"] },
        },
      ],
      proposedPatches: [
        {
          id: "patch_1",
          toolCallId: "tool_1",
          label: "应用 STAR 改写",
          section: "experience",
          fieldPath: "experience.0.content",
          operation: "replace_tiptap_json",
          beforePlainText: "负责后台系统开发。",
          afterPlainText: "围绕后台系统稳定性目标，梳理前端问题并推进优化；结果指标需要补充。",
          replacementTiptapJson: { type: "doc", content: [] },
          changeSummary: "补足任务与行动，不编造结果。",
          riskFlags: [{ type: "needs_user_fact", message: "请补充结果指标。" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tool tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- agent-tools.test.ts
```

Expected: FAIL because `agent-tools.ts` does not exist.

- [ ] **Step 3: Implement `apps/agent/src/agent-tools.ts`**

Create:

```ts
export type AgentToolName =
  | "inspect_resume"
  | "propose_rich_text_rewrite"
  | "propose_summary_rewrite"
  | "propose_bullet_rewrite"
  | "draft_section_item";

export type AgentToolCall = {
  id: string;
  name: AgentToolName;
  status: "completed";
  title: string;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
};

export type ResumePatch = {
  id: string;
  toolCallId: string;
  label: string;
  section: "summary" | "experience" | "projects" | "education" | "skills" | "research" | "custom";
  fieldPath: string;
  operation: "replace_plain_text" | "replace_tiptap_json";
  beforePlainText: string;
  afterPlainText: string;
  replacementTiptapJson?: unknown;
  changeSummary: string;
  riskFlags: Array<{
    type: "needs_user_fact" | "possible_fabrication" | "formatting_risk" | "unsafe_claim";
    message: string;
  }>;
};

export type AgentToolOutput = {
  toolCalls: AgentToolCall[];
  proposedPatches: ResumePatch[];
};

const TOOL_NAMES = new Set<AgentToolName>([
  "inspect_resume",
  "propose_rich_text_rewrite",
  "propose_summary_rewrite",
  "propose_bullet_rewrite",
  "draft_section_item",
]);

const SECTIONS = new Set<ResumePatch["section"]>([
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "research",
  "custom",
]);

const PATCH_OPERATIONS = new Set<ResumePatch["operation"]>([
  "replace_plain_text",
  "replace_tiptap_json",
]);

const RISK_TYPES = new Set<ResumePatch["riskFlags"][number]["type"]>([
  "needs_user_fact",
  "possible_fabrication",
  "formatting_risk",
  "unsafe_claim",
]);

export function isAllowedPatchFieldPath(fieldPath: string): boolean {
  return (
    fieldPath === "basics.summary" ||
    fieldPath === "skills" ||
    /^experience\.\d+\.content$/.test(fieldPath) ||
    /^projects\.\d+\.content$/.test(fieldPath) ||
    /^education\.\d+\.highlights$/.test(fieldPath) ||
    /^research\.\d+\.content$/.test(fieldPath) ||
    /^custom\.\d+\.content$/.test(fieldPath)
  );
}

export function validateAgentToolOutput(
  value: unknown,
): { ok: true; output: AgentToolOutput } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "tool output must be an object" };
  if (!Array.isArray(value.toolCalls)) return { ok: false, message: "toolCalls must be an array" };
  if (!Array.isArray(value.proposedPatches)) return { ok: false, message: "proposedPatches must be an array" };

  const toolCalls: AgentToolCall[] = [];
  const toolIds = new Set<string>();
  for (const item of value.toolCalls) {
    const parsed = parseToolCall(item);
    if (!parsed.ok) return parsed;
    toolIds.add(parsed.toolCall.id);
    toolCalls.push(parsed.toolCall);
  }

  const proposedPatches: ResumePatch[] = [];
  for (const item of value.proposedPatches) {
    const parsed = parsePatch(item, toolIds);
    if (!parsed.ok) return parsed;
    proposedPatches.push(parsed.patch);
  }

  return { ok: true, output: { toolCalls, proposedPatches } };
}

function parseToolCall(value: unknown): { ok: true; toolCall: AgentToolCall } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "tool call must be an object" };
  const id = requiredString(value.id, "toolCall.id");
  if (!id.ok) return id;
  if (!TOOL_NAMES.has(value.name as AgentToolName)) return { ok: false, message: "toolCall.name is not supported" };
  const title = requiredString(value.title, "toolCall.title");
  if (!title.ok) return title;
  const summary = requiredString(value.summary, "toolCall.summary");
  if (!summary.ok) return summary;
  if (!isRecord(value.input)) return { ok: false, message: "toolCall.input must be an object" };
  if (!isRecord(value.result)) return { ok: false, message: "toolCall.result must be an object" };

  return {
    ok: true,
    toolCall: {
      id: id.value,
      name: value.name as AgentToolName,
      status: "completed",
      title: title.value,
      summary: summary.value,
      input: value.input,
      result: value.result,
    },
  };
}

function parsePatch(value: unknown, toolIds: Set<string>): { ok: true; patch: ResumePatch } | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: "patch must be an object" };
  const id = requiredString(value.id, "patch.id");
  if (!id.ok) return id;
  const toolCallId = requiredString(value.toolCallId, "patch.toolCallId");
  if (!toolCallId.ok) return toolCallId;
  if (!toolIds.has(toolCallId.value)) return { ok: false, message: "patch.toolCallId must reference a tool call" };
  const label = requiredString(value.label, "patch.label");
  if (!label.ok) return label;
  if (!SECTIONS.has(value.section as ResumePatch["section"])) return { ok: false, message: "patch.section is invalid" };
  const fieldPath = requiredString(value.fieldPath, "patch.fieldPath");
  if (!fieldPath.ok) return fieldPath;
  if (!isAllowedPatchFieldPath(fieldPath.value)) return { ok: false, message: "patch.fieldPath is not allowed" };
  if (!PATCH_OPERATIONS.has(value.operation as ResumePatch["operation"])) return { ok: false, message: "patch.operation is invalid" };
  const beforePlainText = requiredString(value.beforePlainText, "patch.beforePlainText");
  if (!beforePlainText.ok) return beforePlainText;
  const afterPlainText = requiredString(value.afterPlainText, "patch.afterPlainText");
  if (!afterPlainText.ok) return afterPlainText;
  const changeSummary = requiredString(value.changeSummary, "patch.changeSummary");
  if (!changeSummary.ok) return changeSummary;
  if (!Array.isArray(value.riskFlags)) return { ok: false, message: "patch.riskFlags must be an array" };

  const riskFlags: ResumePatch["riskFlags"] = [];
  for (const flag of value.riskFlags) {
    if (!isRecord(flag)) return { ok: false, message: "patch risk flag must be an object" };
    if (!RISK_TYPES.has(flag.type as ResumePatch["riskFlags"][number]["type"])) {
      return { ok: false, message: "patch risk flag type is invalid" };
    }
    const message = requiredString(flag.message, "patch.riskFlags.message");
    if (!message.ok) return message;
    riskFlags.push({ type: flag.type as ResumePatch["riskFlags"][number]["type"], message: message.value });
  }

  return {
    ok: true,
    patch: {
      id: id.value,
      toolCallId: toolCallId.value,
      label: label.value,
      section: value.section as ResumePatch["section"],
      fieldPath: fieldPath.value,
      operation: value.operation as ResumePatch["operation"],
      beforePlainText: beforePlainText.value,
      afterPlainText: afterPlainText.value,
      ...(value.replacementTiptapJson === undefined ? {} : { replacementTiptapJson: value.replacementTiptapJson }),
      changeSummary: changeSummary.value,
      riskFlags,
    },
  };
}

function requiredString(value: unknown, field: string): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return { ok: false, message: `${field} is required` };
  }
  return { ok: true, value: value.trim() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
```

- [ ] **Step 4: Write failing message domain tests**

Create `apps/agent/tests/agent-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildAgentMessagePrompt,
  parseAgentMessageProviderResponse,
  validateAgentMessageRequest,
} from "../src/agent-messages.js";

const validBody = {
  resumeId: "resume_1",
  locale: "zh-CN",
  workflowId: "resume-diagnose",
  messages: [{ id: "msg_1", role: "user", content: "诊断整份简历" }],
  context: {
    resumeTitle: "前端工程师",
    templateId: "professional",
    activeSection: null,
    completeness: { overall: 80, sections: [] },
    sections: [
      {
        key: "experience",
        label: "工作经历 1",
        fieldPath: "experience.0.content",
        plainText: "负责后台系统开发。",
      },
    ],
  },
};

describe("agent messages", () => {
  it("validates request body", () => {
    const result = validateAgentMessageRequest(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.workflowId).toBe("resume-diagnose");
      expect(result.request.context.sections[0]?.fieldPath).toBe("experience.0.content");
    }
  });

  it("builds a prompt that exposes tool names and STAR safety rules", () => {
    const result = validateAgentMessageRequest(validBody);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const prompt = buildAgentMessagePrompt({ ...result.request, requestId: "req_test" });
    expect(prompt.system).toContain("intro-builder 的简历 Agent");
    expect(prompt.developer).toContain("inspect_resume");
    expect(prompt.developer).toContain("propose_rich_text_rewrite");
    expect(prompt.developer).toContain("STAR");
    expect(prompt.developer).toContain("不得编造事实");
  });

  it("parses provider response with tool calls and proposed patches", () => {
    const parsed = parseAgentMessageProviderResponse(JSON.stringify({
      message: {
        id: "msg_assistant_1",
        role: "assistant",
        content: "建议先优化工作经历。",
      },
      toolCalls: [
        {
          id: "tool_1",
          name: "inspect_resume",
          status: "completed",
          title: "检查简历",
          summary: "发现工作经历缺少结果。",
          input: { scope: "resume" },
          result: { topIssue: "缺少结果" },
        },
      ],
      proposedPatches: [],
    }));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.result.message.content).toContain("优化工作经历");
      expect(parsed.result.toolCalls[0]?.name).toBe("inspect_resume");
    }
  });
});
```

- [ ] **Step 5: Run failing message tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- agent-messages.test.ts
```

Expected: FAIL because `agent-messages.ts` does not exist.

- [ ] **Step 6: Implement `apps/agent/src/agent-messages.ts`**

Implement the file using the same validation style as `resume-helpers.ts`. Required exports:

```ts
export type AgentWorkflowId =
  | "resume-diagnose"
  | "target-role-match"
  | "experience-star"
  | "pre-export-check";

export type AgentMessageRequest = {
  requestId?: string;
  resumeId: string;
  locale: "zh-CN";
  workflowId: AgentWorkflowId | null;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  context: {
    resumeTitle: string;
    templateId: string;
    activeSection: string | null;
    completeness: {
      overall: number;
      sections: Array<{ key: string; label: string; score: number; max: number }>;
    };
    sections: Array<{ key: string; label: string; fieldPath: string; plainText: string }>;
  };
};
```

The implementation must:

- Reject non-object bodies with `bad_request`.
- Reject unsupported `workflowId`.
- Reject empty `messages`.
- Reject unsupported message roles.
- Reject contexts with no sections.
- Cap total `context.sections[].plainText` at `12_000` and individual section text at `4_000`.
- Build prompt rules requiring JSON output shaped as:

```json
{
  "message": { "id": "msg_assistant_1", "role": "assistant", "content": "string" },
  "toolCalls": [],
  "proposedPatches": []
}
```

The developer prompt must include these exact strings so tests and reviewers can verify intent:

```text
可用 tools: inspect_resume, propose_rich_text_rewrite, propose_summary_rewrite, propose_bullet_rewrite, draft_section_item
所有简历修改必须作为 proposedPatches 返回，不能声称已经保存。
使用 STAR 原则时，不得编造 Result 指标。
```

- [ ] **Step 7: Run Agent domain tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- agent-tools.test.ts agent-messages.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Agent domain**

Run:

```bash
git add apps/agent/src/agent-tools.ts apps/agent/src/agent-messages.ts apps/agent/tests/agent-tools.test.ts apps/agent/tests/agent-messages.test.ts
git commit -m "feat(agent): add message tool contract"
```

Expected: commit succeeds.

---

## Task 4: Add Agent Service HTTP Route

**Files:**
- Modify: `apps/agent/src/http.ts`
- Modify: `apps/agent/src/index.ts`
- Test: `apps/agent/tests/http.test.ts`

- [ ] **Step 1: Write failing HTTP route tests**

Add tests to `apps/agent/tests/http.test.ts`:

```ts
it("handles POST /v1/agent/messages with agent:chat scope", async () => {
  const token = await signTestAgentToken({
    scope: "agent:chat",
    resumeId: "resume_1",
  });
  const server = createAgentServer({
    config: testConfig(),
    replayStore: createMemoryReplayStore(),
    rateLimitStore: createMemoryRateLimitStore(),
    agentMessageProvider: {
      run: async () => ({
        content: JSON.stringify({
          message: { id: "msg_assistant_1", role: "assistant", content: "建议先优化工作经历。" },
          toolCalls: [
            {
              id: "tool_1",
              name: "inspect_resume",
              status: "completed",
              title: "检查简历",
              summary: "已检查当前简历。",
              input: { scope: "resume" },
              result: { topIssue: "经历缺少结果" },
            },
          ],
          proposedPatches: [],
        }),
        usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
      }),
    },
  });

  const response = await request(server, {
    method: "POST",
    path: "/v1/agent/messages",
    headers: { authorization: `Bearer ${token}` },
    body: {
      resumeId: "resume_1",
      locale: "zh-CN",
      workflowId: "resume-diagnose",
      messages: [{ id: "msg_1", role: "user", content: "诊断整份简历" }],
      context: {
        resumeTitle: "前端工程师",
        templateId: "professional",
        activeSection: null,
        completeness: { overall: 80, sections: [] },
        sections: [{ key: "experience", label: "工作经历 1", fieldPath: "experience.0.content", plainText: "负责后台系统开发。" }],
      },
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json.message.content).toContain("优化工作经历");
  expect(response.json.toolCalls[0].name).toBe("inspect_resume");
});

it("rejects POST /v1/agent/messages with wrong scope", async () => {
  const token = await signTestAgentToken({
    scope: "resume:helper",
    resumeId: "resume_1",
  });
  const server = createAgentServer({
    config: testConfig(),
    replayStore: createMemoryReplayStore(),
  });

  const response = await request(server, {
    method: "POST",
    path: "/v1/agent/messages",
    headers: { authorization: `Bearer ${token}` },
    body: {
      resumeId: "resume_1",
      locale: "zh-CN",
      workflowId: "resume-diagnose",
      messages: [{ id: "msg_1", role: "user", content: "诊断整份简历" }],
      context: {
        resumeTitle: "前端工程师",
        templateId: "professional",
        activeSection: null,
        completeness: { overall: 80, sections: [] },
        sections: [{ key: "experience", label: "工作经历 1", fieldPath: "experience.0.content", plainText: "负责后台系统开发。" }],
      },
    },
  });

  expect(response.statusCode).toBe(403);
  expect(response.json.error).toBe("forbidden");
});
```

If helper names in `http.test.ts` differ, adapt the snippets to existing test helpers without changing behavior.

- [ ] **Step 2: Run failing HTTP tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- http.test.ts
```

Expected: FAIL because `createAgentServer` does not accept `agentMessageProvider` and route does not exist.

- [ ] **Step 3: Add provider type and route**

Modify `apps/agent/src/http.ts`:

```ts
import {
  buildAgentMessagePrompt,
  parseAgentMessageProviderResponse,
  validateAgentMessageRequest,
  type AgentMessageProvider,
} from "./agent-messages.js";
```

Extend `CreateAgentServerOptions`:

```ts
agentMessageProvider?: AgentMessageProvider;
```

Pass `agentMessageProvider` through `routeRequest()`.

Add the route before the resume helper match:

```ts
if (url.pathname === "/v1/agent/messages") {
  if (method !== "POST") return methodNotAllowed(response, context, "POST");

  const auth = await authenticateAgentRequest({
    authorizationHeader: headerValue(request.headers.authorization),
    expectedScope: "agent:chat",
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

  const validation = validateAgentMessageRequest(body.value);
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

  if (!agentMessageProvider) {
    return sendError(response, 503, context, {
      error: "dependency_unavailable",
      message: "Agent message provider is not configured",
      dependency: "provider",
    });
  }

  if (rateLimitStore) {
    try {
      const rateLimit = await checkRateLimit({
        redis: rateLimitStore,
        scope: "agent:chat",
        identityHash: hashIdentity(auth.session.userId),
        limit: config.rateLimitMaxRequests,
        windowSeconds: config.rateLimitWindowSeconds,
        now: now(),
      });
      if (!rateLimit.allowed) {
        return sendError(response, 429, context, {
          error: "rate_limited",
          message: "Too many Agent chat requests",
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

  const prompt = buildAgentMessagePrompt({
    ...validation.request,
    requestId: context.requestId,
  });

  try {
    const providerResult = await agentMessageProvider.run({
      request: validation.request,
      prompt,
      session: auth.session,
      requestId: context.requestId,
    });
    const parsed = parseAgentMessageProviderResponse(providerResult.content);
    if (!parsed.ok) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: parsed.message,
        dependency: "provider",
      });
    }

    return sendJson(response, 200, {
      status: "ok",
      requestId: context.requestId,
      message: parsed.result.message,
      toolCalls: parsed.result.toolCalls,
      proposedPatches: parsed.result.proposedPatches,
      usage: providerResult.usage,
    }, context);
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

- [ ] **Step 4: Wire provider in `apps/agent/src/index.ts`**

Create and import `createOpenAICompatibleAgentMessageProvider(config)` from `agent-messages.ts`, mirroring `createOpenAICompatibleResumeHelperProvider(config)`.

Pass it into `createAgentServer()`:

```ts
agentMessageProvider: createOpenAICompatibleAgentMessageProvider(config),
```

- [ ] **Step 5: Run route tests**

Run:

```bash
pnpm --filter @intro-builder/agent test -- http.test.ts agent-messages.test.ts agent-tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Agent route**

Run:

```bash
git add apps/agent/src/http.ts apps/agent/src/index.ts apps/agent/tests/http.test.ts
git commit -m "feat(agent): add chat message route"
```

Expected: commit succeeds.

---

## Task 5: Add Web Agent Client and BFF Route

**Files:**
- Modify: `lib/agent/client.ts`
- Create: `app/api/agent/messages/route.ts`
- Modify: `tests/unit/agent-client.test.ts`
- Create: `tests/unit/agent-messages-route.test.ts`

- [ ] **Step 1: Extend Agent client tests**

Add to `tests/unit/agent-client.test.ts`:

```ts
it("posts Agent messages to the Agent service", async () => {
  const fetchFn = vi.fn(async () =>
    new Response(JSON.stringify({
      status: "ok",
      requestId: "req_test",
      message: { id: "msg_assistant_1", role: "assistant", content: "建议先优化经历。" },
      toolCalls: [],
      proposedPatches: [],
      usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
    }), {
      status: 200,
      headers: { "x-request-id": "req_test", "content-type": "application/json" },
    }),
  );

  const client = createAgentClient({
    baseUrl: "http://agent.local",
    fetchFn: fetchFn as unknown as typeof fetch,
    createRequestId: () => "req_test",
  });

  const result = await client.sendAgentMessage({
    token: "token",
    request: {
      resumeId: "resume_1",
      locale: "zh-CN",
      workflowId: "resume-diagnose",
      messages: [{ id: "msg_1", role: "user", content: "诊断整份简历" }],
      context: {
        resumeTitle: "前端工程师",
        templateId: "professional",
        activeSection: null,
        completeness: { overall: 80, sections: [] },
        sections: [{ key: "experience", label: "工作经历 1", fieldPath: "experience.0.content", plainText: "负责后台系统开发。" }],
      },
    },
  });

  expect(fetchFn).toHaveBeenCalledWith(
    "http://agent.local/v1/agent/messages",
    expect.objectContaining({ method: "POST" }),
  );
  expect(result.data.message.content).toContain("优化经历");
});
```

- [ ] **Step 2: Run failing client test**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts
```

Expected: FAIL because `sendAgentMessage` does not exist.

- [ ] **Step 3: Extend `lib/agent/client.ts`**

Import shared types:

```ts
import type {
  AgentMessageRequest,
  AgentMessageResponse,
} from "@/lib/agent/agent-message-contract";
```

Add to `AgentClient`:

```ts
sendAgentMessage: (options: {
  token: string;
  request: AgentMessageRequest;
  requestId?: string;
}) => Promise<AgentClientResult<AgentMessageResponse>>;
```

Add implementation:

```ts
sendAgentMessage({ token, request, requestId = createRequestId() }) {
  return requestJson<AgentMessageResponse>({
    baseUrl,
    path: "/v1/agent/messages",
    method: "POST",
    token,
    requestId,
    body: request,
    timeoutMs,
    fetchFn,
  });
},
```

- [ ] **Step 4: Write Web BFF tests**

Create `tests/unit/agent-messages-route.test.ts` following the mock style from `tests/unit/agent-resume-helper-route.test.ts`.

Minimum cases:

```ts
it("proxies Agent messages after auth and ownership check", async () => {
  // Mock auth as current user.
  // Mock db resume lookup as owned by current user.
  // Mock createAgentClient().sendAgentMessage as successful.
  // POST route with resumeId, messages, and context.
  // Expect 200 and `message.content` returned.
});

it("returns 404 when the resume is not owned by current user", async () => {
  // Mock auth as current user.
  // Mock db resume lookup as null or owned by another user.
  // Expect 404 and do not call Agent client.
});

it("maps AgentClientError to dependency_unavailable response", async () => {
  // Mock ownership success.
  // Mock Agent client throwing AgentClientError.
  // Expect structured error with Chinese-safe envelope.
});
```

- [ ] **Step 5: Run failing Web BFF tests**

Run:

```bash
pnpm vitest run tests/unit/agent-messages-route.test.ts
```

Expected: FAIL because route does not exist.

- [ ] **Step 6: Create `app/api/agent/messages/route.ts`**

Implement:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createAgentClient, AgentClientError } from "@/lib/agent/client";
import { signAgentToken } from "@/lib/agent/token";
import type { AgentMessageRequest } from "@/lib/agent/agent-message-contract";

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? `req_${crypto.randomUUID()}`;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "未登录", code: "unauthorized", requestId }, { status: 401 });
  }

  let body: AgentMessageRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确", code: "bad_request", requestId }, { status: 400 });
  }

  if (!body || typeof body.resumeId !== "string" || body.resumeId.trim() === "") {
    return NextResponse.json({ error: "缺少简历 ID", code: "bad_request", requestId }, { status: 400 });
  }

  const [resume] = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, body.resumeId), eq(resumes.userId, userId)))
    .limit(1);

  if (!resume) {
    return NextResponse.json({ error: "简历不存在", code: "not_found", requestId }, { status: 404 });
  }

  try {
    const token = await signAgentToken({
      subject: userId,
      resumeId: body.resumeId,
      scope: "agent:chat",
    });
    const result = await createAgentClient().sendAgentMessage({
      token,
      request: body,
      requestId,
    });
    return NextResponse.json(result.data, {
      status: 200,
      headers: { "X-Request-Id": result.requestId },
    });
  } catch (error) {
    if (error instanceof AgentClientError) {
      return NextResponse.json(
        {
          error: "Agent 服务暂不可用",
          code: error.error,
          requestId: error.requestId,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Agent 服务暂不可用", code: "internal_error", requestId },
      { status: 500 },
    );
  }
}
```

If existing route tests use a dev bypass helper, preserve that pattern instead of inventing a second auth path.

- [ ] **Step 7: Run BFF tests**

Run:

```bash
pnpm vitest run tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Web BFF**

Run:

```bash
git add lib/agent/client.ts app/api/agent/messages/route.ts tests/unit/agent-client.test.ts tests/unit/agent-messages-route.test.ts
git commit -m "feat(agent): add web chat bff"
```

Expected: commit succeeds.

---

## Task 6: Add assistant-ui Dependency and Runtime Adapter

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `components/agent/agent-runtime-provider.tsx`
- Test: `tests/unit/agent-panel.test.tsx`

- [ ] **Step 1: Confirm package names**

Run:

```bash
pnpm view @assistant-ui/react version
pnpm view @assistant-ui/react dist-tags
```

Expected: package exists. Pin a stable semver range in `package.json`, for example:

```json
"@assistant-ui/react": "^0.x.y"
```

Use the current stable version returned by `pnpm view`; do not guess.

- [ ] **Step 2: Install dependency**

Run:

```bash
pnpm add @assistant-ui/react
```

Expected: `package.json` and `pnpm-lock.yaml` update.

- [ ] **Step 3: Write a runtime adapter test seam**

In `tests/unit/agent-panel.test.tsx`, start with a component-level test that can run without real provider streaming:

```ts
it("renders Agent panel safety copy and workflow entry", async () => {
  render(
    <AgentPanel
      resumeId="resume_1"
      title="前端工程师"
      templateId="professional"
      getResumeContent={() => baseContent()}
      completeness={{ overall: 80, sections: [] }}
      applyPatch={vi.fn()}
      flushAutosave={vi.fn()}
      onBackToEdit={vi.fn()}
    />,
  );

  expect(screen.getByText("简历 Agent")).toBeInTheDocument();
  expect(screen.getByText("AI 会读取当前表单快照，修改需你确认。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "诊断整份简历" })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run failing UI test**

Run:

```bash
pnpm vitest run tests/unit/agent-panel.test.tsx
```

Expected: FAIL because `AgentPanel` does not exist.

- [ ] **Step 5: Create runtime provider**

Create `components/agent/agent-runtime-provider.tsx` as the narrow adapter. The exact assistant-ui imports may differ by installed version; keep all assistant-ui imports in this file so the rest of the product is insulated.

Required behavior:

- Accept `children`.
- Accept a `sendMessage` callback that posts to `/api/agent/messages`.
- Use assistant-ui runtime to render thread/composer state.
- Keep product data (`ResumeContent`, `setValue`, autosave) outside assistant-ui.

The component shape should be:

```tsx
"use client";

import type { ReactNode } from "react";

type AgentRuntimeProviderProps = {
  children: ReactNode;
  sendMessage: (content: string) => Promise<void>;
};

export function AgentRuntimeProvider({ children }: AgentRuntimeProviderProps) {
  return <>{children}</>;
}
```

Start with this no-op provider if assistant-ui adapter API needs a smaller follow-up patch. Replace it in the same task once docs and installed types are confirmed.

- [ ] **Step 6: Commit dependency and runtime seam**

Run:

```bash
git add package.json pnpm-lock.yaml components/agent/agent-runtime-provider.tsx tests/unit/agent-panel.test.tsx
git commit -m "feat(agent): add assistant ui runtime seam"
```

Expected: commit succeeds.

---

## Task 7: Build Agent Panel, Tool Cards, and Confirmation Cards

**Files:**
- Create: `components/agent/agent-panel.tsx`
- Create: `components/agent/agent-preset-workflows.tsx`
- Create: `components/agent/agent-tool-card.tsx`
- Create: `components/agent/agent-confirmation-card.tsx`
- Modify: `tests/unit/agent-panel.test.tsx`

- [ ] **Step 1: Extend panel tests for workflow and confirmation**

Add:

```ts
it("starts resume diagnosis workflow through the Web BFF", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "ok",
      requestId: "req_test",
      message: { id: "msg_assistant_1", role: "assistant", content: "建议先优化工作经历。" },
      toolCalls: [
        {
          id: "tool_1",
          name: "inspect_resume",
          status: "completed",
          title: "检查简历",
          summary: "已检查当前简历。",
          input: {},
          result: {},
        },
      ],
      proposedPatches: [],
      usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
    })),
  );

  render(<AgentPanel {...panelProps()} />);
  await userEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

  expect(fetchSpy).toHaveBeenCalledWith(
    "/api/agent/messages",
    expect.objectContaining({ method: "POST" }),
  );
  expect(await screen.findByText("建议先优化工作经历。")).toBeInTheDocument();
  expect(screen.getByText("检查简历")).toBeInTheDocument();
});

it("applies proposed patch only after user confirms", async () => {
  const applyPatch = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({
      status: "ok",
      requestId: "req_test",
      message: { id: "msg_assistant_1", role: "assistant", content: "我准备了一条改写建议。" },
      toolCalls: [
        {
          id: "tool_1",
          name: "propose_summary_rewrite",
          status: "completed",
          title: "改写个人总结",
          summary: "生成一版更聚焦的个人总结。",
          input: {},
          result: {},
        },
      ],
      proposedPatches: [
        {
          id: "patch_1",
          toolCallId: "tool_1",
          label: "应用个人总结改写",
          section: "summary",
          fieldPath: "basics.summary",
          operation: "replace_plain_text",
          beforePlainText: "三年前端经验。",
          afterPlainText: "三年前端工程经验，擅长 React 与工程化交付。",
          changeSummary: "让总结更具体。",
          riskFlags: [],
        },
      ],
      usage: { provider: "test", model: "fake", inputTokens: 1, outputTokens: 1 },
    })),
  );

  render(<AgentPanel {...panelProps({ applyPatch })} />);
  await userEvent.click(screen.getByRole("button", { name: "诊断整份简历" }));

  expect(applyPatch).not.toHaveBeenCalled();
  await userEvent.click(await screen.findByRole("button", { name: "应用" }));
  expect(applyPatch).toHaveBeenCalledWith(expect.objectContaining({ id: "patch_1" }));
});
```

- [ ] **Step 2: Run failing panel tests**

Run:

```bash
pnpm vitest run tests/unit/agent-panel.test.tsx
```

Expected: FAIL until components exist.

- [ ] **Step 3: Implement preset workflows**

Create `components/agent/agent-preset-workflows.tsx`:

```tsx
"use client";

import type { AgentWorkflowId } from "@/lib/agent/agent-message-contract";
import { Button } from "@/components/ui/button";

const WORKFLOWS: Array<{ id: AgentWorkflowId; label: string; prompt: string }> = [
  { id: "resume-diagnose", label: "诊断整份简历", prompt: "请诊断这份简历，并优先指出最值得修改的一处。" },
  { id: "target-role-match", label: "目标岗位匹配", prompt: "请根据目标岗位检查这份简历的匹配度；如果缺少目标岗位，请先问我。" },
  { id: "experience-star", label: "经历 STAR 优化", prompt: "请帮我按 STAR 原则优化一段经历；如果需要选择经历，请先问我。" },
  { id: "pre-export-check", label: "终检导出前检查", prompt: "请在导出 PDF 前检查内容和格式风险。" },
];

export function AgentPresetWorkflows({
  disabled,
  onStart,
}: {
  disabled?: boolean;
  onStart: (workflow: { id: AgentWorkflowId; prompt: string }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {WORKFLOWS.map((workflow) => (
        <Button
          key={workflow.id}
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onStart(workflow)}
        >
          {workflow.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement tool card**

Create `components/agent/agent-tool-card.tsx`:

```tsx
"use client";

import type { AgentToolCall } from "@/lib/agent/agent-message-contract";

export function AgentToolCard({ toolCall }: { toolCall: AgentToolCall }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{toolCall.title}</div>
      <p className="mt-1 text-muted-foreground">{toolCall.summary}</p>
      <div className="mt-2 text-xs text-muted-foreground">tool: {toolCall.name}</div>
    </div>
  );
}
```

- [ ] **Step 5: Implement confirmation card**

Create `components/agent/agent-confirmation-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ResumePatch } from "@/lib/agent/agent-message-contract";
import { Button } from "@/components/ui/button";

export function AgentConfirmationCard({
  patch,
  onApply,
}: {
  patch: ResumePatch;
  onApply: (patch: ResumePatch) => void;
}) {
  const [resolved, setResolved] = useState<"applied" | "ignored" | null>(null);

  return (
    <div className="rounded-lg border bg-background p-3 text-sm shadow-sm">
      <div className="font-medium">{patch.label}</div>
      <p className="mt-1 text-muted-foreground">{patch.changeSummary}</p>
      <div className="mt-3 rounded-md bg-muted p-2 text-xs">
        <div className="text-muted-foreground">修改后</div>
        <div className="mt-1 whitespace-pre-wrap">{patch.afterPlainText}</div>
      </div>
      {patch.riskFlags.length > 0 && (
        <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {patch.riskFlags.map((flag) => flag.message).join("；")}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={resolved !== null}
          onClick={() => {
            onApply(patch);
            setResolved("applied");
          }}
        >
          应用
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={resolved !== null}
          onClick={() => setResolved("ignored")}
        >
          忽略
        </Button>
      </div>
      {resolved === "applied" && <p className="mt-2 text-xs text-emerald-600">已应用，等待自动保存。</p>}
      {resolved === "ignored" && <p className="mt-2 text-xs text-muted-foreground">已忽略这条建议。</p>}
    </div>
  );
}
```

- [ ] **Step 6: Implement panel shell**

Create `components/agent/agent-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, Send } from "lucide-react";
import type { ResumeContent } from "@/lib/resume-schema";
import type {
  AgentChatMessage,
  AgentMessageResponse,
  AgentResumeContext,
  AgentWorkflowId,
  ResumePatch,
} from "@/lib/agent/agent-message-contract";
import { buildAgentResumeContext } from "@/lib/agent/chat-context";
import { Button } from "@/components/ui/button";
import { AgentPresetWorkflows } from "@/components/agent/agent-preset-workflows";
import { AgentToolCard } from "@/components/agent/agent-tool-card";
import { AgentConfirmationCard } from "@/components/agent/agent-confirmation-card";

export function AgentPanel({
  resumeId,
  title,
  templateId,
  getResumeContent,
  completeness,
  applyPatch,
  flushAutosave,
  onBackToEdit,
}: {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyPatch: (patch: ResumePatch) => void;
  flushAutosave: () => void;
  onBackToEdit: () => void;
}) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<AgentMessageResponse["toolCalls"]>([]);
  const [patches, setPatches] = useState<ResumePatch[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function send(content: string, workflowId: AgentWorkflowId | null) {
    const userMessage: AgentChatMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsLoading(true);

    try {
      const response = await fetch("/api/agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId,
          locale: "zh-CN",
          workflowId,
          messages: nextMessages,
          context: buildAgentResumeContext({
            content: getResumeContent(),
            templateId,
            activeSection: null,
            completeness,
          }),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? "Agent 服务暂不可用");
      const result = data as AgentMessageResponse;
      setMessages((current) => [...current, result.message]);
      setToolCalls((current) => [...current, ...result.toolCalls]);
      setPatches((current) => [...current, ...result.proposedPatches]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="flex h-full flex-col bg-background">
      <div className="border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">简历 Agent</h2>
            <p className="mt-1 text-sm text-muted-foreground">AI 会读取当前表单快照，修改需你确认。</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onBackToEdit}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            切回编辑
          </Button>
        </div>
        <div className="mt-4">
          <AgentPresetWorkflows
            disabled={isLoading}
            onStart={(workflow) => void send(workflow.prompt, workflow.id)}
          />
        </div>
      </div>

      <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            选择一个工作流开始。第一版会先检查当前简历，并把可修改内容作为待确认建议展示。
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
            <div className="inline-block max-w-[85%] rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
              {message.content}
            </div>
          </div>
        ))}
        {toolCalls.map((toolCall) => <AgentToolCard key={toolCall.id} toolCall={toolCall} />)}
        {patches.map((patch) => (
          <AgentConfirmationCard
            key={patch.id}
            patch={patch}
            onApply={(nextPatch) => {
              applyPatch(nextPatch);
              flushAutosave();
            }}
          />
        ))}
      </div>

      <form
        className="border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const content = input.trim();
          if (!content || isLoading) return;
          setInput("");
          void send(content, null);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder={`问问 ${title || "简历"} 可以怎么优化`}
          />
          <Button type="submit" disabled={isLoading || input.trim() === ""}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 7: Run panel tests**

Run:

```bash
pnpm vitest run tests/unit/agent-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Agent panel**

Run:

```bash
git add components/agent/agent-panel.tsx components/agent/agent-preset-workflows.tsx components/agent/agent-tool-card.tsx components/agent/agent-confirmation-card.tsx tests/unit/agent-panel.test.tsx
git commit -m "feat(agent): add agent mode panel"
```

Expected: commit succeeds.

---

## Task 8: Integrate Agent Mode Into Editor

**Files:**
- Create: `components/agent/agent-mode-toggle.tsx`
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx`
- Test: `tests/unit/editor-client-agent-mode.test.tsx`

- [ ] **Step 1: Write failing editor integration tests**

Create `tests/unit/editor-client-agent-mode.test.tsx` using the existing render helpers from `tests/unit/editor-client-live-preview.test.tsx`.

Required assertions:

```ts
it("toggles Agent mode without unmounting the preview", async () => {
  renderEditorClient();
  expect(screen.getByTestId("live-preview")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Agent 模式" }));

  expect(screen.getByText("简历 Agent")).toBeInTheDocument();
  expect(screen.getByTestId("live-preview")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "切回编辑" })).toBeInTheDocument();
});

it("applies Agent patch through RHF and keeps autosave path", async () => {
  renderEditorClient();
  await userEvent.click(screen.getByRole("button", { name: "Agent 模式" }));

  // Mock /api/agent/messages to return a basics.summary replace_plain_text patch.
  // Start workflow, click 应用.
  // Assert the summary editor value or form preview reflects the new summary after switching back.
});
```

- [ ] **Step 2: Run failing editor tests**

Run:

```bash
pnpm vitest run tests/unit/editor-client-agent-mode.test.tsx
```

Expected: FAIL because toolbar does not have Agent mode.

- [ ] **Step 3: Create toggle button**

Create `components/agent/agent-mode-toggle.tsx`:

```tsx
"use client";

import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AgentModeToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={active}
      aria-label="Agent 模式"
      onClick={onClick}
      className={cn(
        "gap-1.5",
        active && "border-sky-400/60 bg-sky-500/5",
      )}
    >
      <MessageSquare className="h-3.5 w-3.5 text-transparent [stroke:url(#agent-mode-icon-gradient)]" />
      <svg aria-hidden className="absolute h-0 w-0">
        <linearGradient id="agent-mode-icon-gradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="55%" stopColor="#14b8a6" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </svg>
      <span className="bg-gradient-to-r from-sky-500 via-teal-500 to-amber-500 bg-clip-text text-transparent">
        Agent 模式
      </span>
    </Button>
  );
}
```

If the SVG gradient stroke is unreliable in tests/browser, keep the text gradient and use `text-sky-500` for the icon. Do not use a gradient background.

- [ ] **Step 4: Add Agent mode state and patch apply helper**

In `app/(app)/resume/[id]/edit/editor-client.tsx`:

Add imports:

```tsx
import { AgentModeToggle } from "@/components/agent/agent-mode-toggle";
import { AgentPanel } from "@/components/agent/agent-panel";
import type { ResumePatch } from "@/lib/agent/agent-message-contract";
```

Add state:

```tsx
const [isAgentMode, setIsAgentMode] = useState(false);
```

Add apply helper:

```tsx
function applyAgentPatch(patch: ResumePatch) {
  if (patch.operation === "replace_plain_text" && patch.fieldPath === "basics.summary") {
    form.setValue("basics.summary", patch.afterPlainText, { shouldDirty: true, shouldValidate: true });
    toast.success("已应用 Agent 建议");
    return;
  }

  if (patch.operation === "replace_tiptap_json" && patch.replacementTiptapJson) {
    form.setValue(patch.fieldPath as never, patch.replacementTiptapJson as never, {
      shouldDirty: true,
      shouldValidate: true,
    });
    toast.success("已应用 Agent 建议");
    return;
  }

  toast.error("这条 Agent 建议暂不支持自动应用");
}

function flushAgentAutosave() {
  window.dispatchEvent(new Event("resume:flush-autosave"));
}
```

If TypeScript rejects `form.setValue(patch.fieldPath as never, ...)`, replace it with a small allowlisted dispatcher:

```tsx
if (/^experience\.\d+\.content$/.test(patch.fieldPath)) {
  form.setValue(patch.fieldPath as `experience.${number}.content`, patch.replacementTiptapJson as never, { shouldDirty: true, shouldValidate: true });
}
```

- [ ] **Step 5: Add toolbar button**

Place after `ResumeDiagnoseButton`:

```tsx
<AgentModeToggle
  active={isAgentMode}
  onClick={() => {
    setShowTemplatePanel(false);
    setIsAgentMode((value) => !value);
  }}
/>
```

- [ ] **Step 6: Replace left panel content while keeping form mounted**

Inside the desktop left column, replace the editor scroll content with conditional rendering:

```tsx
{isAgentMode ? (
  <AgentPanel
    resumeId={id}
    title={title}
    templateId={template}
    getResumeContent={() => form.getValues() as ResumeContent}
    completeness={{ overall: 0, sections: [] }}
    applyPatch={applyAgentPatch}
    flushAutosave={flushAgentAutosave}
    onBackToEdit={() => setIsAgentMode(false)}
  />
) : (
  <div
    ref={editorPanelRef}
    className="thin-scrollbar h-full space-y-6 overflow-y-auto p-6"
  >
    ...
  </div>
)}
```

Use the existing `CompletenessScore` source of truth if it exposes data; if not, pass a minimal `{ overall: 0, sections: [] }` for Phase 3A and add a follow-up plan item to share completeness internals. Do not duplicate expensive completeness calculation in `EditorClient` unless existing helpers make it cheap.

- [ ] **Step 7: Hide resize handle in Agent mode**

Change the resize handle render:

```tsx
{!isAgentMode && (
  <div
    className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center hover:bg-accent active:bg-accent"
    onMouseDown={handleMouseDown}
  >
    <div className="h-8 w-0.5 rounded-full bg-border" />
  </div>
)}
```

For Phase 3A, use a stable split such as left `45%`, preview `55%` while Agent mode is active:

```tsx
style={{ flex: `0 0 ${isAgentMode ? 45 : splitPercent}%` }}
```

and:

```tsx
style={{ flex: `1 1 ${isAgentMode ? 55 : 100 - splitPercent}%` }}
```

- [ ] **Step 8: Run editor tests**

Run:

```bash
pnpm vitest run tests/unit/editor-client-agent-mode.test.tsx tests/unit/agent-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit editor integration**

Run:

```bash
git add components/agent/agent-mode-toggle.tsx 'app/(app)/resume/[id]/edit/editor-client.tsx' tests/unit/editor-client-agent-mode.test.tsx
git commit -m "feat(editor): add agent mode"
```

Expected: commit succeeds.

---

## Task 9: Verify End-to-End Behavior

**Files:**
- No planned source edits unless tests expose defects.

- [ ] **Step 1: Run Agent tests**

Run:

```bash
pnpm agent:test
```

Expected: PASS.

- [ ] **Step 2: Run Web unit tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Run Agent build**

Run:

```bash
pnpm agent:build
```

Expected: PASS.

- [ ] **Step 7: Manual smoke**

Run local services:

```bash
pnpm agent:dev
pnpm dev
```

Manual steps:

1. Open a desktop resume editor page.
2. Type a visible unsaved change in a normal editor field.
3. Click `Agent 模式`.
4. Confirm the left panel becomes `简历 Agent`.
5. Confirm right `LivePreview` remains visible.
6. Click `诊断整份简历`.
7. Confirm a user message, assistant message, and at least one tool card render.
8. If a patch card renders, confirm the content does not change before clicking `应用`.
9. Click `应用`.
10. Confirm preview updates through RHF.
11. Confirm autosave status moves to pending/saving/saved.
12. Click `切回编辑`.
13. Confirm the earlier unsaved editor change was not lost.

- [ ] **Step 8: Commit verification notes if docs changed**

If manual smoke reveals docs need updates, commit:

```bash
git add docs/agent/development.md docs/agent/implementation-roadmap.md
git commit -m "docs(agent): record phase 3a verification notes"
```

Expected: commit succeeds only if docs were changed.

---

## Implementation Risks and Guardrails

- assistant-ui package APIs may differ from current examples; isolate all assistant-ui imports inside `components/agent/agent-runtime-provider.tsx` and `components/agent/agent-panel.tsx`.
- If assistant-ui runtime integration becomes larger than expected, ship the product shell with a runtime seam first, then replace the local message renderer with assistant-ui primitives in a narrow follow-up. Do not block the core Web/Agent contract on a UI package fight.
- `replace_tiptap_json` must preserve list structure when source content is list-shaped. The Agent prompt and parser must prefer TipTap JSON replacement for rich text fields; Web must not collapse lists to one plain paragraph.
- Avoid high-frequency `useWatch` in the Agent panel. Use `form.getValues()` only when sending a message/workflow.
- Do not pass full resume content to the Agent if the capped context is enough.
- Do not add retries around `POST /v1/agent/messages`; provider calls are not idempotent.
- Do not store assistant-ui thread state inside `resume.content`.
- Do not log raw resume content in Agent service logs.

## Self-Review

Spec coverage:

- A方案 left editor replacement is covered by Tasks 7 and 8.
- `POST /v1/agent/messages` contract is covered by Tasks 1, 4, and 5.
- Basic resume modification tools are covered by Tasks 1, 3, 7, and 8.
- Human-confirmed writeback is covered by Tasks 7 and 8.
- Web authority over auth/RHF/preview/autosave is covered by Tasks 5 and 8.
- Agent boundaries around no Postgres/no direct save are covered by Tasks 1, 3, and 4.
- Verification gates are covered by Task 9.

Placeholder scan:

- The plan intentionally avoids `TODO`/`TBD`.
- The only flexible instruction is assistant-ui exact import shape, because the implementation must use the installed package types after `pnpm add`; the runtime seam prevents that uncertainty from spreading through the app.

Type consistency:

- Shared Web types use `AgentMessageRequest`, `AgentMessageResponse`, `AgentToolCall`, and `ResumePatch`.
- Agent service mirrors those names in service-local files.
- Web BFF and client both call the capability `sendAgentMessage`.
- The JWT scope is consistently `agent:chat`.
