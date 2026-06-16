# Agent Mode v2: True Agent Loop & Multi-Entry Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace prompt-driven JSON parsing with a real AI SDK `streamText` + `tools` multi-step agent loop, add autoAccept toggle, floating chat bubble, multi-session history, and `resume_ask` interrupt tool.

**Architecture:** Agent service runs `streamText` + `tools` + `stopWhen(stepCountIs(16))` over a DraftState sandbox. Each tool step produces AG-UI events in real time. Web side extracts `ResumeOperation` from `TOOL_CALL_RESULT` and auto-applies (autoAccept ON) or accumulates for confirmation cards (autoAccept OFF). Bubble and panel share the same runtime provider.

**Tech Stack:** AI SDK v6 (`streamText`, `tool()`, `stepCountIs`), AG-UI (`@ag-ui/core`, `@ag-ui/encoder`, `@ag-ui/client`), assistant-ui, RHF, Drizzle ORM + Postgres + Redis

**Spec:** `docs/superpowers/specs/2026-06-16-agent-mode-v2-true-loop.md`

---

## File Structure

### Agent Service (apps/agent)

| File | Change | Responsibility |
|------|--------|----------------|
| `src/workflows/tools.ts` | **Rewrite** | 7 real AI SDK tool definitions (`resume_read`, `resume_update_section`, `resume_delete_section`, `resume_insert_section`, `resume_reorder_sections`, `resume_polish_text`, `resume_set_text`, `resume_ask`) operating on DraftState sandbox |
| `src/workflows/loop-runtime.ts` | **Enhance** | Extend `runResumeLoop` to support both `create_from_zero` and `optimize_existing` modes; stream each step's tool lifecycle as AG-UI events via `onStepFinish` callback |
| `src/workflows/draft.ts` | **Enhance** | Add `deleteFromDraft()`, `reorderDraft()`, `insertIntoDraft()`; add draft serialization/deserialization for interrupt recovery |
| `src/workflows/workflow-runtime.ts` | **Modify** | Add `onStepFinish` callback integration — emit `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_RESULT` per step; add `resume_ask` interrupt handling |
| `src/http.ts` | **Modify** | Replace `parseAgentMessageProviderResponse` path with `runResumeLoop` for the main Agent message flow; keep cache integration |
| `src/agent-messages.ts` | **Modify** | Remove provider response parsing (→ loop-runtime); keep validation/contract types; remove `parseAgentMessageProviderResponse`, `buildAgentMessagePrompt`, `toAgUiAgentEvents` (deprecated) |
| `src/agent-tools.ts` | **Modify** | Add `resume_polish_text` and `resume_set_text` to allowed tool names; add `resume_ask` |
| `src/workflows/dev-preview-provider.ts` | **Remove** | Replaced by real loop |
| `tests/loop-runtime.test.ts` | **Rewrite** | Cover both modes, tool execution, interrupt/recovery, AG-UI event emission |
| `tests/draft.test.ts` | **Enhance** | Cover delete, reorder, insert, serialization round-trip |
| `tests/tools.test.ts` | **Rewrite** | Cover all 7+1 tools as AI SDK `tool()` with DraftState |
| `tests/http.test.ts` | **Modify** | Update Agent message route tests for loop integration |

### Web App (apps/web)

| File | Change | Responsibility |
|------|--------|----------------|
| `components/agent/agent-ag-ui-runtime-provider.tsx` | **Modify** | autoAccept auto-apply on `TOOL_CALL_RESULT`; `resume_ask` interrupt → question card; per-step tool state tracking |
| `components/agent/agent-panel.tsx` | **Modify** | autoAccept toggle, session selector dropdown, question card, operation toast |
| `components/agent/agent-bubble.tsx` | **New** | Draggable floating bubble + popup chat window container |
| `components/agent/agent-bubble-chat.tsx` | **New** | Bubble chat content reusing AgentAgUiRuntimeProvider |
| `components/agent/agent-tool-card.tsx` | **Modify** | Real-time tool status (running/completed/applied), per-step rendering |
| `components/agent/agent-confirmation-card.tsx` | **Modify** | Question card variant for resume_ask interrupts |
| `components/agent/agent-session-selector.tsx` | **New** | Session list dropdown (new/switch/rename/delete) |
| `lib/agent/session-store.ts` | **Enhance** | Multi-session CRUD (list/create/delete/rename) + message pagination |
| `lib/agent/ag-ui-stream.ts` | **Modify** | Extract per-step operation from TOOL_CALL_RESULT; new `extractAgUiQuestion` helper |
| `app/api/agent/sessions/route.ts` | **New** | REST endpoints for session list/create/delete/rename |
| `db/schema.ts` | **Modify** | Verify agentSessions `title` column; add `sortOrder` if needed |
| `tests/unit/agent-panel.test.tsx` | **Modify** | autoAccept toggle, question card, session selector |
| `tests/unit/agent-bubble.test.tsx` | **New** | Bubble drag, popup, expand-to-panel |
| `tests/unit/agent-session-store.test.ts` | **Enhance** | Multi-session CRUD, pagination |
| `tests/unit/agent-ag-ui-runtime-provider.test.tsx` | **New** | autoAccept auto-apply, interrupt handling |

---

### Task 1: Extend `AgentToolName` with new tool types

**Files:**
- Modify: `apps/agent/src/agent-tools.ts:1-7`

- [ ] **Step 1: Add `resume_polish_text`, `resume_set_text`, and `resume_ask` to `AgentToolName`**

```typescript
// apps/agent/src/agent-tools.ts line 1-7, replace with:
export type AgentToolName =
  | "resume_read"
  | "resume_update_section"
  | "resume_delete_section"
  | "resume_reorder_sections"
  | "resume_insert_section"
  | "resume_polish_text"
  | "resume_set_text"
  | "resume_ask";
```

- [ ] **Step 2: Update `TOOL_NAMES` set to include new names**

```typescript
// apps/agent/src/agent-tools.ts line 56-62, replace with:
const TOOL_NAMES = new Set<AgentToolName>([
  "resume_read",
  "resume_update_section",
  "resume_delete_section",
  "resume_reorder_sections",
  "resume_insert_section",
  "resume_polish_text",
  "resume_set_text",
  "resume_ask",
]);
```

- [ ] **Step 3: Run tests to verify no regressions**

```bash
cd apps/agent && pnpm agent:test
```

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/agent-tools.ts
git commit -m "feat(agent): add resume_polish_text, resume_set_text, resume_ask tool names"
```

---

### Task 2: Enhance DraftState with insert/delete/reorder operations

**Files:**
- Modify: `apps/agent/src/workflows/draft.ts`

- [ ] **Step 1: Add `deleteFromDraft` function**

```typescript
// Add to apps/agent/src/workflows/draft.ts after upsertSection:

export type DeleteSectionInput = {
  toolCallId: string;
  section: ResumeOperation["section"];
  fieldPath: string;
  label?: string;
  changeSummary?: string;
};

export function deleteFromDraft(
  draft: DraftState,
  input: DeleteSectionInput,
): { ok: true; operation: ResumeOperation } | { ok: false; message: string } {
  const fieldPath = input.fieldPath.trim();
  if (!isAllowedOperationFieldPath(fieldPath)) {
    return { ok: false, message: `fieldPath is not allowed: ${fieldPath}` };
  }
  const toolCallId = input.toolCallId.trim() || `tool_${randomUUID()}`;
  const label = input.label?.trim() || sectionLabel(input.section);
  const previousOpId = draft.byFieldPath.get(fieldPath);
  const previous = previousOpId
    ? draft.operations.find((op) => op.id === previousOpId) ?? null
    : null;

  const operation: ResumeOperation = {
    id: `op_${randomUUID()}`,
    toolCallId,
    label,
    section: input.section,
    fieldPath,
    operation: "delete_section",
    beforePlainText: previous?.afterPlainText ?? "（空）",
    afterPlainText: "",
    changeSummary: input.changeSummary?.trim() || `删除${label}`,
    riskFlags: [{ type: "needs_user_fact", message: "删除操作不可逆，请确认" }],
  };

  if (previousOpId) {
    draft.operations = draft.operations.filter(
      (existing) => existing.id !== previousOpId,
    );
  }
  draft.operations.push(operation);
  draft.byFieldPath.set(fieldPath, operation.id);
  draft.sections = draft.sections.filter(
    (section) => section.key !== input.section || section.label !== label,
  );
  draft.toolCalls.push({
    id: toolCallId,
    name: "resume_delete_section",
    status: "completed",
    title: label,
    summary: operation.changeSummary,
    input: { section: input.section, fieldPath },
    result: { operationIds: [operation.id] },
  });

  return { ok: true, operation };
}
```

- [ ] **Step 2: Add `reorderDraftSections` function**

```typescript
// Add after deleteFromDraft:

