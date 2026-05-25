# intro-builder v0.5 — 模板库 (Template Library)

> 日期：2026-05-24
> 状态：草稿，待评审
> 关联原型：`prototypes/template-library.html`

---

## 1. Why This Exists

当前 3 套模板（`professional` / `classic` / `modern`）能用，但缺少"展示橱窗"。用户切换模板的入口藏在编辑器右上「模板与排版」Popover 里，且只显示文字按钮——看不到模板视觉效果，需要切换才知道好不好看，决策成本高。未登录用户也无法看到模板，简历工具最重要的获客通道（"看到漂亮模板想注册"）完全缺失。

本期把"模板"做成一个独立、可视化的产品表面：用户能在专门页面浏览所有模板，**用自己的简历内容直接预览试穿**，看完效果再决定切换。

## 2. Goals

- **独立 `/templates` 路由（已登录）**：本期仅对已登录用户开放。未登录访问跳 `/login?next=/templates`。
- **三处入口都通向同一个模板库**：营销页 marketing 占位（v0.5.1 接公开访问）/ Dashboard 头部 nav / 编辑器内换装。
- **模板缩略图复用 `<TemplateLayout>`**：不用静态 PNG。「用我的内容预览」开关默认开启。
- **切换模板 = 抽屉预览 + 用户确认 + 重置 styleSettings**：预览本身即软提示，确认后才写库。
- **第一批新增 2 套模板**：`timeline`、`minimal`（视觉差异最大，足够展示模板库价值）。
- **后续追加 3 套**：`academic`、`creative`、`twocol`（不在本期 DoD，但 schema 与 registry 留位）。
- **样式严格走 shadcn/ui + `lib/templates/shared/*` 原语**——禁止在 Layout 组件内手写 inline CSS。

## 3. Non-Goals

- 用户自定义/上传模板（save-as-template）。
- 模板社区或市场（用户互相分享模板）。
- AI 推荐模板（按内容/岗位）。
- 多模板并排对比。
- 模板版本管理（v1/v2 共存以保护存量简历）。
- 移动端「新建简历」整体重设计。
- 改公开 `/r/[slug]` 的 PDF 下载策略。
- **未登录用户的模板浏览与"注册回流套模板"流程**（推到 v0.5.1）。本期 `/templates` 仅对已登录用户开放，未登录访问直接 `/login?next=/templates`。

## 4. Product Decisions

### 4.1 模板集合

| id | 状态 | 分类 | 备注 |
|---|---|---|---|
| `professional` | 现有 | simple | 默认推荐 |
| `classic` | 现有 | simple | 衬线传统 |
| `modern` | 现有 | twocol | 深色侧栏 |
| `timeline` | **新（M6）** | timeline | 时间轴视觉，多年经验首选 |
| `minimal` | **新（M6）** | simple | 大量留白，资深从业者 |
| `academic` | 占位（M7+） | academic | 学术 CV |
| `creative` | 占位（M7+） | creative | 设计岗专用 |
| `twocol` | 占位（M7+） | twocol | 50/50 高密度 |

每套模板的 `meta` 增加 `category` 与 `tags: string[]` 字段（结构留位，本期 UI 不接 Tab 筛选——8 套规模筛选无意义）。

### 4.2 切换流程（决策 1：B + 预览确认）

1. 用户在 `/templates` 或编辑器入口点模板卡片。
2. 抽屉打开：左侧大图 = `<TemplateLayout content={userResume ?? DEMO_DATA} />`，「用我的内容预览」开关默认开。
3. 右侧显示模板信息 + 该模板的默认排版（fontFamily / fontSize / lineHeight / pagePadding）。
4. 用户点「应用到当前简历」→ 调用 `setTemplate(resumeId, templateId, { resetStyleSettings: true })`。
5. 服务端事务：在同一次写入中更新 `templateId` + 用 `meta.defaultStyleSettings` 覆盖 `styleSettings`。
6. 重定向到编辑器，toast「已切换为 X」。
7. **取消** = 关抽屉，不写库。

> 没有"软提示对话框"——预览本身就是软提示。用户在预览里看到效果满意才会确认，所以"重置"几乎不会让人意外。

### 4.3 入口（决策 2：c — 三处都做，本期已登录限定）

1. **营销页** `app/templates/page.tsx`（本期受 `proxy.ts` 保护，未登录跳 `/login`）。v0.5.1 解除保护，加未登录态 + 注册回流 callback。
2. **Dashboard 头部** `components/shell/header.tsx` 增加 `<Link href="/templates">模板库</Link>`。
3. **编辑器内** `components/editor/style-editor.tsx` 的 Popover 顶部加 CTA「查看全部模板 →」，跳 `/templates?from=editor&resumeId=<id>`，应用后回 `/resume/<id>/edit`。

### 4.4 缩略图实现（决策 4.4）

- 8 张同时挂载用 `<TemplateLayout>` + CSS `transform: scale()`。
- 容器用 `aspect-ratio: 210/297` 锁 A4 比例，JS 测量内容 `scrollHeight` 取 `min(thumbW/595, thumbH/contentH)` 比例缩放，保证完整可见、顶部对齐。
- viewport 外的卡片用 `IntersectionObserver` lazy mount，避免低端机一次挂 8 个 LivePreview 卡顿。
- 「用我的内容预览」开关：on 时套 `userResume.content`，off 时套 `DEMO_RESUME`（在 `lib/demo-resume.ts` 的扩展里维护一份"标准简历"）。

