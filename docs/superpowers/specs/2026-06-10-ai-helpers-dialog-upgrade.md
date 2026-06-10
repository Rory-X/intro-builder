# Spec: AI 辅助功能 UX 升级

**日期**: 2026-06-10
**作者**: Claude Opus 4.8
**状态**: Draft

## 1. 背景与动机

### 当前问题

目前项目中有三类 AI 辅助功能，但 UX 体验不够理想：

1. **AI 诊断** (`ResumeDiagnoseButton`)
   - 使用 Popover，宽度固定 `w-96` (384px)
   - 内容较多时滚动体验差
   - 视觉层级不够突出

2. **AI 建议** (`SectionHelperButton`)
   - 同样使用 Popover
   - 每个分区都有，但交互感轻量
   - 用户可能忽略这些辅助功能

3. **AI 润色** (RichTextEditor 内嵌)
   - 润色结果显示在编辑器工具栏下方的 `PolishCandidatePanel`
   - 差异对比视图挤在富文本编辑器内部
   - 空间受限，难以展示完整对比

### 用户反馈

- "Popover 太小了，建议内容显示不全"
- "润色对比看起来很局促，希望有更大的空间"
- "感觉这些 AI 功能不够重要，容易被忽略"

### 改进目标

将 AI 诊断、AI 建议、AI 润色的 UI 从 **Popover/嵌入式** 改为 **Dialog（弹窗）** 形式，提升视觉层级和内容展示空间。

---

## 2. 功能清单

### 需要改造的功能

| 功能 | 当前组件 | 当前 UI | 改造后 UI |
|------|---------|---------|----------|
| AI 诊断 | `ResumeDiagnoseButton` | Popover (w-96) | Dialog (sm:max-w-2xl) |
| AI 建议 | `SectionHelperButton` | Popover (w-96) | Dialog (sm:max-w-xl) |
| AI 润色 | `PolishCandidatePanel` | 嵌入式面板 | Dialog (sm:max-w-3xl) |

### 保持不变的功能

- **Agent 面板** - 已经是独立的侧边栏模式，无需改动
- **邀请协作** - 轻量级操作，Popover 合适
- **用户菜单** - 导航菜单，Popover 合适

---

## 3. 设计原则

### 何时用 Dialog vs Popover

**Dialog（弹窗）** 适用于：
- ✅ 内容较多，需要更大展示空间
- ✅ 用户需要专注查看/比对
- ✅ 操作结果重要，需要强调
- ✅ 有复杂交互（如列表、对比、确认）

**Popover（浮层）** 适用于：
- ✅ 轻量级提示、工具提示
- ✅ 下拉菜单、颜色选择器
- ✅ 快速操作，不需要长时间停留

### UX 改进点

1. **更大的展示空间**
   - 诊断：最多 5 条建议，每条包含标题、原因、示例 → 需要 `sm:max-w-2xl`
   - 建议：最多 3 条建议 → 需要 `sm:max-w-xl`
   - 润色：差异对比 + 变更总结 → 需要 `sm:max-w-3xl`

2. **视觉层级提升**
   - Dialog 有背景遮罩，聚焦用户注意力
   - 内容居中显示，更正式、更重要

3. **更好的滚动体验**
   - Dialog 内部可以有独立的滚动区域
   - 头部和底部固定，中间内容滚动

---

## 4. 详细设计

### 4.1 AI 诊断 Dialog

**触发**：用户点击 "AI 诊断" 按钮

**布局**：
```
┌─────────────────────────────────────────┐
│ [X]  AI 简历诊断                        │  ← DialogHeader (固定)
├─────────────────────────────────────────┤
│ 诊断总结: XXXXXX                        │
│                                         │
│ ┌─────────────────────────────────┐   │
│ │ ⚠️ 高优先级                      │   │
│ │ 标题                            │   │
│ │ 原因说明                        │   │  ← DialogContent (可滚动)
│ │ 示例: ...                       │   │
│ │                [应用建议] [忽略] │   │
│ └─────────────────────────────────┘   │
│ ┌─────────────────────────────────┐   │
│ │ 中优先级                        │   │
│ │ ...                             │   │
│ └─────────────────────────────────┘   │
├─────────────────────────────────────────┤
│              [关闭]                     │  ← DialogFooter (固定)
└─────────────────────────────────────────┘
```

**状态管理**：
- 用 `useState<boolean>` 控制 Dialog 开闭
- 点击按钮 → 发起请求 → 打开 Dialog → 显示加载/结果/错误

**尺寸**：`sm:max-w-2xl` (672px)

---

### 4.2 AI 建议 Dialog

**触发**：用户点击分区编辑器中的 "AI 建议" 按钮