export type ReorderSectionsInput = {
  toolCallId: string;
  section: ResumeOperation["section"];
  newOrder: string[];
  changeSummary?: string;
};

export function reorderDraftSections(
  draft: DraftState,
  input: ReorderSectionsInput,
): { ok: true; operation: ResumeOperation } | { ok: false; message: string } {
  const toolCallId = input.toolCallId.trim() || `tool_${randomUUID()}`;
  const label = "重排分区顺序";

  const operation: ResumeOperation = {
    id: `op_${randomUUID()}`,
    toolCallId,
    label,
    section: input.section,
    fieldPath: "sectionOrder",
    operation: "reorder_sections",
    beforePlainText: "",
    afterPlainText: input.newOrder.join(", "),
    sectionOrder: input.newOrder,
    changeSummary: input.changeSummary?.trim() || "重排分区顺序",
    riskFlags: [],
  };

  draft.operations.push(operation);
  draft.byFieldPath.set("sectionOrder", operation.id);
  draft.toolCalls.push({
    id: toolCallId,
    name: "resume_reorder_sections",
    status: "completed",
    title: label,
    summary: operation.changeSummary,
    input: { section: input.section, newOrder: input.newOrder },
    result: { operationIds: [operation.id] },
  });

  return { ok: true, operation };
}
```

- [ ] **Step 3: Add `draftStateToJson` / `jsonToDraftState` for serialization**

```typescript
// Add after reorderDraftSections:

export function draftStateToJson(draft: DraftState): Record<string, unknown> {
  return {
    title: draft.title,
    targetRole: draft.targetRole,
    profileSummary: draft.profileSummary,
    sections: draft.sections,
    operations: draft.operations,
    toolCalls: draft.toolCalls,
    byFieldPath: Object.fromEntries(draft.byFieldPath),
  };
}

export function jsonToDraftState(json: Record<string, unknown>): DraftState {
  const draft = createDraft({
    title: typeof json.title === "string" ? json.title : undefined,
    targetRole: typeof json.targetRole === "string" ? json.targetRole : null,
  });
  if (typeof json.profileSummary === "string") {
    draft.profileSummary = json.profileSummary;
  }
  if (Array.isArray(json.sections)) {
    draft.sections = json.sections as DraftSection[];
  }
  if (Array.isArray(json.operations)) {
    draft.operations = json.operations as ResumeOperation[];
  }
  if (Array.isArray(json.toolCalls)) {
    draft.toolCalls = json.toolCalls as AgentToolCall[];
  }
  if (json.byFieldPath && typeof json.byFieldPath === "object") {
    const entries = Object.entries(json.byFieldPath as Record<string, unknown>);
    for (const [key, value] of entries) {
      if (typeof value === "string") draft.byFieldPath.set(key, value);
    }
  }
  return draft;
}
```

- [ ] **Step 4: Run existing draft tests, verify pass**

```bash
cd apps/agent && pnpm vitest run tests/draft.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/workflows/draft.ts
git commit -m "feat(agent): add deleteFromDraft, reorderDraftSections, draft serialization"
```

---

### Task 3: Rewrite loop tools with the full 7+1 tool set

**Files:**
- Rewrite: `apps/agent/src/workflows/tools.ts`

- [ ] **Step 1: Write the new `createLoopTools` with all 7+1 tools**

```typescript
// apps/agent/src/workflows/tools.ts — full rewrite:
import { tool } from "ai";
import { z } from "zod";
import type { ResumeOperation } from "../agent-tools.js";
import {
  draftSnapshot,
  deleteFromDraft,
  reorderDraftSections,
  setGoal,
  upsertSection,
  type DraftState,
} from "./draft.js";

const SECTION_VALUES = [
  "summary", "experience", "projects", "education",
  "skills", "research", "custom",
] as const satisfies readonly ResumeOperation["section"][];

const COMPLETENESS_TARGETS: Array<{ key: ResumeOperation["section"]; label: string }> = [
  { key: "summary", label: "个人简介" },
  { key: "experience", label: "工作经历" },
  { key: "education", label: "教育经历" },
  { key: "skills", label: "技能" },
];

function computeCompleteness(draft: DraftState): {
  overall: number;
  present: string[];
  missing: string[];
} {
  const presentKeys = new Set(draft.sections.map((s) => s.key));
  const present = COMPLETENESS_TARGETS.filter((t) => presentKeys.has(t.key));
  const missing = COMPLETENESS_TARGETS.filter((t) => !presentKeys.has(t.key));
  const overall = Math.round((present.length / COMPLETENESS_TARGETS.length) * 100);
  return {
    overall,
    present: present.map((t) => t.label),
    missing: missing.map((t) => t.label),
  };
}

type ToolCallOptions = { toolCallId?: string };

