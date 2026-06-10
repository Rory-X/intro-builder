# Spec: Agent Panel UX P0 优化

**日期**: 2026-06-10
**作者**: Claude Code
**状态**: Draft

## 1. 背景

当前 Agent Panel 的 HITL 确认流程存在两个核心体验问题：

### 问题 1：批量确认体验差
- Agent 一次返回 5 个修改建议
- 用户必须逐个点击"应用"按钮 5 次
- 无法一眼看到所有修改的全貌
- 无法"全部应用"或"选择性应用"

### 问题 2：操作卡片信息密度低
- before/after 完整文本占用大量垂直空间
- 用户难以快速识别"改了什么"
- 需要上下对比才能看出差异

## 2. 设计目标

### P0.1 批量确认
- 用户可以看到"本轮共 N 个修改建议"
- 提供"全部应用"、"全部拒绝"快捷按钮
- 支持"勾选 → 批量应用"模式

### P0.2 Diff 展示
- 操作卡片默认显示 diff 高亮（类似 git diff）
- 删除内容用红色删除线，新增内容用绿色高亮
- 可展开查看完整 before/after 文本

## 3. 技术方案

### 3.1 批量确认 UI

在 `AgentTurnArtifactsPanel` 顶部添加批量操作栏：

```tsx
{operations.length > 1 && (
  <div className="批量操作栏">
    <span>共 {operations.length} 个修改建议</span>
    <Button onClick={handleApplyAll}>全部应用</Button>
    <Button onClick={handleRejectAll}>全部拒绝</Button>
  </div>
)}
```

**行为**：
- "全部应用" → 依次调用 `applyOperation`，然后提交所有 interrupts
- "全部拒绝" → 直接提交所有 interrupts 为 `cancelled`

### 3.2 Diff 展示

使用 `diff` npm 包生成 diff，渲染为行内高亮：

```tsx
import { diffWords } from 'diff';

function renderDiff(before: string, after: string) {
  const changes = diffWords(before, after);
  return changes.map((part, i) => (
    <span
      key={i}
      className={
        part.added ? 'bg-green-100 text-green-900' :
        part.removed ? 'bg-red-100 text-red-900 line-through' :
        ''
      }
    >
      {part.value}
    </span>
  ));
}
```

在 `AgentConfirmationCard` 中：
- 默认显示 diff 视图（紧凑）
- 添加"查看完整文本"展开按钮
- 展开后显示 before/after 双栏对比

### 3.3 Assistant UI 复用

检查 `@assistant-ui/react` 是否有现成组件：
- Diff 展示组件
- 批量操作 UI 原语

如果没有，自行实现。

## 4. 实现步骤

1. 安装 `diff` 依赖
2. 修改 `AgentConfirmationCard` 添加 diff 视图
3. 修改 `AgentTurnArtifactsPanel` 添加批量操作栏
4. 测试多操作场景
5. 更新单元测试

## 5. 验证标准

- [ ] 3 个以上操作时，顶部显示批量操作栏
- [ ] "全部应用"后所有操作都写入表单
- [ ] Diff 视图能正确高亮增删改
- [ ] "查看完整文本"能展开/收起
- [ ] 所有测试通过

## 6. 非目标

- ❌ 可撤销性（留给 P1）
- ❌ 勾选模式（如果批量操作够用，暂不实现）
- ❌ 推理透明度（留给 P1）
