# intro-builder Template Studio v2：HTML 自由排版 Spec

> 日期：2026-05-27
> 状态：spec 草稿，待评审 → 之后进 plan
> 上游讨论：Skill v1 PoC 反思（同日，未单独存档）+ handcoded-crimson PoC（视觉 ~95% 复刻，已落 `prototypes/handcoded-crimson/index.html`）
> 关联：`docs/superpowers/specs/2026-05-24-template-studio-skill.md`（v1 spec，本文为 v2 修订）

## 1. 为什么做

### 1.1 现状

- Skill v1 已端到端跑通：参考图 → gpt-image-2 装饰底图 → Claude 推断 LayoutConfig JSON → 写 templates 表 → 引擎渲染。已落地 `abbey` 模板验证。
- LayoutConfig 是**严格枚举**：`frame.kind` (2 选 1) + `headerVariant` (3 选 1) + `sectionTitleVariant` (5 选 1) + `itemHeaderVariant` (3 选 1)。理论组合上限 90 种，骨架（chassis）形状被锁死。
- 工程师每写一个新 variant ≈ 半天到 1 天工作量。`card-wrapped`、`full-width-bar` 是这条路最近的产物。

### 1.2 痛点

- **骨架视觉差异化上限被锁死**：timeline 鳃骨 / 杂志双栏 / banner 顶部 / 瀑布流——这些视觉骨架靠现有 4 个 enum 字段写不出来。
- **模板库扩张速度仍卡在工程师**：原 v1 spec §1.2 写"运营丢图速度"，但实际上骨架差异化的瓶颈又转回工程师写 variant 上。
- **handcoded-crimson PoC 证明 AI 视觉能力 ≠ 当前 schema 能力**：`prototypes/handcoded-crimson/index.html` 250 行手写 HTML/CSS 视觉一致性 ~95%；当前 schema 系统**写不出**这个 PoC。AI 实际能力 >> schema 表达能力。

### 1.3 目标场景

运营手里有一份精美简历样本（PDF / 截图）。**让 Claude 看图直接写 HTML+CSS**（不再推断 enum 配置），引擎把这段 HTML 当模板"骨架"，按 slot 协议把用户的 ResumeContent 塞进去渲染。AI 能力上限 ≈ 模板视觉上限。

---

## 2. 目标

按重要度：

1. **Skill 输出 HTML/CSS 取代 LayoutConfig JSON 配置**——AI 直接画骨架视觉，骨架差异化上限从 90 种 enum 组合提升到 AI 视觉能力上限。
2. **用户编辑能力 100% 保留**——拖拽改 sectionOrder、改字体/字号/行距、TipTap 富文本 marks 全部仍然生效。
3. **现有模板不破坏（向后兼容）**——abbey / abbey-stub / professional / classic / modern 全部继续工作，不需要数据迁移。
4. **handcoded-crimson PoC v4 视觉一致性 ≥ 90% 接入引擎后维持**——slot 引擎不能让视觉变差。
5. **复用 Skill 框架**——Skill v1 的装饰底图提取、DB 写入、status 闸门全部保留，仅改 Step 3（layout 配置）。

---

## 3. 不做什么（明确边界）

- ❌ **用户不能改主题色**——v1 spec §4.7 旧承诺 revise。颜色由 Skill 写入时锁定。
- ❌ **用户不能改装饰图位置 / 模板视觉骨架**——锁定。
- ❌ **不让 Claude 写 JS / 交互**——只 HTML + CSS + Tailwind class。禁止 inline `<script>` / `on*` 属性 / `<iframe>` / `<object>` / `<embed>`。
- ❌ **不做模板版本管理**（v1/v2 共存以保护存量简历）。
- ❌ **不做"上传即发布"**——`status: draft → published` 闸门保留，运营人工 review。
- ❌ **不做 C 端用户自传 HTML 模板**——仅运营内部使用。
- ❌ **不做模板自动迁移**——abbey 等 v1 模板永远走老路径，新模板走新路径。
- ❌ **不做 Skill v1 的 deprecation**——v1 enum 路径保留为"快速参数化模板"备选项；只是默认推荐 v2 自由排版。
- ❌ **不渲染用户的 customSections**（自定义 section）——v2 模板的 sectionOrder 循环只处理标准 section（`experience` / `education` / `projects` / `skills` / `summary` 等 preset id）。用户加的自定义 section（如「作品集」用户自命名 id）在 v2 模板下**不显示**。后续 v2.x 增量支持，本期跳过避免 schema 复杂化。
- ❌ **不做多页**——v2 模板是 A4 单页约束（见 §4.2.1）。内容超出一页的部分被裁切。多页排版需要分页引擎，留 v2.x。