### 4.5 styleSettings 重置策略

- 模板 `meta` 增加 `defaultStyleSettings: StyleSettings` 字段（必填，强迫每个模板设计者明确表达"我希望以什么排版被呈现"）。
- 现有 3 套模板基于 `STYLE_PRESETS.standard` 标定基础值，在本期 M2 一并补齐。
- 切换时合并：

```ts
{
  ...userResume,
  templateId: targetId,
  styleSettings: TEMPLATES[targetId].defaultStyleSettings,
  // content / sectionOrder / 富文本 marks 完全保留
}
```

- 重置不影响 `content`——用户调过的"GMV +32% 加粗"、"重点标红"全部跟着新模板渲染。

### 4.6 节奏（决策 3：b — 先 2 套）

- **M1-M5**：用现有 3 套模板把整条管线（路由 / 缩略图 / 抽屉 / 应用 / 入口）跑通，第一版上线。
- **M6**：写 `timeline` + `minimal` 两套新模板，加进 registry，第二版上线。
- **后续**（不在本期 DoD）：`academic`、`creative`、`twocol`。

## 5. UX 流程

### 5.1 已登录用户从 Dashboard

```
Dashboard 头部 nav「模板库」
  └─ /templates（开关默认 ON，套用户最新一份简历的 content）
          └─ 点模板卡 → 抽屉预览
                          └─ CTA「应用到 [简历名] / 选择简历…」
                               └─ setTemplate(id, ...) → toast → 留在 /templates
```

### 5.2 已登录用户从编辑器

```
/resume/[id]/edit → 「模板与排版」Popover → 「查看全部模板 →」
  └─ /templates?from=editor&resumeId=[id]（开关默认 ON，套该简历）
          └─ 点模板卡 → 抽屉预览
                          └─ CTA「应用到当前简历」
                               └─ setTemplate(id, ...) → 跳回 /resume/[id]/edit
```

### 5.3 未登录用户（v0.5.1）

```
/templates → proxy.ts 拦截 → /login?next=/templates
（v0.5.1 解除保护后再做注册回流）
```

## 6. 兼容性 / 数据迁移

- `lib/templates/types.ts`：`TemplateLayoutProps` 不变；`TemplateMeta` 新增 `category` / `tags` / `defaultStyleSettings`。
- `lib/templates/<id>/meta.ts`：3 套现有模板补 `defaultStyleSettings`（基于 `STYLE_PRESETS.standard`）。
- `lib/resume-schema.ts`：**无需 schema 变更**（content 与 styleSettings 形态不变）。
- `db/schema.ts`：**无需 migration**——`templateId` 是 string，新模板 id 直接进 enum。
- `setTemplate` server action：增加可选第三参数 `{ resetStyleSettings: boolean }`，默认 `true`。
- `proxy.ts`：`/templates` **加入受保护路径**（本期已登录限定）。v0.5.1 移出保护列表。

## 7. 性能与风险

- **缩略图性能**：8 个 LivePreview 同时挂载在低端机可能卡。**对策**：IntersectionObserver lazy + viewport 外 placeholder 占位。
- **「用我的内容预览」切换闪烁**：用 `useDeferredValue` + 局部 fade-in 过渡，避免 8 张同时重渲染抖屏。
- **未登录用户的应用流程**：v0.5.1 实现。本期 `proxy.ts` 拦截 `/templates`，未登录直接进 `/login?next=/templates`，没有 ghost-resume 创建。
- **手写 CSS 风险**：写新 Layout 时容易复制旧 Layout 的 inline style 而绕过 shared 原语。**对策**：写 `lib/templates/shared/Section.tsx`、`Item.tsx` 等原语后，新模板组件不允许出现 `style={{...}}`（lint 规则 + code review）。

## 8. 验收（Definition of Done）

- 8 张模板缩略图在 1366×768 视口下能完整显示，所有姓名行水平对齐。
- 「用我的内容预览」开关切换流畅（< 200ms 视觉抖动）。
- 切换模板从点击到回到编辑器全程 < 2s（含 server action）。
- 切换后 styleSettings 是目标模板的 `defaultStyleSettings`，content 完全保留（包括富文本 marks）。
- 未登录用户从 `/templates` 注册流可走通，注册成功后落地一份套该模板的新简历。
- `pnpm test / tsc --noEmit / lint / build` 全绿。
- 手工冒烟：登录 / 未登录两种身份、三处入口都验过。

## 9. 参考

- **原型**：`prototypes/template-library.html`（4 列、自适应缩放、抽屉预览均已 demo）
- **契约**：`lib/templates/types.ts`、`lib/templates/registry.ts`
- **切换逻辑**：`app/(app)/resume/[id]/edit/actions.ts:setTemplate`
- **编辑器集成点**：`components/editor/style-editor.tsx`、`components/editor/smart-layout-button.tsx`
- **数据契约**：`lib/resume-schema.ts`、`lib/style-presets.ts`
- **brand 与 header**：`components/shell/brand.tsx`、`components/shell/header.tsx`
