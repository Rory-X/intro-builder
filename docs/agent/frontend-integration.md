# Frontend Reuse Strategy

本文档说明新增 Agent 能力如何复用 intro-builder 现有前端页面表现，而不是另起一套 UI。

## 当前前端基线

关键入口：

- `app/(app)/resume/[id]/edit/editor-client.tsx`
- `components/editor/rich-text-editor.tsx`
- `components/preview/live-preview.tsx`
- `components/ui/button.tsx`
- `components/ui/sheet.tsx`
- `components/ui/popover.tsx`
- `hooks/use-resume-autosave.ts`

当前编辑器特征：

- `EditorClient` 用 React Hook Form 维护简历内容。
- `LivePreview` 通过 `useWatch()` 订阅表单状态。
- autosave 是 2 秒 debounce 串行队列。
- TipTap 内容以 JSON 存储，不是 HTML。
- UI 使用 shadcn/base-ui 风格原语、lucide icon、sonner toast。
- 编辑器已有右侧 preview、模板面板、协作控件、导出控件。

## 复用原则

1. 不新增一套独立视觉系统。
2. 不让 Agent 直接写 Postgres。
3. 不绕过 React Hook Form。
4. 不把 `content` 当 prop 一路传进 `LivePreview`。
5. 不让 assistant-ui 进入 Phase 1 的富文本按钮。
6. 所有 AI 输出先是 suggestion，用户确认后才写回。
7. 保存仍由现有 autosave 负责。

## Phase 1: 富文本润色按钮

推荐位置：

- `components/editor/rich-text-editor.tsx` toolbar。
- 使用 lucide `Sparkles` 或类似 icon。
- 放在现有字号/颜色工具旁边，但和基础格式按钮视觉一致。

推荐组件：

```text
components/agent/rich-text-polish-button.tsx
components/agent/polish-suggestion-popover.tsx
lib/agent/client.ts
```

数据流：

```mermaid
sequenceDiagram
  participant User
  participant RichTextEditor
  participant WebAgentClient
  participant AgentService
  participant RHF
  participant Autosave

  User->>RichTextEditor: 点击润色
  RichTextEditor->>WebAgentClient: 当前 TipTap JSON + fieldPath
  WebAgentClient->>AgentService: POST /v1/rich-text/polish
  AgentService-->>WebAgentClient: streamed suggestion
  WebAgentClient-->>RichTextEditor: 建议内容
  User->>RichTextEditor: 确认应用
  RichTextEditor->>RHF: onChange(nextTipTapJson)
  RichTextEditor->>Autosave: dispatch resume:flush-autosave
```

UI 行为：

- loading 时按钮 disabled。
- 用户取消时 abort 请求。
- 成功后显示 suggestion popover 或 inline suggestion card。
- 用户点击“应用”才写回。
- 用户点击“保留原文”不改变 RHF。
- 失败用 sonner toast 展示中文错误。

不做：

- 不展示聊天线程。
- 不保存 Agent 记忆。
- 不自动覆盖原文。
- 不调用 assistant-ui。

## Phase 2: 简历模块级 Helpers

推荐入口：

- Section header 右侧小按钮。
- `CompletenessScore` 附近的建议入口。
- 模板面板不承载 Agent helper。

### Phase 2A: Resume Helpers

`resume-diagnose` 放在编辑器顶部工具区，靠近完整度信息，给出整份简历的下一步建议。`section-next-steps` 放在模块 header，覆盖工作经历、项目经历、教育经历、研究经历、技能和自定义模块。

Phase 2A 的 UI 只展示 suggestion cards，不把生成内容自动写回 RHF，也没有 apply/cancel patch 流程。按钮用于引导 AI 能力：文字与图标使用渐变色，按钮背景保持现有编辑器表面风格，不做渐变背景。

推荐组件：

```text
components/agent/section-helper-button.tsx
components/agent/resume-diagnose-button.tsx
components/agent/resume-helper-card.tsx
```

数据边界：

- 输入可以包含当前 section、相邻 section 摘要、目标岗位文本。
- 输出必须是结构化建议。
- 写回必须由用户确认。
- autosave 仍使用现有队列。