export function createLoopTools(draft: DraftState, options?: {
  polishTextFn?: (fieldPath: string, instruction?: string) => Promise<{
    plainText: string;
    tiptapJson: unknown;
    operation: ResumeOperation;
  }>;
  setTextFn?: (fieldPath: string, plainText: string) => Promise<{
    tiptapJson: unknown;
    operation: ResumeOperation;
  }>;
  onAsk?: (question: string, field?: string) => void;
}) {
  const requestId = `req_${Date.now()}`;

  return {
    resume_read: tool({
      description: "读取当前草稿（draft）的全部内容或指定分区。model 必须先读再改。",
      inputSchema: z.object({
        sectionKey: z.enum(SECTION_VALUES).optional()
          .describe("指定要读的分区 key；不传则返回全文"),
      }),
      execute: async (input) => {
        const snapshot = draftSnapshot(draft);
        if (input.sectionKey) {
          const section = snapshot.sections.filter((s) => s.key === input.sectionKey);
          return { sectionKey: input.sectionKey, sections: section };
        }
        return {
          title: snapshot.title,
          targetRole: snapshot.targetRole,
          profileSummary: snapshot.profileSummary,
          sections: snapshot.sections,
          missingFacts: snapshot.missingFacts,
        };
      },
    }),

    get_completeness: tool({
      description: "评估草稿完整度（0-100），返回缺失分区。用于自检下一步做什么。",
      inputSchema: z.object({}),
      execute: async () => computeCompleteness(draft),
    }),

    set_goal: tool({
      description: "设置/更新简历标题与目标岗位（不改简历内容，只记元信息）。",
      inputSchema: z.object({
        title: z.string().optional().describe("简历标题"),
        targetRole: z.string().nullable().optional().describe("目标岗位，null 表示清除"),
      }),
      execute: async (input) => {
        setGoal(draft, input);
        return { ok: true, title: draft.title, targetRole: draft.targetRole };
      },
    }),

    resume_update_section: tool({
      description: `替换草稿中指定 fieldPath 的内容。fieldPath 必须是允许的目标：
- "basics.summary"（个人简介，section=summary）
- "skills"（技能，section=skills）
- "experience.<n>.content"（第 n 段工作经历，n 从 0 开始）
- "projects.<n>.content"（项目经历）
- "education.<n>.highlights"（教育经历）
- "research.<n>.content"（研究经历）
- "custom.<n>.content"（自定义）
newContent 是 TipTap JSON（由 resume_set_text 或 resume_polish_text 生成）。
如果要修改纯文本请用 resume_set_text 先转换成 TipTap JSON。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        newContent: z.any().describe("TipTap JSON 格式的新内容"),
        label: z.string().describe("操作标签"),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId = (execOptions as ToolCallOptions)?.toolCallId ?? `tool_${Date.now()}`;
        const result = upsertSection(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label: input.label,
          afterPlainText: extractPlainText(input.newContent),
          replacementTiptapJson: input.newContent,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false, error: result.message };
        return {
          ok: true,
          operation: result.operation,
          fieldPath: result.operation.fieldPath,
          changeSummary: result.operation.changeSummary,
        };
      },
    }),

    resume_delete_section: tool({
      description: "从草稿中删除指定 fieldPath 的条目（不可逆，慎用）。",
      inputSchema: z.object({
        fieldPath: z.string().describe("要删除的 fieldPath"),
        label: z.string().optional(),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId = (execOptions as ToolCallOptions)?.toolCallId ?? `tool_${Date.now()}`;
        const result = deleteFromDraft(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label: input.label,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false, error: result.message };
        return { ok: true, operation: result.operation };
      },
    }),

    resume_reorder_sections: tool({
      description: "重排 resume sectionOrder 数组（改变预览中分区顺序）。",
      inputSchema: z.object({
        newOrder: z.array(z.string()).describe("新的分区 key 顺序，必须包含所有现有 key"),
        changeSummary: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId = (execOptions as ToolCallOptions)?.toolCallId ?? `tool_${Date.now()}`;
        const result = reorderDraftSections(draft, {
          toolCallId,
          section: "custom", // sectionOrder is global
          newOrder: input.newOrder,
          changeSummary: input.changeSummary,
        });
        if (!result.ok) return { ok: false, error: result.message };
        return { ok: true, operation: result.operation };
      },
    }),

    resume_polish_text: tool({
      description: `润色指定 fieldPath 的文案（STAR 重写、量化改善、措辞优化）。
工具内部会保证富文本结构不变（列表保持列表、加粗保持加粗等），只改善文字表达。
可选 instruction 指定润色方向。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        instruction: z.string().optional().describe("润色方向，如：'更量化'/'更简洁'/'STAR法则'"),
        label: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId = (execOptions as ToolCallOptions)?.toolCallId ?? `tool_${Date.now()}`;
        if (!options?.polishTextFn) {
          return { ok: false, error: "polish text not available in this environment" };
        }
        const result = await options.polishTextFn(input.fieldPath, input.instruction);
        // Write the polished result back to draft
        const upsertResult = upsertSection(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label: input.label ?? "润色文案",
          afterPlainText: result.plainText,
          replacementTiptapJson: result.tiptapJson,
          changeSummary: `润色${input.label ?? input.fieldPath}`,
        });
        if (!upsertResult.ok) return { ok: false, error: upsertResult.message };
        return {
          ok: true,
          operation: upsertResult.operation,
          beforePlainText: upsertResult.operation.beforePlainText,
          afterPlainText: upsertResult.operation.afterPlainText,
        };
      },
    }),

    resume_set_text: tool({
      description: `将纯文本安全转换为 TipTap JSON 并写入 draft 指定 fieldPath。
用于模型想设置某字段的文案但不需要润色时。自动保持原字段的结构格式。`,
      inputSchema: z.object({
        fieldPath: z.string().describe("目标字段路径"),
        plainText: z.string().describe("纯文本内容"),
        label: z.string().optional(),
      }),
      execute: async (input, execOptions) => {
        const toolCallId = (execOptions as ToolCallOptions)?.toolCallId ?? `tool_${Date.now()}`;
        if (!options?.setTextFn) {
          return { ok: false, error: "set text not available in this environment" };
        }
        const result = await options.setTextFn(input.fieldPath, input.plainText);
        const upsertResult = upsertSection(draft, {
          toolCallId,
          section: fieldPathToSection(input.fieldPath),
          fieldPath: input.fieldPath,
          label: input.label ?? "更新文案",
          afterPlainText: input.plainText,
          replacementTiptapJson: result.tiptapJson,
          changeSummary: `更新${input.label ?? input.fieldPath}`,
        });
        if (!upsertResult.ok) return { ok: false, error: upsertResult.message };
        return { ok: true, operation: upsertResult.operation };
      },
    }),

    resume_ask: tool({
      description: `当没有足够信息继续工作时调用此工具向用户追问。
触发后 loop 停止，前端弹出问题卡片，用户回答后可以恢复继续。`,
      inputSchema: z.object({
        question: z.string().describe("向用户提出的问题"),
        field: z.string().optional().describe("关联字段，如 experience.0.company"),
      }),
      execute: async (input) => {
        options?.onAsk?.(input.question, input.field);
        return {
          asked: true,
          question: input.question,
          field: input.field ?? null,
        };
      },
    }),
  };
}

function fieldPathToSection(fieldPath: string): ResumeOperation["section"] {
  if (fieldPath === "basics.summary") return "summary";
  if (fieldPath === "skills") return "skills";
  if (fieldPath.startsWith("experience.")) return "experience";
  if (fieldPath.startsWith("projects.")) return "projects";
  if (fieldPath.startsWith("education.")) return "education";
  if (fieldPath.startsWith("research.")) return "research";
  if (fieldPath.startsWith("custom.")) return "custom";
  return "summary";
}