---

## 4. 产品决策

### 4.1 三层架构（修订 v1 spec §4.2）

| 层 | 内容 | 提供方 | 与 v1 差异 |
|---|---|---|---|
| **L1 装饰** | 背景图 / banner PNG | gpt-image-2 | 不变 |
| **L2 骨架排版** | **HTML + CSS（带 slot）** | **Claude 自由排版** | **重大改动**：v1 = JSON 配置 + 4 个 enum；v2 = 任意 HTML/CSS |
| **L3 内容** | ResumeContent | 用户填表 + 拖拽 + 富文本 | 不变 |

### 4.2 对偶约束（dual constraint）

Claude 写 CSS 时**必须**遵守：

| 用户能调？ | 写法 | 例子 |
|---|---|---|
| ✅ 能调 | **必须 CSS 变量** | `font-size: var(--font-size)` / `font-family: var(--font-family)` / `line-height: var(--line-height)` |
| ❌ 不能调 | **可以硬编码** | `color: #A11D2C` / `padding: 24px` / `border-radius: 12px` / `background: linear-gradient(...)` |

**违反后果**：硬编码用户该能调的属性 → 用户调字号 / 字体 / 行距瞬间失效。SKILL.md 强约束 + 写完后跑一份 grep lint 自检（`grep -E "font-(size|family)|line-height" customCss | grep -v "var("` 应为空）。

引擎注入 CSS 变量到模板根节点：

```css
[data-template-id="<id>"] {
  --font-family: <styleSettings.fontFamily 解析>;
  --font-size: <styleSettings.fontSize>px;
  --line-height: <styleSettings.lineHeight>;
}
```

### 4.2.1 A4 单页约束（hard rule）

**Skill v2 自由排版的前提是 A4 框架约束**。"自由"指的是**视觉自由**（颜色 / 装饰 / 排版风格随便画），不是**尺寸自由**。

具体硬规则：

> Claude 写 HTML/CSS 时，渲染 demoResume 规模的内容（约 5 项工作 + 3 个项目 + 2 个 section 自我介绍 / 教育）必须严格压在 **A4 单页** 内：
> - **gallery thumbnail 模式**（stage 595px 宽）：高度 ≤ **841px**（A4 @72dpi）
> - **dev-preview / 编辑器预览 / PDF 模式**（容器 800px 宽）：高度 ≤ **1123px**（A4 @96dpi）

**为什么是硬约束**：

1. **PDF 等价性**：模板最终用 Puppeteer 截 A4 PDF。模板自己超过一页 = PDF 第一页被截断 = 用户看到不完整简历。
2. **缩略图视觉一致性**：v0.5 模板库 thumbnail 算法（`use-fit-thumbnail.ts:51`）按 `min(width-scale, height-scale)` 缩放。**内容超出 A4 比例时 height-scale 主导，缩略图宽度缩水产生左右白边**——和 v1 模板的撑满视觉不一致。这是 user-visible 体验问题。
3. **简历共识**：行业上简历就是 A4 一页（资深者偶尔两页）。模板设计本就该按 A4 单页排版，不是 v2 引入的额外约束。

**Skill 写 HTML 时的检查方法**：

写完 HTML/CSS 后用 dev-preview 路由（`/dev-preview/template/<id>`）看渲染。如果在 800px 宽容器里底部超出一屏（约 1123px viewport 高度），说明超过 A4 高度，**回头压缩 padding / margin / 标题字号**。常见可压缩的位置：

- banner padding（许多 PoC 一上来就给 banner 60px+ 上下 padding）
- section 之间的 margin（22px+ 太奢侈，14px 通常够）
- entry 内部的 padding 和 margin
- section-title 自己的 padding

**SKILL.md 完整教程**见 `template-studio-skill/SKILL.md` Step 3.4 章节。