## Phase 3: assistant-ui Agent Panel

推荐入口：

- `EditorClient` 顶部工具区已有 `MessageSquare` icon import，可作为 Agent panel 的自然入口。
- 桌面使用右侧 side panel 或 `Sheet`。
- 移动端使用现有 `Sheet`。

推荐组件：

```text
components/agent/agent-panel-trigger.tsx
components/agent/agent-panel.tsx
components/agent/agent-runtime-provider.tsx
app/api/agent/messages/route.ts
```

布局建议：

- Desktop panel width: `360px` 到 `420px`。
- 不覆盖 preview 的主阅读区域。
- composer 固定底部。
- message list 独立滚动。
- 打开时不重置 RHF form。
- 关闭时不销毁未完成请求，除非用户明确取消。

assistant-ui 复用方式：

- 使用 assistant-ui runtime 管理 chat thread。
- 使用本项目 `Button`、`Sheet`、`Input`/`Textarea`、`Separator` 包装视觉。
- message bubble 和 tool result 样式使用现有 `bg-muted`、`text-muted-foreground`、`border` token。
- 不直接使用 assistant-ui 默认主题覆盖全局设计。

数据流：

```mermaid
flowchart LR
  Panel["AgentPanel assistant-ui"] --> WebRoute["Next /api/agent/messages"]
  WebRoute --> Token["sign Agent JWT"]
  WebRoute --> Agent["Agent /v1/agent/messages"]
  Agent --> Redis["Redis memory / rate limit"]
  Agent --> Model["Model provider"]
  Agent --> WebRoute
  WebRoute --> Panel
```

## 与现有页面的复用点

| Existing piece | Reuse plan |
| --- | --- |
| `Button` | Agent trigger、toolbar action、apply/cancel |
| `Sheet` | Agent panel desktop/mobile shell |
| `Popover` | Phase 1 polish suggestion |
| `sonner` | 错误、成功、rate limit 提示 |
| `lucide-react` | `Sparkles`、`MessageSquare`、`StopCircle`、`RotateCcw` |
| `useResumeAutosave` | Agent 写回后的保存队列 |
| `formatSaveError` | Web 写回失败时复用错误格式 |
| `LivePreview` | 不改；只通过 RHF 变化自然更新 |
| `RichTextEditor` | Phase 1 按钮入口 |

## 不复用的点

- 不复用 collab voice chat 状态。
- 不复用 template preview drawer 承载 Agent panel。
- 不把 Agent panel 塞进 dashboard card。
- 不把 assistant-ui message state 存进 resume content。

## 状态管理边界

Agent UI 可以读取：

- 当前 resume id。
- 当前 section key。
- 当前 TipTap JSON。
- 当前简历摘要。
- 当前模板 id。

Agent UI 不能直接写：

- Postgres。
- `resume.content` 的任意深层字段。
- `templateId`。
- `isPublic`。
- collaboration session。

写回通道：

- Phase 1：`RichTextEditor.onChange(nextJson)`。
- Phase 2：section editor 的现有 RHF field array / controller。
- Phase 3：生成 suggestion action，用户确认后调用已有 editor callback。

## 性能策略

- Agent panel 默认 lazy mount。
- assistant-ui 只在 panel 打开后加载。
- 不把完整 resume content 每个 token 都重新传给 assistant-ui runtime。
- 对上下文做 server-side summary 或按 section 裁剪。
- 避免在 `EditorClient` 顶层新增高频 state。

## 可访问性与中文文案

- 所有 icon button 必须有 `title` 或 `aria-label`。
- 面向用户文案使用中文。
- 错误消息不暴露 provider 原始异常。
- loading 文案要短，例如“润色中”“正在思考”。
- rate limit 文案要给出可行动信息，例如“稍后再试”。

## 验收清单

- Phase 1 按钮不会影响普通 TipTap 输入。
- 应用建议后 preview 通过现有 RHF/watch 自动更新。
- 应用建议后 autosave flush。
- 取消请求不会写回部分结果。
- assistant-ui panel 只在 Phase 3 引入。
- panel 关闭再打开不破坏编辑器表单状态。
- 移动端 Sheet 不遮挡关键保存反馈。