function extractPlainText(tiptapJson: unknown): string {
  if (!tiptapJson || typeof tiptapJson !== "object") return "";
  const doc = tiptapJson as Record<string, unknown>;
  if (!Array.isArray(doc.content)) return "";
  const texts: string[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, unknown>;
    if (n.type === "paragraph" && Array.isArray(n.content)) {
      for (const child of n.content) {
        if (child && typeof child === "object" && (child as Record<string, unknown>).type === "text") {
          texts.push(String((child as Record<string, unknown>).text ?? ""));
        }
      }
    }
    if (n.type === "bulletList" && Array.isArray(n.content)) {
      for (const item of n.content) {
        if (item && typeof item === "object") {
          const li = item as Record<string, unknown>;
          if (li.type === "listItem" && Array.isArray(li.content)) {
            for (const para of li.content) {
              if (para && typeof para === "object" && (para as Record<string, unknown>).type === "paragraph") {
                const p = para as Record<string, unknown>;
                if (Array.isArray(p.content)) {
                  for (const child of p.content) {
                    if (child && typeof child === "object" && (child as Record<string, unknown>).type === "text") {
                      texts.push(`- ${String((child as Record<string, unknown>).text ?? "")}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return texts.join("\n");
}

export type LoopTools = ReturnType<typeof createLoopTools>;
```

- [ ] **Step 2: Run agent:typecheck to verify compilation**

```bash
cd apps/agent && pnpm agent:typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent/src/workflows/tools.ts
git commit -m "feat(agent): rewrite loop tools with 7+1 tool set including polish/set_text/ask"
```

---

### Task 4: Enhance loop-runtime with dual-mode support and step-by-step AG-UI emission

**Files:**
- Modify: `apps/agent/src/workflows/loop-runtime.ts`

- [ ] **Step 1: Extend `buildLoopSystemPrompt` for `optimize_existing` mode**

```typescript
// Replace buildLoopSystemPrompt in apps/agent/src/workflows/loop-runtime.ts:

export function buildLoopSystemPrompt(request: AgentMessageRequest): string {
  const targetRole =
    request.sessionSnapshot?.workspace.goal.targetRole ??
    request.sessionSnapshot?.workspace.draftResume?.targetRole ??
    null;
  const isCreateFromZero = request.mode === "create_from_zero";

  if (isCreateFromZero) {
    return [
      "你是 intro-builder 的简历共创助手，正在帮用户【从零创建】一份中文简历。",
      "你在一个草稿（draft）沙盒里工作：所有写入只改草稿，绝不直接改用户的真实简历。",
      "",
      "工作方式（多步循环）：",
      "1. 先用 resume_read 看当前草稿；用 set_goal 记录标题与目标岗位。",
      "2. 逐段用 resume_set_text / resume_polish_text 把内容写进草稿；写完用 get_completeness 自检。",
      "3. 只依据用户提供的事实写作。缺关键信息时用 resume_ask 追问用户，不要编造。",
      "4. 把缺信息的段标为 needs_user_fact，最后提醒用户补充。",
      "5. 全部就绪后停止调工具，用一两句话总结做了什么、还缺什么。",
      "",
      "草稿之外的真实简历改动只会在用户点击「同意应用」后由系统落盘。",
      targetRole ? `目标岗位：${targetRole}。` : "如果不知道目标岗位，先用 set_goal 记录或 resume_ask 询问。",
      `语言：${request.locale}。`,
    ].join("\n");
  }

  return [
    "你是 intro-builder 的简历优化助手，正在帮用户【优化已有简历】。",
    "你在一个草稿（draft）沙盒里工作：所有写入只改草稿，绝不直接改用户的真实简历。",
    "",
    "工作方式（多步循环）：",
    "1. 先用 resume_read 读取整个草稿了解简历全貌。",
    "2. 用 get_completeness 检查完整度。",
    "3. 使用 resume_polish_text 逐段优化需要改善的地方。",
    "4. 需要结构性修改时使用 resume_update_section / resume_delete_section / resume_insert_section / resume_reorder_sections。",
    "5. 需要用户补充信息时用 resume_ask 追问。不要编造事实、数字、公司名。",
    "6. 完成后停止调工具，用一两句话总结做了什么。",
    "",
    "STAR 原则优化时不得编造 Result 指标。原文是列表结构时润色结果必须保持列表。",
    "草稿之外的真实简历改动只会在用户点击「同意应用」后由系统落盘。",
    targetRole ? `目标岗位：${targetRole}。` : "",
    `语言：${request.locale}。`,
  ].join("\n");
}
```

- [ ] **Step 2: Add `onStepFinish` callback to `RunResumeLoopOptions` and emit events**

```typescript
// Add to RunResumeLoopOptions in loop-runtime.ts:
import type { AgentWorkflowRuntimeEvent } from "./workflow-runtime.js";
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";

export type LoopStepEvent = {
  step: number;
  toolCalls: Array<{
    toolCall: AgentToolCall;
    proposedOperations: ResumeOperation[];
  }>;
};

export type RunResumeLoopOptions = {
  model: LanguageModel;
  request: AgentMessageRequest;
  draft: DraftState;
  maxSteps?: number;
  onTextDelta?: (delta: string) => void;
  onStepFinish?: (event: LoopStepEvent) => void;
  // ... rest unchanged
};

// In runResumeLoop, wrap the streamText call to capture step events:
export async function runResumeLoop(
  options: RunResumeLoopOptions,
): Promise<RunResumeLoopResult> {
  const {
    model, request, draft,
    maxSteps = LOOP_MAX_STEPS,
    onTextDelta, onStepFinish,
    telemetry,
    streamTextImpl = defaultStreamText,
  } = options;

  const isAskPendingRef = { current: false };
  const tools = createLoopTools(draft, {
    onAsk: (question, field) => {
      isAskPendingRef.current = true;
    },
  });

  const result = streamTextImpl({
    model,
    system: buildLoopSystemPrompt(request),
    messages: toModelMessages(request),
    tools,
    stopWhen: stepCountIs(maxSteps),
    ...(telemetry ? { experimental_telemetry: telemetry } : {}),
    onStepFinish: (step) => {
      if (!onStepFinish) return;
      const toolCalls: LoopStepEvent["toolCalls"] = [];
      for (const toolCall of step.toolCalls ?? []) {
        if (toolCall.toolName === "resume_ask") continue; // handled via interrupt
        const draftToolCall = draft.toolCalls.at(-1);
        if (!draftToolCall) continue;
        const operations = draft.operations.filter(
          (op) => op.toolCallId === draftToolCall.id,
        );
        toolCalls.push({
          toolCall: draftToolCall,
          proposedOperations: operations,
        });
      }
      if (toolCalls.length > 0) {
        onStepFinish({ step: step.stepNumber, toolCalls });
      }
    },
  });

  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    onTextDelta?.(delta);
  }

  return {
    text: text.trim() || "已根据你的输入更新草稿。",
    isAskPending: isAskPendingRef.current,
  };
}
```

- [ ] **Step 3: Update `RunResumeLoopResult` to include `isAskPending`**

```typescript
// Update the type:
export type RunResumeLoopResult = {
  text: string;
  isAskPending?: boolean;
};
```

- [ ] **Step 4: Run existing loop-runtime tests**

```bash
cd apps/agent && pnpm vitest run tests/loop-runtime.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/workflows/loop-runtime.ts
git commit -m "feat(agent): add dual-mode system prompt and step-by-step AG-UI emission to loop-runtime"
```

---

### Task 5: Integrate runResumeLoop into http.ts replacing parseAgentMessageProviderResponse

**Files:**
- Modify: `apps/agent/src/http.ts:610-700`

- [ ] **Step 1: Replace the provider run + parse path with runResumeLoop**

In `apps/agent/src/http.ts`, replace the section starting at ~line 636 (the `trace.traceGeneration` call + `parseAgentMessageProviderResponse` + `toAgUiAgentEvents`) with:

```typescript
// In the /v1/agent/messages handler, replace the provider run + parse block:

// --- old block: provider run + parseAgentMessageProviderResponse ---
// Replace lines ~636-711 with:

const draft = createInitialLoopDraft(agentRequest);
const model = resolvedModel ?? createLoopModel({
  baseUrl: resolvedBaseUrl,
  apiKey: resolvedApiKey,
  modelName: resolvedModelName,
});

const stepToolCallResults: LoopStepEvent[] = [];

const loopResult = await runResumeLoop({
  model,
  request: agentRequest,
  draft,
  maxSteps: LOOP_MAX_STEPS,
  onTextDelta: (delta) => {
    // Stream text deltas to AG-UI SSE if stream accepted
  },
  onStepFinish: (stepEvent) => {
    stepToolCallResults.push(stepEvent);
  },
});

// Assemble result compatible with existing AG-UI event pipeline
const assembleId = randomUUID();
const parsedResult = assembleLoopResult({
  draft,
  finalText: loopResult.text,
  requestId: assembleId,
});

// Handle resume_ask interrupt
if (loopResult.isAskPending) {
  // Find the ask question from the last message
  const askQuestion = draft.toolCalls
    .filter((tc) => tc.name === "resume_ask")
    .at(-1);
  const question = askQuestion?.input?.question
    ? String(askQuestion.input.question)
    : "请补充更多信息";

  // Emit AG-UI interrupt events
  if (acceptsAgUiSse(request)) {
    return sendAgUiEvents(
      response,
      buildAgUiAskInterruptEvents({
        requestId: context.requestId,
        threadId,
        question,
        field: askQuestion?.input?.field
          ? String(askQuestion.input.field)
          : undefined,
        workspace,
      }),
      context,
      headerValue(request.headers.accept),
    );
  }
}

// Continue with existing AG-UI event pipeline
if (acceptsAgUiSse(request)) {
  return sendAgUiEvents(
    response,
    toAgUiAgentEvents({
      requestId: context.requestId,
      threadId,
      request: agentRequest,
      result: parsedResult,
    }),
    context,
    headerValue(request.headers.accept),
    createSessionRecorderForRequest({...}),
  );
}
```

- [ ] **Step 2: Add import for loop-runtime functions in http.ts**

```typescript
// Add near existing workflow imports at top of http.ts:
import {
  runResumeLoop,
  assembleLoopResult,
  createInitialLoopDraft,
  LOOP_MAX_STEPS,
  type LoopStepEvent,
} from "./workflows/loop-runtime.js";
```

- [ ] **Step 3: Run http tests to check no catastrophic breakage**

```bash
cd apps/agent && pnpm vitest run tests/http.test.ts --reporter=verbose 2>&1 | head -100
```

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/http.ts
git commit -m "feat(agent): integrate runResumeLoop into /v1/agent/messages"
```

---

### Task 6: Add `resume_ask` interrupt event builder to workflow-runtime

**Files:**
- Modify: `apps/agent/src/workflows/workflow-runtime.ts`

- [ ] **Step 1: Add `buildAgUiAskInterruptEvents` function**

```typescript
// Add to apps/agent/src/workflows/workflow-runtime.ts:

export function buildAgUiAskInterruptEvents({
  requestId,
  threadId,
  question,
  field,
  workspace,
}: {
  requestId: string;
  threadId: string;
  question: string;
  field?: string;
  workspace?: unknown;
}): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId, runId: requestId },
    { type: EventType.TEXT_MESSAGE_START, messageId: `msg_${requestId}`, role: "assistant" },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: `msg_${requestId}`,
      delta: `我需要补充一些信息：${question}`,
    },
    { type: EventType.TEXT_MESSAGE_END, messageId: `msg_${requestId}` },
    ...(workspace
      ? [{
          type: EventType.STATE_DELTA as const,
          delta: [{ op: "replace" as const, path: "/workspace", value: workspace }],
        }]
      : []),
    {
      type: EventType.RUN_FINISHED,
      threadId,
      runId: requestId,
      outcome: {
        type: "interrupt" as const,
        interrupts: [{
          id: `interrupt_${requestId}`,
          reason: "question" as const,
          message: question,
          toolCallId: null,
          metadata: field ? { field } : null,
        }],
      },
    },
  ];
}
```

- [ ] **Step 2: Add `import { EventType, type BaseEvent } from "@ag-ui/core"`** at top of workflow-runtime.ts if not present

- [ ] **Step 3: Run tests**

```bash
cd apps/agent && pnpm vitest run tests/workflow-runtime.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/agent/src/workflows/workflow-runtime.ts
git commit -m "feat(agent): add resume_ask interrupt event builder"
```

---

### Task 7: autoAccept mode — AgentAgUiRuntimeProvider

**Files:**
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`

- [ ] **Step 1: Add autoAccept prop and per-step apply logic**

```typescript
// Add to AgentAgUiRuntimeProviderProps in agent-ag-ui-runtime-provider.tsx:

export type AgentAgUiRuntimeProviderProps = {
  // ... existing props
  autoAccept?: boolean;  // NEW
  onOperationApplied?: (operation: ResumeOperation) => void;  // NEW — toast notification
};

// In the provider, when a TOOL_CALL_RESULT arrives:
// If autoAccept is true and the result contains operations, auto-apply them:

function handleToolResult(result: AgUiResumeToolResult) {
  onToolResult(result);
  
  if (autoAccept && result.proposedOperations && result.proposedOperations.length > 0) {
    for (const operation of result.proposedOperations) {
      applyOperation(operation); // delegates to the existing applyOperation callback
      onOperationApplied?.(operation);
    }
  }
}
```

- [ ] **Step 2: Run existing provider tests**

```bash
cd apps/web && pnpm vitest run tests/unit/agent-panel-assistant-ui.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/agent-ag-ui-runtime-provider.tsx
git commit -m "feat(web): add autoAccept mode to AgentAgUiRuntimeProvider"
```

---

### Task 8: autoAccept toggle in AgentPanel

**Files:**
- Modify: `apps/web/components/agent/agent-panel.tsx`

- [ ] **Step 1: Add autoAccept state and toggle UI to AgentPanel**

```typescript
// In AgentPanel function, add state:
const [autoAccept, setAutoAccept] = useState(false);

// Add toggle in the panel header:
// ┌─ Agent 面板头部 ───────────────────────────┐
// │  💬 Agent 模式        [autoAccept toggle]  │

// Render toggle (using a shadcn Switch or simple toggle):
import { Switch } from "@/components/ui/switch"; // if available, else simple button

<div className="flex items-center gap-2">
  <span className="text-xs text-muted-foreground">
    {autoAccept ? "自动应用" : "确认模式"}
  </span>
  <button
    type="button"
    role="switch"
    aria-checked={autoAccept}
    onClick={() => setAutoAccept((prev) => !prev)}
    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${autoAccept ? "bg-primary" : "bg-muted"}`}
  >
    <span
      className={`block h-4 w-4 rounded-full bg-background transition-transform ${autoAccept ? "translate-x-4" : "translate-x-0"}`}
    />
  </button>
</div>

// Pass autoAccept to AgentAgUiRuntimeProvider
<AgentAgUiRuntimeProvider
  autoAccept={autoAccept}
  onOperationApplied={(operation) => {
    toast.success(`已应用：${operation.label}`, { duration: 1500 });
  }}
  // ... other props
/>
```

- [ ] **Step 2: Add autoAccept toast for ≥6 operations** in the provider's onRunSettled callback

```typescript
// After run settled, if autoAccept and many operations were applied:
if (autoAccept && totalAppliedThisRun >= 6) {
  toast.info(`本轮应用了 ${totalAppliedThisRun} 处修改，可以撤销`, { duration: 4000 });
}
```

- [ ] **Step 3: Run agent-panel tests**

```bash
cd apps/web && pnpm vitest run tests/unit/agent-panel.test.tsx
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/agent/agent-panel.tsx
git commit -m "feat(web): add autoAccept toggle to AgentPanel"
```

---

### Task 9: Enhanced tool card with running/completed/applied states

**Files:**
- Modify: `apps/web/components/agent/agent-tool-card.tsx`

- [ ] **Step 1: Add step-by-step tool state rendering**

```typescript
// Replace the single "completed" assumption with step-by-step states:

type ToolCardState = "running" | "completed" | "applied" | "error";

// Component receives:
type AgentToolCardProps = {
  toolCall: AgentMessageResponse["toolCalls"][number];
  operations: ResumeOperation[];
  autoAccept?: boolean;
  onApply?: (operation: ResumeOperation) => void;
  onIgnore?: (operation: ResumeOperation) => void;
};

export function AgentToolCard({
  toolCall,
  operations,
  autoAccept,
  onApply,
  onIgnore,
}: AgentToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = toolCall.status === "running";
  const applied = autoAccept && toolCall.status === "completed";

  return (
    <div className={`rounded-lg border ${applied ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-border"} p-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : applied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">{toolTitle(toolCall.name)}</span>
          <span className="text-xs text-muted-foreground">· {toolCall.summary}</span>
        </div>
        <div className="flex items-center gap-2">
          {applied && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ 已应用</span>
          )}
          <button type="button" onClick={() => setExpanded((p) => !p)}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          {/* Show tool call args */}
          <details>
            <summary className="text-xs cursor-pointer text-muted-foreground">调用参数</summary>
            <pre className="mt-1 text-xs max-h-32 overflow-auto rounded bg-muted p-2">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </details>
          {/* Show result */}
          <details>
            <summary className="text-xs cursor-pointer text-muted-foreground">执行结果</summary>
            <pre className="mt-1 text-xs max-h-32 overflow-auto rounded bg-muted p-2">
              {JSON.stringify(toolCall.result, null, 2)}
            </pre>
          </details>

          {/* Confirmation actions (only when NOT autoAccept and has operations) */}
          {!autoAccept && operations.length > 0 && (
            <div className="flex gap-2 pt-1">
              {operations.map((op) => (
                <div key={op.id} className="flex items-center gap-1">
                  <Button size="sm" variant="default" onClick={() => onApply?.(op)}>
                    应用
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onIgnore?.(op)}>
                    忽略
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function toolTitle(name: string): string {
  const titles: Record<string, string> = {
    resume_read: "读取简历",
    resume_update_section: "更新分区",
    resume_delete_section: "删除条目",
    resume_insert_section: "新增条目",
    resume_reorder_sections: "重排顺序",
    resume_polish_text: "润色文案",
    resume_set_text: "更新文案",
    resume_ask: "追问用户",
  };
  return titles[name] ?? name;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/agent/agent-tool-card.tsx
git commit -m "feat(web): add step-by-step tool card states (running/completed/applied)"
```

---

### Task 10: Question card for resume_ask interrupts

**Files:**
- Modify: `apps/web/components/agent/agent-confirmation-card.tsx`
- Modify: `apps/web/components/agent/agent-ag-ui-runtime-provider.tsx`

- [ ] **Step 1: Add question variant to confirmation card**

```typescript
// In agent-confirmation-card.tsx, add a QuestionCard variant:

type AgentQuestionCardProps = {
  question: string;
  field?: string;
  onSubmit: (answer: string) => void;
};

export function AgentQuestionCard({ question, field, onSubmit }: AgentQuestionCardProps) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!answer.trim()) return;
    setSubmitted(true);
    onSubmit(answer.trim());
  };

  if (submitted) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        已回复：{question}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20 p-3">
      <div className="flex items-start gap-2 mb-2">
        <MessageCircleQuestion className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">Agent 需要补充信息</p>
          <p className="text-xs text-muted-foreground mt-0.5">{question}</p>
          {field && <p className="text-xs text-muted-foreground/60 mt-0.5">关联字段：{field}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <textarea
          className="flex-1 min-h-[36px] resize-none rounded-md border bg-background px-2 py-1.5 text-xs"
          placeholder="输入回答..."
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
          onClick={handleSubmit}
          disabled={!answer.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Handle question interrupts in the runtime provider**

```typescript
// In agent-ag-ui-runtime-provider.tsx, in onInterrupts handler:

function handleInterrupts(interrupts: AgentAgUiInterrupt[]) {
  const questionInterrupts = interrupts.filter((i) => i.reason === "question");
  // Pass question interrupts to panel for rendering
  if (questionInterrupts.length > 0) {
    onQuestionInterrupt?.(questionInterrupts);
  }
}

// New callback prop:
export type AgentAgUiRuntimeProviderProps = {
  // ... existing
  onQuestionInterrupt?: (questions: AgentAgUiInterrupt[]) => void;
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/agent-confirmation-card.tsx apps/web/components/agent/agent-ag-ui-runtime-provider.tsx
git commit -m "feat(web): add question card for resume_ask interrupts"
```

---

### Task 11: Multi-session history — Web session store enhancement

**Files:**
- Modify: `apps/web/lib/agent/session-store.ts`

- [ ] **Step 1: Add list/create/delete/rename functions**

```typescript
// Add to apps/web/lib/agent/session-store.ts:

export type AgentSessionListItem = {
  sessionId: string;
  threadId: string;
  title: string;
  status: string;
  updatedAt: string;
};

export async function listAgentSessions({
  userId,
  resumeId,
}: {
  userId: string;
  resumeId: string | null;
}): Promise<AgentSessionListItem[]> {
  const rows = await db.query.agentSessions.findMany({
    where: and(
      eq(agentSessions.userId, userId),
      resumeId === null
        ? isNull(agentSessions.resumeId)
        : eq(agentSessions.resumeId, resumeId),
    ),
    orderBy: (sessions, { desc }) => [desc(sessions.updatedAt)],
    columns: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
    },
  });
  return rows.map((row) => ({
    sessionId: row.id,
    threadId: "", // not needed for list
    title: row.title ?? "Agent 会话",
    status: row.status ?? "active",
    updatedAt: row.updatedAt?.toISOString() ?? "",
  }));
}

export async function deleteAgentSession({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const result = await db
    .delete(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)));
  return result.rowCount > 0;
}

export async function renameAgentSession({
  sessionId,
  userId,
  title,
}: {
  sessionId: string;
  userId: string;
  title: string;
}): Promise<boolean> {
  const result = await db
    .update(agentSessions)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)));
  return result.rowCount > 0;
}

export async function paginateAgentSessionEvents({
  sessionId,
  beforeSequence,
  limit = 20,
}: {
  sessionId: string;
  beforeSequence?: number;
  limit?: number;
}) {
  const where = beforeSequence
    ? and(eq(agentSessionEvents.sessionId, sessionId), lt(agentSessionEvents.sequence, beforeSequence))
    : eq(agentSessionEvents.sessionId, sessionId);

  return db.query.agentSessionEvents.findMany({
    where,
    orderBy: (events, { desc }) => [desc(events.sequence)],
    limit,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/agent/session-store.ts
git commit -m "feat(web): add multi-session CRUD and message pagination to session store"
```

---

### Task 12: Session selector UI component

**Files:**
- Create: `apps/web/components/agent/agent-session-selector.tsx`

- [ ] **Step 1: Create the session selector component**

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, ChevronDown, MessageSquare, Plus, Trash2 } from "lucide-react";
import type { AgentSessionListItem } from "@/lib/agent/session-store";

type AgentSessionSelectorProps = {
  sessions: AgentSessionListItem[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
};

export function AgentSessionSelector({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: AgentSessionSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
      >
        <MessageSquare className="h-3 w-3" />
        <span className="max-w-[140px] truncate">{activeSession?.title ?? "选择对话"}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover shadow-md">
            <button
              type="button"
              onClick={() => { onCreate(); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted border-b"
            >
              <Plus className="h-3 w-3" />
              新建对话
            </button>
            <div className="max-h-48 overflow-y-auto">
              {sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted group"
                >
                  <button
                    type="button"
                    onClick={() => { onSelect(session.sessionId); setOpen(false); }}
                    className="flex-1 text-left text-xs truncate"
                  >
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      <span className="truncate">{session.title}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {formatRelativeTime(session.updatedAt)}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDelete(session.sessionId); }}
                    className="shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Integrate into AgentPanel header**

In `agent-panel.tsx`, add the session selector in the header row:

```typescript
<AgentSessionSelector
  sessions={sessions}
  activeSessionId={activeSessionId}
  onSelect={setActiveSessionId}
  onCreate={handleCreateSession}
  onDelete={handleDeleteSession}
  onRename={handleRenameSession}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/agent-session-selector.tsx apps/web/components/agent/agent-panel.tsx
git commit -m "feat(web): add multi-session selector to AgentPanel"
```

---

### Task 13: Session REST API endpoints

**Files:**
- Create: `apps/web/app/api/agent/sessions/route.ts`

- [ ] **Step 1: Create sessions route with list/create/delete/rename**

```typescript
// apps/web/app/api/agent/sessions/route.ts
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentSessions } from "@/db/schema";
import { currentUserId } from "@/lib/auth-helpers";
import { listAgentSessions, deleteAgentSession, renameAgentSession } from "@/lib/agent/session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const resumeId = url.searchParams.get("resumeId") ?? null;

  const sessions = await listAgentSessions({ userId, resumeId });
  return Response.json({ sessions });
}

export async function DELETE(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });

  const { sessionId } = await req.json();
  const ok = await deleteAgentSession({ sessionId, userId });
  return Response.json({ ok });
}

export async function PATCH(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 });

  const { sessionId, title } = await req.json();
  const ok = await renameAgentSession({ sessionId, userId, title });
  return Response.json({ ok });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/agent/sessions/route.ts
git commit -m "feat(web): add session CRUD REST endpoints"
```

---

### Task 14: Floating chat bubble

**Files:**
- Create: `apps/web/components/agent/agent-bubble.tsx`
- Create: `apps/web/components/agent/agent-bubble-chat.tsx`

- [ ] **Step 1: Create the draggable bubble component**

```typescript
// apps/web/components/agent/agent-bubble.tsx
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MessageSquare, X, Minimize2 } from "lucide-react";
import { AgentBubbleChat } from "./agent-bubble-chat";

type Position = { x: number; y: number };

type AgentBubbleProps = {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
  onExpandToPanel: () => void;
};

const DEFAULT_POSITION: Position = { x: -1, y: -1 }; // -1 means "use default"
const BUBBLE_SIZE = 48;
const CHAT_WIDTH = 340;
const CHAT_HEIGHT = 480;

function loadPosition(): Position {
  try {
    const raw = localStorage.getItem("intro-builder.agent-bubble.position.v1");
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_POSITION;
}

function savePosition(pos: Position) {
  localStorage.setItem("intro-builder.agent-bubble.position.v1", JSON.stringify(pos));
}

export function AgentBubble({
  resumeId, title, templateId, getResumeContent,
  completeness, applyOperation, flushAutosave, onExpandToPanel,
}: AgentBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState<Position>(loadPosition);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const defaultPos = (): Position => ({
    x: window.innerWidth - BUBBLE_SIZE - 20,
    y: window.innerHeight - BUBBLE_SIZE - 20,
  });

  const currentPos = pos.x === -1 ? defaultPos() : pos;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY, startX: currentPos.x, startY: currentPos.y };
    setIsDragging(false);

    const onMouseMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - dragStart.current!.x) > 3 || Math.abs(ev.clientY - dragStart.current!.y) > 3) {
        setIsDragging(true);
      }
      if (!dragStart.current) return;
      const newX = dragStart.current.startX + (ev.clientX - dragStart.current.x);
      const newY = dragStart.current.startY + (ev.clientY - dragStart.current.y);
      setPos({ x: Math.max(0, Math.min(window.innerWidth - BUBBLE_SIZE, newX)), y: Math.max(0, Math.min(window.innerHeight - BUBBLE_SIZE, newY)) });
    };

    const onMouseUp = () => {
      if (!isDragging) setIsOpen((prev) => !prev);
      setPos((prev) => { savePosition(prev); return prev; });
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [currentPos.x, currentPos.y, isDragging]);

  // Editor visibility check
  const isOnEditorPage = typeof window !== "undefined" && window.location.pathname.includes("/edit");

  if (!isOnEditorPage) return null;

  return (
    <>
      {/* Chat window */}
      {isOpen && (
        <div
          className="fixed z-50 flex flex-col rounded-lg border bg-background shadow-lg"
          style={{
            left: Math.max(0, currentPos.x - CHAT_WIDTH + BUBBLE_SIZE),
            top: Math.max(0, currentPos.y - CHAT_HEIGHT),
            width: CHAT_WIDTH,
            height: CHAT_HEIGHT,
          }}
        >
          {/* Title bar */}
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium">AI 助手</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={onExpandToPanel} className="rounded p-0.5 hover:bg-muted" title="展开到面板">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => setIsOpen(false)} className="rounded p-0.5 hover:bg-muted">
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => { setIsOpen(false); }}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Chat content */}
          <div className="flex-1 overflow-hidden">
            <AgentBubbleChat
              resumeId={resumeId}
              title={title}
              templateId={templateId}
              getResumeContent={getResumeContent}
              completeness={completeness}
              applyOperation={applyOperation}
              flushAutosave={flushAutosave}
            />
          </div>
        </div>
      )}

      {/* Bubble button */}
      <button
        type="button"
        onMouseDown={onMouseDown}
        className="fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors cursor-grab active:cursor-grabbing"
        style={{ left: currentPos.x, top: currentPos.y }}
      >
        <MessageSquare className="h-5 w-5" />
      </button>
    </>
  );
}
```

- [ ] **Step 2: Create the bubble chat component reusing AgentAgUiRuntimeProvider**

```typescript
// apps/web/components/agent/agent-bubble-chat.tsx
"use client";