### 4.3 Slot 契约（slot contract）

Claude 写 HTML 时用 `<slot data-bind="...">` 标记内容插槽。引擎读 ResumeContent 把 slot 替换成 React 节点。

#### 4.3.1 合法 binding 名

```
basics.name
basics.title
basics.email
basics.phone
basics.location
basics.url
basics.avatar
basics.status

sectionOrder              ← loop slot，按用户 sectionOrder 顺序展开
  section.title           ← 当前 section 的标题（来自 sectionMeta 或自定义 title）
  section.icon            ← 当前 section 的图标（lucide name 字符串）
  section.items           ← loop slot，循环当前 section 的 items
    item.header.title     ← 例如公司名 / 学校名 / 项目名
    item.header.subtitle  ← 例如职位 / 专业 / 角色
    item.header.dateRange ← 例如 "2022-至今"
    item.header.location  ← 例如 "北京"
    item.bullets          ← TipTap RichTextDoc（marks 自动渲染）
    item.tags             ← 例如技术栈 chip 数组
```

**两种 slot 类型**（实现层关键区分）：

- **value slot**（值插槽）：例如 `basics.name`、`section.title`、`item.header.title`——直接替换为字符串 / 数字 / RichText 节点。
- **loop slot**（循环插槽）：仅 `sectionOrder` 和 `section.items` 两个——必须配 `data-template="<id>"` 引用一个 `<template>` 定义；引擎按 iterable 长度 clone 该 template 多次。

#### 4.3.2 section.items 字段派生规则（critical）

`section.items` 不是 ResumeContent 上的字段，而是按当前迭代到的 section.id **派生**：

| 当前 section.id | 派生规则 | 备注 |
|---|---|---|
| `experience` | `content.experience.items` | 工作经历 |
| `education` | `content.education.items` | 教育背景 |
| `projects` | `content.projects.items` | 项目经历 |
| `skills` | `content.skills.categories.flatMap(c => c.skills.map(s => ({ header: { title: s.name }, ... })))` | **特殊**：把 categories 展平成 items 形态 |
| `summary` | **`[{ header: { title: "" }, bullets: content.summary.body }]`**（单元素数组）| **特殊**：summary 是单个 RichTextDoc，包装成 1 个 item，header 留空，bullets 直接是文本 |
| `awards` / `research` / `portfolio` / `activities` 等 preset | `content.<id>.items` | 同 experience 模式 |
| 其他（用户自定义 customSection id） | **跳过该 section**（不渲染） | 见 §3 non-goal |

**SlotRenderer 实现**：维护一个 `SECTION_ITEMS_DERIVATION` 表，按 section.id 查表得到当前 iterable。skills / summary 走特殊分支，其他走通用 `content[id].items` 路径。

#### 4.3.3 IterationContext 维护规则

嵌套 loop slot 时，引擎必须维护 `IterationContext` 并在递归 parse template HTML 时**透传 + 增量更新**。

```ts
type IterationContext = {
  section?: { id: string; title: string; icon: string };  // 在 sectionOrder loop 内可用
  item?: { header: ItemHeader; bullets: RichTextDoc; tags?: string[] };  // 在 section.items loop 内可用
};
```

**伪代码（SlotRenderer 内的 renderLoop）**：

```ts
function renderLoop(loopName, content, templates, templateRefId, ctx) {
  const tplHtml = templates[templateRefId];
  if (!tplHtml) return <span>[模板未定义: {templateRefId}]</span>;
  
  if (loopName === "sectionOrder") {
    return content.sectionOrder.map((sectionId, i) => {
      const section = resolveSection(sectionId, content);  // 含 title/icon
      if (!section) return null;  // customSection 跳过
      return parse(tplHtml, {
        replace: (node) => transformSlot(node, content, templates, 
          { ...ctx, section })  // 注入 section 到 ctx
      });
    });
  }
  
  if (loopName === "section.items") {
    if (!ctx.section) return <span>[section.items 必须在 sectionOrder loop 内]</span>;
    const items = deriveItems(ctx.section.id, content);  // §4.3.2 派生表
    return items.map(item =>
      parse(tplHtml, {
        replace: (node) => transformSlot(node, content, templates, 
          { ...ctx, item })  // 注入 item 到 ctx
      })
    );
  }
  
  return <span>[未知 loop: {loopName}]</span>;
}
```

