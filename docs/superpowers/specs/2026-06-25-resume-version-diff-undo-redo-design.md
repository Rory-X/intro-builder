# Resume Version Diff And Undo/Redo Design

**日期**: 2026-06-25
**状态**: Approved for implementation

## 背景

Agent 已经可以直接或经确认卡修改简历。当前问题是用户无法低成本确认「AI 到底改了什么」，也无法在误操作后快速撤回。Autosave 只保证当前内容被保存，不提供可观察、可恢复的修改历史。

本设计把能力拆成两层：

- **版本管理 / Diff View**：Agent 修改的安全带。用于跨会话追溯、对比和恢复。
- **Undo / Redo**：编辑器即时编辑体验。用于当前会话内撤销/重做表单、模板、Agent 应用、恢复版本等操作。

## 目标

1. 用户可以从编辑器顶部「版本」入口打开版本历史。
2. 用户可以从 Agent 修改后的提示或工具卡进入本次修改对比。
3. 点击历史版本后，右侧简历预览进入只读 Diff View，仍保持 A4 简历模板结构。
4. Diff View 展示当前最新版本相对历史版本的新增、删除和修改内容。
5. Diff 不降级为纯文本，至少保留简历模板、标题、列表、加粗、链接和 TipTap 富文本节点结构。
6. 用户可以恢复历史版本；恢复会生成一条新的版本记录，不覆盖旧记录。
7. 编辑器提供 undo/redo 按钮和快捷键，支持普通编辑、Agent 应用、模板切换、恢复版本后的撤销/重做。
8. 全部面向用户文案使用中文。

## 非目标

- v1 不把每一次普通 autosave 都保存为持久版本，避免版本历史噪声。
- v1 不实现多人协作版本回放；协作后续可复用同一版本表。
- v1 不识别块移动，只按删除 + 新增展示。
- v1 不提供可编辑 Diff View；Diff View 只读。

## 产品入口

### 顶部工具栏

编辑器顶部在 Agent / 保存状态附近新增「版本」按钮。点击打开版本历史弹窗。按钮文案与弹窗全中文。

### Agent 修改后

Agent operation 应用成功后：

- 当前 RHF 内容写入 undo 栈；
- autosave flush；
- 创建持久版本记录；
- toast 显示「已生成版本，可查看对比」，带「查看差异」入口。

### 版本历史弹窗

每条记录展示：

- 时间，例如 `6 月 23 日 · 上午 10:18`
- 修改人，例如 `Mem`
- 修改方式，例如 `通过对话`、`手动恢复`
- 修改数量，例如 `1 处修改`
- 当前查看状态：`正在查看`

点击记录进入 Diff View。

## 数据模型

新增 `resume_version` 表：

- `id`: 主键
- `resumeId`: 所属简历
- `userId`: 所属用户
- `title`: 版本创建时的简历标题
- `templateId`: 版本创建时模板
- `content`: 完整 `ResumeContent`
- `source`: `manual` | `agent` | `restore`
- `actorName`: 展示用修改人
- `operationCount`: 修改数量
- `summary`: 简短说明
- `parentVersionId`: 恢复操作可指向被恢复版本
- `createdAt`: 创建时间

版本是完整快照，不存 patch。理由：简历 JSON 小，恢复简单，数据安全优先。

## 服务端边界

新增就近 server actions：

- `listResumeVersions(resumeId)`：校验用户拥有简历，返回最近 50 条版本元数据。
- `getResumeVersion(resumeId, versionId)`：校验权限，返回该版本快照。
- `createResumeVersion(input)`：由 Agent 应用和恢复动作调用，保存当前快照。
- `restoreResumeVersion(resumeId, versionId)`：读历史版本，写回 `resumes` 当前内容，同时创建 `source=restore` 新版本。

所有 action 必须重新 `auth()`，并对 `ResumeContent` 重新 Zod 解析。

## Undo / Redo

新增编辑器会话级历史栈：

```ts
type ResumeEditorSnapshot = {
  title: string;
  templateId: string;
  content: ResumeContent;
};
```

行为：

- 容量 50。
- 普通字段变化进入 undo 栈，2 秒内连续输入合并为一个历史步。
- Agent operation、模板切换、恢复版本作为离散历史步。
- Undo 会恢复 title、templateId、content、sectionOrder。
- Redo 会重放被撤销的快照。
- Undo/redo 后触发 autosave flush。
- 历史预览 / Diff View 打开时不允许编辑，快捷键 `Esc` 关闭 Diff View；`Cmd/Ctrl+Z` 和 `Cmd/Ctrl+Shift+Z` 仍作用于编辑器历史。

## Diff 算法

两层 Diff：

1. **Resume-level field diff**
   - basics 字段按纯文本 diff；
   - array section 按 item `id` 或稳定索引匹配；
   - top-level TipTap 字段直接进入 rich-text diff；
   - 新增/删除整块在原简历结构内标蓝/标红删除线。
2. **TipTap inline diff**
   - 遍历 TipTap JSON，保留节点 type / attrs / marks；
   - 相同类型块做行内 token diff；
   - 中文按字符，英文按单词/空白 token；
   - 修改拆成 removed + added；
   - 生成可渲染的 `DiffResumeContent`，由独立组件渲染。

Diff 样式：

- 新增：`#3B6FE8`，可带轻蓝背景。
- 删除：`#FF3B30`，删除线，可带轻红背景。
- 未变：继承模板文字色。

## UI

Diff View 在现有右侧预览区域内渲染：

- 顶部浅蓝工具栏：上一个版本、下一个版本、版本时间下拉、恢复此版本、关闭。
- 左侧表单列显示只读提示，不卸载表单状态。
- 右侧仍是 A4 简历页滚动，不切成两列纯文本。
- 版本历史弹窗标记当前查看记录。
- 恢复前用确认弹窗；确认后回到最新内容，并产生 restore 版本记录。

## 验收场景

1. 新增一句话显示蓝色。
2. 删除一句话显示红色删除线。
3. 修改一句话中的部分词语拆成删除 + 新增。
4. 新增/删除标题保持标题样式。
5. 新增/删除列表项保留列表层级。
6. 修改列表项中的部分文字只标记变化片段。
7. 修改加粗文本仍保留加粗。
8. 修改链接文本时保留链接。
9. 中英文混合文本 diff 粒度合理。
10. 长简历多个位置同时修改时可滚动查看。
11. Agent 修改后生成版本记录并可从 toast/版本入口进入。
12. 恢复历史版本后生成新的 restore 版本记录。
13. 关闭 Diff View 后回到最新可编辑简历内容。
14. Undo/redo 能撤销和重做普通编辑。
15. Undo/redo 能撤销和重做 Agent 应用、模板切换和恢复版本。

## 风险

- Diff 渲染不能直接套任意上传模板 HTML slot，否则需要对模板引擎做侵入式改造。v1 用统一的 A4 Diff 简历渲染器复刻简历结构和富文本，不承诺逐模板像素级一致。
- 普通输入合并历史步需要避免每个 keystroke 都入栈。实现上在 editor client 层用 debounce 归并。
- server action 可被直接 POST 调用，必须在 action 内做 auth、ownership 和 schema 校验。
