# Floating Agent Approval And Semantic Tools Design

## Goal

Upgrade the floating resume assistant into a safer, more complete editing agent while preserving the current floating chat UI/UE and leaving `AgentPanel` code untouched.

## Product Direction

The assistant needs two layers:

1. A floating conversation safety layer with `直接修改` and `请求批准` modes.
2. A semantic minimal-action tool catalog that covers every editable `ResumeContent` field through business-level tools, not a generic schema-path mega-tool.

The first layer should ship before delete/reorder/style tools because those operations are high impact and need an approval boundary.

## Non-Goals

- Do not reuse `AgentPanel`, `AgentAgUiRuntimeProvider`, `ThreadPrimitive`, or assistant-ui runtime inside `FloatingAgentChat`.
- Do not expose a generic `resume_edit(path, op, value)` tool to the model or user.
- Do not rewrite the floating chat visual language.
- Do not migrate DB schema for the approval-mode first slice unless current JSONB columns prove insufficient.

## Current State

Floating chat currently:

- Uses Vercel AI SDK `streamText` in `app/api/agent/floating/chat/route.ts`.
- Streams custom SSE JSON events: `text-delta`, `tool-call-start`, `tool-call-delta`, `tool-call-result`, `done`, `error`.
- Treats any streamed `operations` as an immediate apply signal.
- Applies operations in `FloatingAgentChat` through `applyOperation` and `flushAutosave`.
- Persists assistant `parts`, `toolCalls`, and `operations` in JSONB columns.

This means every current write tool behaves like direct modification. That is acceptable for low-risk text updates, but not for upcoming delete, reorder, and layout tools.

## Slice 1: Floating Write Modes

### Modes

`直接修改`:

- Default mode.
- Low-risk write operations are applied immediately as they stream.
- Existing direct behavior remains compatible.
- Risky or unsupported operations should degrade to approval cards instead of silently failing once that risk classification exists.

`请求批准`:

- The route may still execute model tools and build concrete `ResumeOperation` objects.
- The route must not put proposed write operations into the SSE `operations` field.
- The route emits approval requests instead.
- The frontend renders approval cards in the assistant message flow.
- The form is only mutated when the user clicks `应用`.

### Event Contract

Add shared types:

```ts
export type AgentWriteMode = "direct" | "approval";

export type AgentOperationApprovalRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  reason: "approval_required";
  message: string;
  toolCallId: string | null;
  source: { kind: "tool" | "skill"; name: string };
  operation: ResumeOperation;
};
```

In approval mode, mutating tools emit:

```ts
{
  "type": "approval-request",
  "approvalRequest": AgentOperationApprovalRequest
}
```

The final `done` event includes `approvalRequests` for reconciliation. Existing `operations` remains the direct-apply field.

### Message Parts

Extend floating message parts with:

```ts
{ id: string; type: "approval"; approvalRequest: AgentOperationApprovalRequest }
```

This keeps text/tool/approval order stable and allows pending approval cards to restore from history.

### UI

- Add a compact segmented control in the composer footer next to the model pill.
- Labels: `直接修改`, `请求批准`.
- Persist floating-only preference in `intro-builder.agent.floating.operation-mode.v1`.
- Disable switching while a run is active.
- Render approval cards under the assistant bubble, aligned with existing avatar chat content.
- Reuse `AgentConfirmationCard` for diff/full-text display, risk flags, apply/ignore state, and resolved state.

### Message Actions

Borrow interaction patterns from `AgentPanel`, not runtime code:

- User message copy.
- Assistant message copy.
- User message edit and resend.
- Assistant regenerate for the latest assistant message.
- Error retry card for failed requests.

These can follow after the write-mode safety layer if needed; they must not block approval mode.

## Slice 2: Semantic Minimal-Action Tools

Tools should represent real resume editing actions. Each tool has a small business meaning and schema-shaped inputs. Internally, tools may map to a unified operation layer for approval, apply, persistence, and testing.

### Tool Families

The public tool catalog should be made of minimal business blocks. Avoid
catch-all field-path tools, but also avoid splitting a business block into
field-level tools. A block tool must expose every user-editable field in that
schema block, while callers may pass only the fields they want to change.

Read:

- `readResume`