**关键约束**：
- `section.*` binding 只在 `sectionOrder` loop 内有效；外部使用渲染 `[ctx 不可用]` 占位
- `item.*` binding 只在 `section.items` loop 内有效；外部同上
- 嵌套深度限制：**最多 3 层**（sectionOrder → section.items → 不再嵌套）。第 3 层嵌套 `<slot data-bind="loop">` 直接报错

#### 4.3.4 循环语法（决策：用 Web Components `<template>` 模式而非 Mustache）

理由：浏览器原生支持，AI 训练数据丰富，不需要发明 DSL。

```html
<!-- 顶层 -->
<article>
  <header>
    <h1><slot data-bind="basics.name" /></h1>
    <p><slot data-bind="basics.email" /></p>
  </header>
  
  <main>
    <!-- sectionOrder 循环 slot -->
    <slot data-bind="sectionOrder" data-template="section-tpl" />
  </main>
</article>

<!-- section 模板（在 <article> 之外）-->
<template id="section-tpl">
  <section class="my-section">
    <h2><slot data-bind="section.title" /></h2>
    <slot data-bind="section.items" data-template="item-tpl" />
  </section>
</template>

<!-- item 模板 -->
<template id="item-tpl">
  <div class="my-item">
    <strong><slot data-bind="item.header.title" /></strong>
    <span><slot data-bind="item.header.dateRange" /></span>
    <slot data-bind="item.bullets" />
  </div>
</template>
```

#### 4.3.5 错误处理

- **未知 binding 名**（例如 Claude 写 `data-bind="experience.company"`）→ 渲染 `[未知 slot: <name>]` 占位 + console.warn，**不击穿整页**。
- **缺失 template 引用**（`data-template="xxx"` 但找不到 `<template id="xxx">`）→ 渲染 `[模板未定义: xxx]` 占位。
- **ctx 不可用**（在 sectionOrder 外用 `section.title`）→ 渲染 `[ctx 不可用: <name>]` 占位。
- **嵌套超过 3 层** → 渲染 `[嵌套过深]` 占位 + console.error。
- **Slot 渲染过程抛错**（极端情况）→ React Error Boundary 兜底，整个模板降级到默认 fallback（用 `professional` variant 渲染）。

### 4.4 派发逻辑（向后兼容）

`<UploadedLayout>` 改造（位于 `lib/templates/uploaded/UploadedLayout.tsx`）：

```tsx
function UploadedLayout({ template, content, styleSettings }) {
  if (template.customHtml) {
    return <SlotRenderer 
      html={template.customHtml}
      css={template.customCss}
      content={content}
      styleSettings={styleSettings}
      decoration={template.decoration}
      templateId={template.id}
    />;
  }
  // 老路径：v1 enum-based 渲染（abbey / abbey-stub 走这里）
  return <VariantBasedLayout {...} />;
}
```

**关键**：`customHtml` 字段为 null/undefined 时走老路径——abbey 等 v1 模板不需要任何改动继续工作。

### 4.5 Skill 流程修订

| 步 | v1 | v2 |
|---|---|---|
| 1 | 看图决定装饰提取 prompt | 不变 |
| 2 | 调 gpt-image-2 提取装饰图 → `public/templates/decorations/<id>.png` | 不变 |
| 3 | **看图推断 LayoutConfig（4 个 enum 字段 + theme + sectionIcons）** | **看图直接写 HTML + CSS**（带 slot 标记，遵守对偶约束） |
| 4 | `insert-template.ts` 写 layout JSON 进 DB | `insert-template.ts` 写 `customHtml` + `customCss` 进 DB |
| 5 | 验证 | 验证 |

SKILL.md 完整改写——Step 3 章节替换。Lucide 白名单部分保留（slot 内仍然可用 lucide icon）。

### 4.6 安全边界

