# Floating Assistant Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop dock mode that moves the floating AI 简历助手 conversation into the editor's left column.

**Architecture:** Keep `EditorClient` as the layout state owner and reuse `FloatingAgentChat` as the single conversation component. Add a title-bar dock control to `AgentBubble`, and render the chat either in the overlay or the left column, never both.

**Tech Stack:** Next.js 16 App Router client components, React 19, Tailwind v4, lucide-react, Vitest, Testing Library.

---

### Task 1: Docking State And Regression Test

**Files:**
- Modify: `apps/web/tests/unit/editor-client-live-preview.test.tsx`

- [x] **Step 1: Write the failing test**

Add this test after the existing `uses a floating assistant when the agent surface is enabled` case:

```tsx
it("docks the floating assistant conversation into the editor column", () => {
  render(
    <EditorClient
      id="r1"
      initialTitle="简历"
      initialTemplate="professional"
      initialContent={emptyResumeContent()}
      initialIsPublic={false}
      initialSlug={null}
      initialUpdatedAtIso={new Date().toISOString()}
      initialNowIso={new Date().toISOString()}
      initialResolvedTemplate={DB_RESOLVED}
      uploadedTemplates={[]}
      allTemplates={DB_TEMPLATE_ROWS}
      agentSurface="floating"
      from={null}
    />,
  );

  expect(screen.getByText("基本信息")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "打开 AI 简历助手" }));
  fireEvent.click(screen.getByRole("button", { name: "停靠到左侧编辑区" }));

  expect(screen.getByRole("region", { name: "AI 简历助手对话面板" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "返回表单编辑" })).toBeInTheDocument();
  expect(screen.queryByText("基本信息")).not.toBeInTheDocument();
  expect(screen.queryByText("自动应用")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "返回表单编辑" }));

  expect(screen.getByText("基本信息")).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @intro-builder/web test apps/web/tests/unit/editor-client-live-preview.test.tsx -- --run
```

Expected: FAIL because the `停靠到左侧编辑区` button does not exist yet.

### Task 2: AgentBubble Dock Button

**Files:**
- Modify: `apps/web/components/agent/agent-bubble.tsx`

- [x] **Step 1: Add a dock callback prop**

Change `AgentBubbleProps` to include:

```tsx
  onDockToPanel?: () => void;
```

Destructure it in `AgentBubble`.

- [x] **Step 2: Add the title-bar button**

Import a lucide icon such as `PanelLeftOpen`, and render a button before the minimize button when `onDockToPanel` exists:

```tsx
<button
  type="button"
  aria-label="停靠到左侧编辑区"
  className="rounded p-1 text-white/85 transition hover:bg-white/20 hover:text-white"
  onClick={() => {
    setOpen(false);
    onDockToPanel();
  }}
>
  <PanelLeftOpen className="h-4 w-4" />
</button>
```

- [x] **Step 3: Keep existing drag behavior stable**

The dock button lives inside the draggable title bar. Do not add pointer handlers to the button; keep the existing title-bar pointer handlers on the parent.

### Task 3: Render Floating Chat In The Left Column

**Files:**
- Modify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`

- [x] **Step 1: Add dock state**

Add:

```tsx
const [isFloatingAgentDocked, setIsFloatingAgentDocked] = useState(false);
```

Add:

```tsx
const showAgentInEditorColumn =
  (!useFloatingAgent && isAgentMode) || (useFloatingAgent && isFloatingAgentDocked);
```

- [x] **Step 2: Extract the floating chat element**

Create:

```tsx
const floatingAgentChat = (
  <FloatingAgentChat
    resumeId={id}
    title={title}
    templateId={template}
    getResumeContent={() => form.getValues() as ResumeContent}
    completeness={agentCompleteness}
    applyOperation={applyAgentOperation}
    flushAutosave={flushAgentAutosave}
  />
);
```

- [x] **Step 3: Swap the left column for the docked floating chat**

Inside the left editor panel, render a docked shell when `useFloatingAgent && isFloatingAgentDocked`:

```tsx
<section
  role="region"
  aria-label="AI 简历助手对话面板"
  className="flex h-full flex-col bg-background"
>
  <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
    <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
      <MessageSquare className="h-4 w-4 text-primary" />
      <span className="truncate">AI 简历助手</span>
    </div>
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="返回表单编辑"
      onClick={() => setIsFloatingAgentDocked(false)}
      className="h-8 w-8"
    >
      <PanelRightOpen className="h-4 w-4" />
    </Button>
  </div>
  <div className="min-h-0 flex-1 overflow-hidden">{floatingAgentChat}</div>
</section>
```

- [x] **Step 4: Hide form-only chrome while docked**

Use `showAgentInEditorColumn` for left-panel padding, template overlay gating, and resize-handle visibility.

- [x] **Step 5: Wire the bubble dock callback**

Pass:

```tsx
<AgentBubble
  title="AI 简历助手"
  onDockToPanel={() => {
    setShowTemplatePanel(false);
    setIsFloatingAgentDocked(true);
  }}
>
  {floatingAgentChat}
</AgentBubble>
```

Render `AgentBubble` only when `useFloatingAgent && !isFloatingAgentDocked`.

### Task 4: Verify

**Files:**
- Verify: `apps/web/components/agent/agent-bubble.tsx`
- Verify: `apps/web/app/(app)/resume/[id]/edit/editor-client.tsx`
- Verify: `apps/web/tests/unit/editor-client-live-preview.test.tsx`

- [x] **Step 1: Run focused tests**

```bash
pnpm --filter @intro-builder/web test apps/web/tests/unit/editor-client-live-preview.test.tsx -- --run
```

Expected: PASS.

- [x] **Step 2: Run required local gates**

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Expected: all commands exit 0.