Basics:

- `updateBasicsBlock` — covers `name`, `status`, `title`, `email`, `phone`,
  `location`, `website`, `summary`, `photo`.

Work experience:

- `addWorkExperience`
- `updateWorkExperienceBlock` — covers `company`, `title`, `start`, `end`,
  `location`, `content`.
- `deleteWorkExperience`
- `reorderWorkExperiences`

Education:

- `addEducation`
- `updateEducationBlock` — covers `school`, `degree`, `major`, `location`,
  `start`, `end`, `gpa`, `highlights`.
- `deleteEducation`
- `reorderEducation`

Projects:

- `addProject`
- `updateProjectBlock` — covers `name`, `role`, `location`, `start`, `end`,
  `stack`, `link`, `content`.
- `deleteProject`
- `reorderProjects`

Research:

- `addResearch`
- `updateResearchBlock` — covers `name`, `role`, `location`, `start`, `end`,
  `paperTitle`, `link`, `content`.
- `deleteResearch`
- `reorderResearch`

Singleton rich-text sections:

- `writeSkillsSection`
- `writePersonalSummarySection`
- `writeAwardsSection`
- `writePortfolioSection`

Custom:

- `addCustomSection`
- `updateCustomSectionBlock` — covers `title`, `content` for an existing
  custom section. `id` remains the stable identity and is not AI-editable.
- `deleteCustomSection`
- `reorderCustomSections`

Module structure:

- `showResumeModule`
- `hideResumeModule`
- `reorderResumeModules`

Style:

- `updateStyleSettingsBlock` — covers `fontFamily`, `fontSize`, `lineHeight`,
  `bodyLineHeight`, `headingGap`, `pagePadding`, `sectionGap`, `itemGap`,
  `photoScale`.

### Schema Alignment

Each tool input should be a strict Zod schema derived from the corresponding
`ResumeContent` part:

- Block update tools include every user-editable field in that block schema.
- Block update tools are partial updates: omitted fields are preserved.
- Rich-text fields such as `content` and `highlights` live inside the same
  block tool as their metadata.
- Item references use stable ids where available, otherwise guarded indexes with
  an optional expected label. They do not use arbitrary schema paths.
- Reorder tools accept item ids, item indexes, or section keys, not field paths.
- Style tools are one block-level bounded `StyleSettings` update.
- `smartLayout` is internal layout workflow state, not a normal AI write
  surface. If it becomes user-facing, expose it through a dedicated smart-layout
  workflow instead of a raw field tool.

### Mutating Tool Gate

All add/update/delete/reorder/style tools are resume-mutating and must pass through direct/approval mode. Read and analysis tools are non-mutating.

### Fields To Treat Carefully

- `basics.photo`: exposed through `updateBasicsBlock` so the assistant can cover
  the full `Basics` schema. Because it points at uploaded/public media, prefer
  approval mode for changes.
- `smartLayout.originalSettings`: avoid direct AI write; it is internal state for reverting smart layout.
- `smartLayout.enabled`: expose only through a dedicated layout workflow if needed.

## Operation Layer

The model should call semantic tools. The code can translate those calls into internal `ResumeOperation` objects.

The operation layer must support:

- scalar field updates,
- rich text updates,
- item insert,
- item delete,
- section delete/clear,
- item reorder,
- section reorder,
- style settings update.

Approval cards should speak in business terms (`删除第 2 段项目经历`, `调整正文字号到 12px`) instead of field paths.

## Testing Strategy

Slice 1 tests:

- Direct mode defaults and preserves current apply-on-stream behavior.
- Mode preference persists.
- Request body includes the selected mode.
- Approval mode receives proposed operations but does not call `applyOperation` before approval.
- Approval cards apply/ignore without a second model call.
- Backend approval mode emits `approval-request`, `done.approvalRequests`, and no direct `operations`.
- Direct mode event contract remains backward compatible.

Slice 2 tests:

- Tool catalog covers every editable schema area.
- Each semantic tool validates schema-shaped input.
- Every mutating semantic tool maps to an approval/apply operation.
- `applyResumeOperation` supports scalar, rich text, insert, delete, reorder, and style changes.
- invalid tool inputs fail safely with user-facing summaries.