- **HTML sanitize**：`isomorphic-dompurify`（SSR 兼容）。白名单 tag：`article / header / main / section / div / span / p / h1-h6 / ul / ol / li / strong / em / a / img / time / template / slot / figure / figcaption`。`a` 强制 `rel="noopener noreferrer"`。
- **CSS auto-scope**：渲染器读 customCss 后用简单字符串替换，给所有 selector 加 `[data-template-id="<id>"]` 前缀（防主样式污染）。
- **CSS selector 限制**：
  - 禁止 universal selector（`* { ... }`）—— 会污染主页面所有元素
  - 禁止 element-only selector（`body { ... }`、`html { ... }`、`section { ... }` 这种没 class 限定的纯 element selector）—— 同样污染
  - **允许**：class selector（`.foo`）、id selector（`#bar`）、descendant 组合（`.foo .bar`）、伪类（`.foo:hover`）、`element.class` 复合（`section.my-card`）
- **CSS at-rule 限制**：v1 实现暂不支持 `@media` / `@keyframes` / `@supports` / `@import`。Skill 写时遇到这些一律改成 class selector + JS 切换（响应式可用 container query polyfill 后续支持）。
- **属性禁用**：`on*` 事件处理器（`onclick` 等）、`style` 内嵌 expression（`expression(...)`、`url(javascript:...)`）、`position: fixed` / `position: sticky`（绕出 page boundary）。
- **装饰图 URL**：必须以 `/templates/decorations/` 或 `/handcoded/` 开头（项目 public/ 内）；外部 URL 拒绝。

---

## 5. 架构

### 5.1 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  阶段 A：运营上传 → Skill 处理（本地 Claude Code）            │
└─────────────────────────────────────────────────────────────┘
       │ 运营在 Claude Code 跑：
       │   "把 abbey-banner.pdf 做成模板，id=abbey-banner"
       ▼
┌────────────────────────────────────────┐
│  Skill: template-studio                │
│                                        │
│  ① 转截图（pdftoppm 如需）               │
│  ② 调 gpt-image-2 提取装饰图             │
│  ③ Claude 看图写 HTML + CSS（带 slot）   │
│     遵守对偶约束（用户能调的字段必须 var）│
│     遵守 slot binding 名约定             │
│     用现成 PoC（handcoded-crimson）作参考│
│  ④ 写入 templates 表                    │
│     customHtml + customCss + decoration │
│     status='draft'                      │
│  ⑤ 运营在 dev-preview 路由 review/微调   │
│  ⑥ 运营 promote 到 status='published'   │
└────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  阶段 B：C 端用户使用（Web）                                  │
└─────────────────────────────────────────────────────────────┘
       │ 用户在 /templates 选模板 / 应用到当前简历
       ▼
┌────────────────────────────────────────┐
│  registry.getTemplateMetaAsync(id)     │
│  → UploadedLayout 派发                   │
│    customHtml 存在 → SlotRenderer        │
│    否则 → VariantBasedLayout（老路径）    │
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│  SlotRenderer                          │
│  1. DOMPurify sanitize HTML（白名单 tag）│
│  2. 提取 <template id="..."> 定义到 Map  │
│     **从主 HTML 中移除 <template> 节点** │
│     （否则 React 输出原生 template 节点， │
│      浏览器看到不渲染内容但 DOM 树留痕，  │
│      可能引发 hydration mismatch）       │
│  3. CSS auto-scope（加 scope 前缀）       │
│  4. html-react-parser 解析主 HTML        │
│  5. 遍历找到 <slot data-bind="...">      │
│     - value slot → 替换为 React 节点      │
│     - loop slot → 递归 parse 引用 template│
│       并维护 IterationContext 透传        │
│  6. 富文本字段用 RichTextRenderer        │
│  7. 注入 styleSettings → CSS 变量         │
│  8. 输出最终 React DOM                   │
└────────────────────────────────────────┘
       │
       ▼
       渲染 / 编辑预览 / Puppeteer PDF
```

### 5.2 SlotRenderer 接口

```tsx
// lib/templates/uploaded/html-slot-renderer.tsx
export type SlotRendererProps = {
  html: string;                          // Claude 写的 HTML
  css: string | null;                    // Claude 写的 CSS
  content: ResumeContent;
  styleSettings: StyleSettings;
  decoration: DecorationConfig | null;
  templateId: string;                    // 用作 CSS scope id
};