**布局**：
```
┌─────────────────────────────────────────┐
│ [X]  工作经历建议                       │  ← DialogHeader
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────┐   │
│ │ 建议 1: 增强 STAR 表达          │   │
│ │ 原因: ...                       │   │  ← DialogContent
│ │ 示例: ...                       │   │
│ │                [应用] [忽略]    │   │
│ └─────────────────────────────────┘   │
├─────────────────────────────────────────┤
│              [关闭]                     │  ← DialogFooter
└─────────────────────────────────────────┘
```

**状态管理**：同 AI 诊断

**尺寸**：`sm:max-w-xl` (576px)

---

### 4.3 AI 润色 Dialog

**触发**：用户点击富文本编辑器工具栏中的 "AI 润色" 按钮

**布局**：
```
┌──────────────────────────────────────────────┐
│ [X]  AI 润色建议                              │  ← DialogHeader
├──────────────────────────────────────────────┤
│ 变更总结: 让职责和影响更清楚                  │
│                                              │
│ 原文:                                        │
│ ┌────────────────────────────────────────┐ │
│ │ 负责前端开发。                          │ │  ← 差异对比
│ └────────────────────────────────────────┘ │    (高亮显示变化)
│                                              │
│ 润色后:                                      │
│ ┌────────────────────────────────────────┐ │
│ │ 负责核心前端模块交付，推动页面性能与    │ │
│ │ 协作效率提升。                          │ │
│ └────────────────────────────────────────┘ │
│                                              │
│ ⚠️ 风险提示: 无                               │
├──────────────────────────────────────────────┤
│         [应用润色]  [放弃]                    │  ← DialogFooter
└──────────────────────────────────────────────┘
```

**状态管理**：
- 点击 "AI 润色" → 打开 Dialog → 显示加载状态
- 加载完成 → 显示差异对比 + 操作按钮
- 点击 "应用" → 调用 `applyPolishCandidate` → 关闭 Dialog
- 点击 "放弃" → 直接关闭 Dialog

**尺寸**：`sm:max-w-3xl` (768px)

---

## 5. 技术实现要点

### 5.1 状态管理模式

**统一模式**：受控 Dialog + 内部状态

```typescript
// 组件内部
const [dialogOpen, setDialogOpen] = useState(false);
const [helperState, setHelperState] = useState<HelperState>({ status: "idle" });

async function handleRequest() {
  setHelperState({ status: "loading" });
  setDialogOpen(true); // 打开 Dialog

  const result = await fetchHelper(...);
  setHelperState({ status: "ready", result });
}

return (
  <>
    <Button onClick={handleRequest}>AI 诊断</Button>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent>
        {/* 根据 helperState 渲染内容 */}
      </DialogContent>
    </Dialog>
  </>
);
```

### 5.2 组件结构

**提取共享组件**：

- `ResumeHelperDialog` - 包装 AI 诊断和 AI 建议的通用 Dialog
- `PolishResultDialog` - AI 润色专用 Dialog
- 复用现有的 `ResumeHelperCard` 和 `PolishDiffView`

### 5.3 响应式设计

- 移动端：Dialog 占据大部分屏幕 (`max-h-[90vh]`)
- 桌面端：固定最大宽度 + 居中显示
- 内容区域：独立滚动 (`overflow-y-auto`)

---

## 6. 非功能需求

### 可访问性

- Dialog 自动聚焦内容区域
- 关闭按钮支持键盘导航 (Esc 键)
- 建议卡片的 "应用" 按钮有清晰的 `aria-label`

### 性能

- Dialog 内容懒加载（只在打开时渲染）
- 差异对比算法保持现有实现（LCS）

### 兼容性

- 保持所有现有 API 不变
- 只改变 UI 层，不改变数据流

---

## 7. 验收标准

### UI 层面

- [ ] AI 诊断使用 Dialog，最大宽度 `sm:max-w-2xl`
- [ ] AI 建议使用 Dialog，最大宽度 `sm:max-w-xl`
- [ ] AI 润色使用 Dialog，最大宽度 `sm:max-w-3xl`
- [ ] 所有 Dialog 有背景遮罩和淡入动画
- [ ] 移动端体验良好（响应式布局）

### 功能层面

- [ ] 所有现有功能正常工作
- [ ] 建议的 "应用" 和 "忽略" 操作正常
- [ ] 润色的 "应用" 和 "放弃" 操作正常
- [ ] 错误状态正常显示

### 测试层面

- [ ] 现有单元测试全部通过
- [ ] 新增 Dialog 交互测试（打开、关闭、应用建议）

---

## 8. 后续优化（可选）

1. **润色选项面板**
   - 在 Dialog 中增加 tone/length/strategy 选择
   - 用户可以实时调整润色参数

2. **建议批量操作**
   - 支持一次应用多条建议
   - 显示应用进度

3. **历史记录**
   - 保存最近的诊断/建议结果
   - 用户可以回看

---

## 9. 相关文件

- `components/agent/resume-diagnose-button.tsx`
- `components/agent/section-helper-button.tsx`
- `components/editor/rich-text-editor.tsx`
- `components/agent/resume-helper-card.tsx`
- `components/ui/dialog.tsx`