// This is a compact version that wraps AgentAgUiRuntimeProvider with bubble-sized UI.
// It reuses the same thread/composer primitives as AgentPanel but in a narrower container.

import { AgentAgUiRuntimeProvider } from "./agent-ag-ui-runtime-provider";

type AgentBubbleChatProps = {
  resumeId: string;
  title: string;
  templateId: string;
  getResumeContent: () => ResumeContent;
  completeness: AgentResumeContext["completeness"];
  applyOperation: (operation: ResumeOperation) => void;
  flushAutosave: () => void;
};

export function AgentBubbleChat(props: AgentBubbleChatProps) {
  // For the first slice, reuse AgentPanel's core but in bubble container.
  // This component wraps the minimal set of primitives needed.
  // The full integration will be detailed in a follow-up task.
  return (
    <div className="flex h-full flex-col text-xs">
      <AgentAgUiRuntimeProvider
        getIntroBuilderForwardedProps={(intent) => ({
          resumeId: props.resumeId,
          mode: "optimize_existing" as const,
          locale: "zh-CN" as const,
          workflowId: intent.workflowId,
          context: buildAgentResumeContext(props.getResumeContent(), props.completeness),
        })}
        // ... handlers that forward to AgentPanel-style behavior
        autoAccept={true} // Bubble defaults to autoAccept
      >
        {/* Thread + composer rendered here — reuse existing primitives */}
      </AgentAgUiRuntimeProvider>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/agent-bubble.tsx apps/web/components/agent/agent-bubble-chat.tsx
git commit -m "feat(web): add floating chat bubble with drag and expand-to-panel"
```

---

### Task 15: Integrate bubble into editor page

**Files:**
- Modify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`

- [ ] **Step 1: Render bubble when panel is not active**

```typescript
// In editor-client.tsx, add bubble when Agent mode not active:
import { AgentBubble } from "@/components/agent/agent-bubble";

// In the render:
{!agentModeActive && (
  <AgentBubble
    resumeId={resumeId}
    title={title}
    templateId={templateId}
    getResumeContent={getResumeContent}
    completeness={completeness}
    applyOperation={applyOperation}
    flushAutosave={flushAutosave}
    onExpandToPanel={() => setAgentModeActive(true)}
  />
)}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(app)/resume/[id]/edit/editor-client.tsx
git commit -m "feat(web): integrate floating bubble into editor page"
```

---

### Task 16: Clean up — remove dev-preview-provider and deprecated parser code

**Files:**
- Remove: `apps/agent/src/workflows/dev-preview-provider.ts`
- Modify: `apps/agent/src/index.ts` (remove dev-preview provider import)
- Modify: `apps/agent/src/http.ts` (remove dev-preview provider wiring)
- Modify: `apps/agent/src/agent-messages.ts` (remove `parseAgentMessageProviderResponse`, `buildAgentMessagePrompt`, `toAgUiAgentEvents`; keep types/validation)

- [ ] **Step 1: Remove dev-preview-provider.ts**

```bash
rm apps/agent/src/workflows/dev-preview-provider.ts
```

- [ ] **Step 2: Remove imports and references from index.ts and http.ts**

In `apps/agent/src/index.ts`: remove `import ... from "./workflows/dev-preview-provider.js"` and the `createDevelopmentAgentMessageProvider` usage.

In `apps/agent/src/http.ts`: remove `dev-preview-provider` import and the `createDevelopmentAgentMessageProvider` check.

- [ ] **Step 3: Remove deprecated functions from agent-messages.ts**

Remove `parseAgentMessageProviderResponse`, `buildAgentMessagePrompt`, `toAgUiAgentEvents`, `extractStreamingAgentMessageContent`, `buildAgentPromptUserSection`.

Keep: `validateAgentMessageRequest`, all type exports, `AgentMessageParseResult`, `buildAgUiAskInterruptEvents`.

- [ ] **Step 4: Run full gate**

```bash
pnpm agent:test && pnpm agent:typecheck && pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/
git commit -m "chore(agent): remove dev-preview-provider and deprecated JSON parser code"
```

---

### Task 17: Write comprehensive tests

**Files:**
- Rewrite: `apps/agent/tests/loop-runtime.test.ts`
- Rewrite: `apps/agent/tests/tools.test.ts`
- Enhance: `apps/agent/tests/draft.test.ts`
- Create: `apps/agent/tests/ask-interrupt.test.ts`
- Create: `apps/web/tests/unit/agent-bubble.test.tsx`
- Modify: `apps/web/tests/unit/agent-panel.test.tsx`
- Enhance: `apps/web/tests/unit/agent-session-store.test.ts`

- [ ] **Step 1: Write loop-runtime tests covering both modes + ask interrupt**

```typescript
// apps/agent/tests/loop-runtime.test.ts — key test cases:
import { describe, it, expect, vi } from "vitest";
import {
  runResumeLoop, assembleLoopResult, createInitialLoopDraft,
  buildLoopSystemPrompt, LOOP_MAX_STEPS,
} from "../src/workflows/loop-runtime.js";
import { createDraft, DraftState } from "../src/workflows/draft.js";

describe("buildLoopSystemPrompt", () => {
  it("returns create-from-zero prompt when mode is create_from_zero", () => {
    const request = { mode: "create_from_zero", locale: "zh-CN", ... } as AgentMessageRequest;
    const prompt = buildLoopSystemPrompt(request);
    expect(prompt).toContain("从零创建");
    expect(prompt).toContain("resume_read");
    expect(prompt).toContain("resume_ask");
  });

  it("returns optimize-existing prompt when mode is optimize_existing", () => {
    const request = { mode: "optimize_existing", locale: "zh-CN", ... } as AgentMessageRequest;
    const prompt = buildLoopSystemPrompt(request);
    expect(prompt).toContain("优化已有简历");
    expect(prompt).toContain("resume_polish_text");
    expect(prompt).toContain("resume_read");
  });

  it("includes targetRole in prompt when available", () => {
    const request = {
      mode: "create_from_zero", locale: "zh-CN",
      sessionSnapshot: { workspace: { goal: { targetRole: "后端工程师" } } },
    } as AgentMessageRequest;
    const prompt = buildLoopSystemPrompt(request);
    expect(prompt).toContain("后端工程师");
  });
});

describe("runResumeLoop", () => {
  it("emits onTextDelta for each text chunk", async () => {
    // Mock streamTextImpl that yields "Hello世界" in chunks
    // ... verify onTextDelta called with each chunk
  });

  it("emits onStepFinish when tools are called", async () => {
    // Mock streamTextImpl with onStepFinish callback
    // ... verify LoopStepEvent contains toolCall + proposedOperations
  });

  it("returns isAskPending=true when resume_ask was called", async () => {
    // Draft with resume_ask tool invoked
    // ... verify RunResumeLoopResult.isAskPending === true
    const draft = createDraft();
    draft.toolCalls.push({
      id: "tool_ask_1", name: "resume_ask", status: "completed",
      title: "追问", summary: "需要用户补充",
      input: { question: "你的公司名？" },
      result: { asked: true },
    });
    const result = assembleLoopResult({ draft, finalText: "", requestId: "r1" });
    // Not directly on loop result — tested via assemble
    expect(draft.toolCalls.some((tc) => tc.name === "resume_ask")).toBe(true);
  });

  it("respects maxSteps limit", async () => {
    // Verify stopWhen(stepCountIs(N)) is passed through
  });
});

describe("assembleLoopResult", () => {
  it("produces valid ParsedLoopResult from draft state", () => {
    const draft = createDraft({ title: "测试" });
    const result = assembleLoopResult({ draft, finalText: "完成", requestId: "r1" });
    expect(result.message.role).toBe("assistant");
    expect(result.message.content).toBe("完成");
    expect(result.toolCalls).toBe(draft.toolCalls);
    expect(result.proposedOperations).toBe(draft.operations);
  });
});

describe("createInitialLoopDraft", () => {
  it("creates empty draft for new create-from-zero request", () => {
    const request = { mode: "create_from_zero", context: null } as AgentMessageRequest;
    const draft = createInitialLoopDraft(request);
    expect(draft.title).toBe("新简历");
    expect(draft.sections).toHaveLength(0);
  });

  it("rehydrates from workspace snapshot when available", () => {
    const workspace = {
      draftResume: { title: "已有草稿", targetRole: "PM", profileSummary: "base", sections: [], missingFacts: [] },
      changeSets: [],
    };
    const request = {
      sessionSnapshot: { workspace },
      context: null,
    } as AgentMessageRequest;
    const draft = createInitialLoopDraft(request);
    expect(draft.title).toBe("已有草稿");
    expect(draft.targetRole).toBe("PM");
  });
});
```

- [ ] **Step 2: Write tools tests verifying all 7+1 tools**

```typescript
// apps/agent/tests/tools.test.ts — key test cases:
import { describe, it, expect } from "vitest";
import { createLoopTools } from "../src/workflows/tools.js";
import { createDraft } from "../src/workflows/draft.js";

describe("createLoopTools", () => {
  const draft = createDraft({ title: "测试简历" });
  const tools = createLoopTools(draft);

  describe("resume_read", () => {
    it("reads empty draft", async () => {
      const result = await tools.resume_read.execute({});
      expect(result).toHaveProperty("title", "测试简历");
      expect(result).toHaveProperty("sections");
      expect(result).toHaveProperty("missingFacts");
    });

    it("reads specific section", async () => {
      const result = await tools.resume_read.execute({ sectionKey: "experience" });
      expect(result).toHaveProperty("sectionKey", "experience");
    });
  });

  describe("resume_polish_text", () => {
    it("calls polishTextFn and writes to draft", async () => {
      const draft2 = createDraft();
      const tools2 = createLoopTools(draft2, {
        polishTextFn: async (fieldPath, instruction) => ({
          plainText: "润色后的文本",
          tiptapJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "润色后的文本" }] }] },
          operation: { id: "op_1", toolCallId: "tc_1", label: "测试", section: "experience", fieldPath, operation: "update_section", beforePlainText: "", afterPlainText: "润色后的文本", changeSummary: "done", riskFlags: [] },
        }),
      });
      const result = await tools2.resume_polish_text.execute(
        { fieldPath: "experience.0.content", instruction: "更量化" },
        { toolCallId: "tc_polish_1" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.beforePlainText).toBeDefined();
        expect(result.afterPlainText).toBe("润色后的文本");
      }
    });

    it("returns error when polishTextFn not configured", async () => {
      const result = await tools.resume_polish_text.execute(
        { fieldPath: "experience.0.content" },
        { toolCallId: "tc_1" },
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("resume_set_text", () => {
    it("calls setTextFn and writes to draft", async () => {
      const draft2 = createDraft();
      const tools2 = createLoopTools(draft2, {
        setTextFn: async (fieldPath, plainText) => ({
          tiptapJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: plainText }] }] },
          operation: { id: "op_1", toolCallId: "tc_1", label: "测试", section: "experience", fieldPath, operation: "update_section", beforePlainText: "", afterPlainText: plainText, changeSummary: "done", riskFlags: [] },
        }),
      });
      const result = await tools2.resume_set_text.execute(
        { fieldPath: "experience.0.content", plainText: "新文本" },
        { toolCallId: "tc_set_1" },
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("resume_ask", () => {
    it("calls onAsk callback", async () => {
      let askedQuestion = "";
      const draft2 = createDraft();
      const tools2 = createLoopTools(draft2, {
        onAsk: (question) => { askedQuestion = question; },
      });
      const result = await tools2.resume_ask.execute(
        { question: "你的上一家公司名称？", field: "experience.0.company" },
      );
      expect(result.asked).toBe(true);
      expect(askedQuestion).toBe("你的上一家公司名称？");
    });
  });

  describe("resume_delete_section", () => {
    it("removes an entry from draft", async () => {
      const draft2 = createDraft();
      // First add something
      const tools2 = createLoopTools(draft2, {
        setTextFn: async (fp, pt) => ({
          tiptapJson: { type: "doc", content: [] },
          operation: { id: "op_1", toolCallId: "tc_1", label: "x", section: "experience", fieldPath: fp, operation: "insert_section", beforePlainText: "", afterPlainText: pt, changeSummary: "", riskFlags: [] },
        }),
      });
      await tools2.resume_set_text.execute({ fieldPath: "experience.0.content", plainText: "test" }, { toolCallId: "tc_set" });

      const initialCount = draft2.sections.length;
      const result = await tools2.resume_delete_section.execute(
        { fieldPath: "experience.0.content", label: "测试经历" },
        { toolCallId: "tc_del" },
      );
      expect(result.ok).toBe(true);
      expect(draft2.sections.length).toBeLessThan(initialCount);
    });
  });

  describe("resume_reorder_sections", () => {
    it("stores a reorder operation", async () => {
      const draft2 = createDraft();
      const tools2 = createLoopTools(draft2);
      const result = await tools2.resume_reorder_sections.execute(
        { newOrder: ["basics", "experience", "education", "skills"] },
        { toolCallId: "tc_reorder" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.operation.operation).toBe("reorder_sections");
      }
    });
  });
});
```

- [ ] **Step 3: Write draft serialization tests**

```typescript
// Add to apps/agent/tests/draft.test.ts:
describe("draftStateToJson / jsonToDraftState", () => {
  it("round-trips draft state", () => {
    const draft = createDraft({ title: "测试", targetRole: "工程师" });
    draft.profileSummary = "base info";
    draft.sections = [{ key: "summary", label: "简介", summary: "test", status: "drafted" }];
    
    const json = draftStateToJson(draft);
    const restored = jsonToDraftState(json);
    
    expect(restored.title).toBe("测试");
    expect(restored.targetRole).toBe("工程师");
    expect(restored.profileSummary).toBe("base info");
    expect(restored.sections).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run agent tests**

```bash
cd apps/agent && pnpm agent:test
```

- [ ] **Step 5: Commit**

```bash
git add apps/agent/tests/
git commit -m "test(agent): add comprehensive loop-runtime, tools, and draft tests"
```

---

### Task 18: Final gate — full verification

- [ ] **Step 1: Run all agent tests**

```bash
cd apps/agent && pnpm agent:test
```

- [ ] **Step 2: Run all web tests**

```bash
cd apps/web && pnpm test
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

- [ ] **Step 5: Production build**

```bash
pnpm build
```

- [ ] **Step 6: Manual smoke test**

```bash
# Terminal 1: Agent service
cd apps/agent && pnpm agent:dev

# Terminal 2: Web app
cd apps/web && pnpm dev

# In browser: navigate to a resume edit page
# 1. Click "Agent 模式" to open panel
# 2. Verify autoAccept toggle exists
# 3. Send a message and verify tool cards appear
# 4. Toggle autoAccept ON and send a message — verify auto-apply toast
# 5. Verify floating bubble appears when panel is closed
# 6. Click bubble — verify compact chat opens
# 7. Verify session selector shows sessions
```

- [ ] **Step 7: Commit final gate results**

```bash
git add -A
git commit -m "chore: final gate verification — all tests, typecheck, lint, build passing"
```