export function SlotRenderer(props: SlotRendererProps): React.ReactNode;
```

### 5.3 关键实现选型（已调研）

| 工具 | 用途 | 理由 |
|---|---|---|
| **isomorphic-dompurify** | XSS sanitize | SSR 兼容（Next.js App Router 关键），周下载量 1M+，行业标准 |
| **html-react-parser** | HTML 字符串 → React 节点树 | 周下载 1M+，提供 visitor 模式让我们在每个节点做 slot 替换 |
| **CSS auto-scope** | 用简单字符串替换实现（不引 PostCSS 依赖） | 模板 CSS 通常 < 200 行，简单实现足够；后续复杂了再换 |

**RichText 渲染依赖**：项目已有 `components/preview/rich-text-renderer.tsx`（TipTap JSON → React 节点）。SlotRenderer 在处理 `item.bullets` slot 时直接调用此组件，不重新发明。Plan Task 6 必须先核实其接口（接 `doc: TipTapJSON` 还是 `content: TipTapJSON`）。

---

## 6. 模板数据结构

### 6.1 DB 表 `templates` 改动

```sql
ALTER TABLE templates 
  ADD COLUMN customHtml text,    -- Claude 写的带 slot HTML
  ADD COLUMN customCss text;     -- Claude 写的 CSS（自动加 scope 前缀）
```

两列均 nullable。原 `decoration` / `layout` 列**完全保留**——abbey 等 v1 模板继续工作。

### 6.2 UploadedTemplate Zod schema 扩展

```ts
// lib/templates/uploaded/types.ts
export const UploadedTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  decoration: DecorationConfig.nullable(),
  layout: LayoutConfig,                   // v1 路径仍然必需（向后兼容）
  // v2 新增（可选——v1 模板这两个字段为 null）
  customHtml: z.string().nullable(),
  customCss: z.string().nullable(),
});
```

**关键决策**：`layout` 字段在 v2 模板中**仍然要求填**（哪怕 customHtml 优先），原因是 abbey-stub 这类 fallback 路径仍然要用 layout JSON 作"如果 customHtml 渲染失败时的降级方案"。Skill v2 写入时填一个最小有效 LayoutConfig（professional + 黑色 primaryColor + 空 sectionIcons）即可。

### 6.3 customHtml 内容约定（合规 schema）

Claude 写的 HTML 必须满足：

1. **顶层只有一个 `<article>`**——作为模板根节点（CSS scope 锚点）。
2. **所有 `<template id="...">` 在 `<article>` 之外**——在 HTML 字符串末尾扁平列出。
3. **slot 标签自闭合或空内容**——`<slot data-bind="..." />` 或 `<slot data-bind="..."></slot>`，不放 fallback 文字。
4. **template 引用闭包**——`<slot data-template="X">` 引用的 `<template id="X">` 必须在同一个 customHtml 字符串里。
5. **嵌套深度 ≤ 3 层**——`sectionOrder` (L1) → `section.items` (L2) → 内部不再有 loop slot (L3 是 value slot 或简单标签)。第 4 层 loop slot 渲染时报错 `[嵌套过深]`，防止 stack overflow 和无意识递归。
6. **template 数量 ≤ 8 个**——超出可能是 Claude 误用循环；防止内存膨胀。

---

## 7. 影响的文件清单

### 新增

- `lib/templates/uploaded/html-slot-renderer.tsx` — slot 渲染器主体（约 80-120 行）
- `lib/templates/uploaded/slot-bindings.ts` — binding 名 → ResumeContent 字段访问器（约 60 行）
- `lib/templates/uploaded/css-scope.ts` — CSS auto-scope 工具（约 40 行）
- `db/migrations/00XX_template_custom_html.sql` — 加两列
- `prototypes/handcoded-crimson/index-with-slots.html` — PoC 改造
- `app/dev-preview/template/handcoded-crimson/page.tsx` — PoC 验证路由
- `tests/unit/html-slot-renderer.test.tsx` — slot 替换单测
- `tests/unit/css-scope.test.ts` — CSS scope 单测

### 修改

| 文件 | 改动 |
|---|---|
| `db/schema.ts` | templates 表加 customHtml / customCss 两列 |
| `lib/templates/uploaded/types.ts` | UploadedTemplate Zod 加两个 nullable 字段 |
| `lib/templates/uploaded/UploadedLayout.tsx` | 加 customHtml 派发分支 |
| `lib/templates/uploaded/fetch.ts` | parseTemplateRow 多读两列 |
| `template-studio-skill/SKILL.md` | Step 3 重写（推断 enum → 写 HTML/CSS）；新增对偶约束 + slot 契约章节 |
| `template-studio-skill/scripts/insert-template.ts` | 加 `--custom-html` / `--custom-css` 文件路径参数 |
| `package.json` + `pnpm-lock.yaml` | 加 `isomorphic-dompurify` + `html-react-parser` 依赖 |

### 完全不动

- `app/(app)/templates/*`（v0.5 模板库 surface，另一个 agent 的工作）
- `components/templates/*`（缩略图组件）
- `components/editor/*`（编辑器）
- `lib/templates/professional/` `/classic/` `/modern/`（内置 React 模板）
- `app/(app)/resume/[id]/edit/*`（编辑页 + actions）

---

## 8. 验收标准

### 8.1 自动化测试

- [ ] DB migration 在干净 schema 上跑通；abbey-stub 行查询仍返回正常（`customHtml=null`）
- [ ] `<SlotRenderer>` 单测：给定 mock HTML（带各种 slot）+ ResumeContent，渲染 DOM 结构正确
- [ ] 未知 binding → fallback `[未知 slot: xxx]` + console.warn
- [ ] CSS auto-scope：输入 `.foo { ... }` 输出 `[data-template-id="<id>"] .foo { ... }`
- [ ] DOMPurify 拦截：`<script>` / `on*` 属性 / `position:fixed` 都被剥离
- [ ] 现有 abbey / professional / classic / modern 单测继续通过（无回归）
- [ ] `getTemplateMetaAsync('abbey')` 返回完整 layout（v1 路径不破）

### 8.2 PoC 验证

- [ ] `prototypes/handcoded-crimson/index-with-slots.html` 接到 SlotRenderer
- [ ] 浏览器打开 `/dev-preview/template/handcoded-crimson` 视觉 vs `docs/handcoded-crimson-banner-png-v4.png` 一致 ≥ 90%
- [ ] 改 ResumeContent（编辑姓名 / 增删项目）→ HTML 模板自动反映
- [ ] 拖动 sectionOrder → section 顺序变化 + 视觉仍然合理
- [ ] 用户调字号 / 字体 / 行距 → 通过 CSS 变量穿透生效
- [ ] 富文本加粗 / 标红 / 链接 → slot 内 RichText 正确渲染

### 8.3 端到端 Skill 验证

- [ ] Skill v2 流程跑通：选一张新参考图 → Skill 看图写 HTML/CSS → 写入 DB → C 端 dashboard 出现 → 用户选用 → 编辑器实时预览正常 → PDF 导出与预览一致
- [ ] 用户在编辑器调字号 → 模板响应（装饰图不变，颜色不变，字号变）
- [ ] Status 闸门：写入时 `status='draft'`，运营手工 promote 到 `published`

### 8.4 PR 闸门

- [ ] `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` 全绿
- [ ] 现有 abbey / abbey-stub 模板渲染未回归
- [ ] PR 描述附 PoC 截图 + 端到端新模板截图

---

## 9. 风险与对策

| 风险 | 严重度 | 对策 |
|---|---|---|
| **R1** Claude 写错 slot 名（`data-bind="name"` 而非 `basics.name`）→ 显示 `[未知 slot]` | 中 | SKILL.md 列出完整 binding 名表 + 写完调用 lint script 检测；fallback 显示明确占位不击穿 |
| **R2** Claude 硬编码字号 / 字体 / 行距违反对偶约束 | 中 | SKILL.md 强约束 + 写入前 `grep -E "font-(size\|family)\|line-height" customCss \| grep -v "var("` 检测，非空则拒绝写入 |
| **R3** 富文本 marks 在 slot 内样式冲突（外层模板的 `strong` 样式覆盖 TipTap 加粗） | 中 | RichText 包裹层加 `isolation: isolate` + 内部样式用更高 specificity |
| **R4** Puppeteer 截 PDF 时 sanitize 行为差异 | 低 | `isomorphic-dompurify` 已 SSR-safe；CI 加一条 PDF snapshot 测试 |
| **R5** CSS auto-scope 简单字符串替换碰到 `@media` / `@keyframes` 失败 | 中 | v1 实现先支持简单 selector；遇到 at-rule 时报错让 Claude 改写；后续引 PostCSS 升级 |
| **R6** Claude 写出过宽 selector（`* { ... }`、`body { ... }`）污染主样式 | 中 | DOMPurify 后 + CSS auto-scope 双保险；额外加一条「禁止 universal selector / element-only selector」检测 |
| **R7** 富文本 wrapper 在 slot 内导致 layout shift | 低 | PoC 阶段验证 |
| **R8** customHtml 太长（> 100KB）拖慢 SSR | 低 | 加上限 50KB；超出拒绝写入 |
| **R9** v1 abbey 模板用户切换到 v2 模板后内容字段映射错（v1 layout JSON 字段在 v2 不存在） | 低 | 切换模板时 styleSettings reset 即可；ResumeContent 跟模板无关，不需要迁移 |
| **R10** SSR / CSR hydration mismatch（SlotRenderer 在 server / client 输出不一致） | 中 | `isomorphic-dompurify` 是 SSR-safe；Plan Task 6 实测 SSR + CSR 双路径，CI 加 hydration warning 检测；如果发现差异，把 SlotRenderer 标 `"use client"` 强制单路径渲染（接受首屏 fallback skeleton 一闪） |
| **R11** Skill 写的固定 HTML 在极端内容数量下退化（应届生 0 项目 / 资深者 15 项目布局崩坏） | 中 | spec §3 明确为 non-goal；PoC 验证至少覆盖「正常规模」用例（5±2 项工作 / 3±2 项目）；后续 v2.x 可加 CSS Grid auto-fit / max-rows 模板模式 |
| **R12** Claude 把 sectionOrder 中**找不到内容的 section** 也渲染（输出空 section 卡片）| 低 | SlotRenderer 的 sectionOrder loop 派生时如果 items 为空数组（且非 summary）→ 跳过该次迭代，不输出空 DOM |

---

## 10. Self-Review

- **Placeholder 扫查**：无 TBD / TODO 占位。
- **内部一致性**：三层架构（§4.1）↔ slot 契约（§4.3，含派生规则 §4.3.2 / IterationContext §4.3.3）↔ SlotRenderer 接口（§5.2）↔ DB schema（§6.1）↔ 影响文件（§7）↔ 验收（§8）六处对齐。
- **范围检查**：单一目标（让 Skill 输出 HTML/CSS 而非 enum 配置），未夹带 AI 推荐 / 协作 / 引导流等其它产品方向。CustomSection / 内容数量适应性 / 多页装饰均明确放进 non-goals。
- **歧义检查**：「slot 实现选型」明确为 Web Components 风格 `<slot>` 而非 Mustache（§4.3）；「向后兼容」明确为 customHtml=null 走老路径（§4.4）；「v1 是否 deprecate」明确否（§3）；「summary section 渲染」明确为单元素 items 包装（§4.3.2）。
- **可行性检查**：handcoded-crimson PoC（`prototypes/handcoded-crimson/index.html`）已证视觉能力；`isomorphic-dompurify` + `html-react-parser` 都是行业标准 lib，无重新发明。

---

## 11. 进入 plan 前的开放问题（待用户拍板）

1. **Slot 语法是 `<slot data-bind="...">` 还是 Mustache `{{basics.name}}`？** 建议前者——Web Components 标准，AI 训练数据丰富，浏览器原生 `<slot>` 元素，与 React 不冲突（renderer 自己解析替换）。
2. **CSS auto-scope 是否引 PostCSS？** 建议 v1 用简单字符串替换（< 40 行），覆盖 80% 用例；遇到 `@media` 等 at-rule 报错让 Claude 改写。后续真有需要再升级。
3. **Skill v1 enum 路径是否保留？** 建议保留——abbey 已用 v1 路径生产，作为"快速参数化"备选。Skill v2 默认推荐自由排版，但保留 enum 路径作 fallback 不删。
4. **handcoded-crimson PoC 改造谁来做？** 建议 plan 里 Task 7 由当前会话执行——这是验证 schema 设计的关键路径。
5. **isomorphic-dompurify 加 dep 是否同意？** 建议同意——XSS 防护必备，行业标准。

---

> 本 spec 评审通过后，进入 plan 阶段，按 `superpowers/writing-plans` 写实现步骤。
