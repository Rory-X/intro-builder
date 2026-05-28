# intro-builder Template Studio：PDF → 模板 中台 Spec

> 日期：2026-05-24
> 状态：spec 草稿，待评审 → 之后进 plan
> 上游讨论：脑暴会话（同日，未单独存档）

## 1. 为什么做

### 1.1 现状

- 内置 3 套模板（professional / classic / modern）全部是 React 组件，硬编码在 `lib/templates/<id>/Layout.tsx`
- 模板 ID 是 TypeScript 字面量联合类型（`lib/templates/types.ts:3`），新增模板**必须改源码 + 重新部署**
- `TEMPLATES` 注册表是 `import` 出来的常量数组（`lib/templates/registry.ts:23-27`），没有运行时通道

### 1.2 痛点

- 加一个新模板的工时：4-8 小时（设计 + 写 React 组件 + 写测试 + 走 spec → plan → impl → review → 部署）
- 模板库扩张速度 = 工程师排期，**与运营/设计师的产能不匹配**
- 竞品的模板库通常 30-50 套，本项目 3 套远落后

### 1.3 目标场景

运营手里有一份精美的简历样本（PDF / 截图 / 设计稿），想**不写代码**就把它做成新模板入库，让 C 端用户能选用。

---

## 2. 目标

按重要度：

1. **让运营不动代码加新模板**：上传一份简历图 → 几分钟内产出可入库的新模板配置
2. **解耦模板供给 / 工程排期**：模板库扩张速度从「工程排期」变成「运营丢图的速度」
3. **复用性**：核心 AI 工作流做成 Claude Code skill（`~/.claude/skills/template-studio/`），其他业务（PPT 模板、名片模板、海报模板…）能复用同一套
4. **不打破现有架构**：内置 3 个 React 模板保留不动，新机制纯增量

---

## 3. 不做什么（明确边界）

- ❌ **不追求像素级 100% 还原**：AI 生图能力上限是 85-95% 视觉一致，接受这个限制
- ❌ **不做多页装饰**（本项目简历限制为单页）
- ❌ **不替换现有 React 模板格式**（professional / classic / modern 维持 .tsx）
- ❌ **不做 LaTeX / Typst 模板载体**（已在调研中排除）
- ❌ **不做 C 端用户自传模板**：仅运营内部使用，避免 UGC 审核负担和版权风险
- ❌ **不做 AI 写代码**：通用渲染器是工程师写好的固定 React 组件，AI 只输出**配置数据**
- ❌ **不做"上传即自动发布"**：必须有运营人工 review 闸门

---

## 4. 产品决策

### 4.1 模板载体格式

**HTML + Tailwind**（沿用现有 React 组件 + Puppeteer PDF 路线）。

理由（已在调研中评估）：
- AI 训练数据中 HTML+Tailwind 最丰富，AI 出错率最低
- 兼容现有 Puppeteer PDF 路由 + TipTap 富文本 + 现有 styleSettings
- 不需要重写编辑器、PDF 渲染管线

### 4.2 三层架构

新模板拆解成 3 个独立可变维度：

| 层 | 内容 | 提供方 |
|---|---|---|
| **Layer 1：装饰图层** | 浅底色 / 装饰曲线 / 复杂花纹 / 几何图案 | AI 生图（一张 PNG） |
| **Layer 2：结构骨架** | 卡片样式 / Section 标题样式 / 间距 / 主题色 | AI 推断（一份 JSON 配置） |
| **Layer 3：文字内容** | 姓名 / 经历 / 项目 / 技能 ... | 用户填表（沿用现有） |

Layer 1 和 Layer 2 是新模板独有的，Layer 3 完全复用现有 ResumeContent。

### 4.3 通用渲染器一份共用

工程师写**一份固定的 React 组件** `<UploadedLayout>`，所有 DB 模板都走它。它消费：
- Layer 1：装饰图 URL + 位置
- Layer 2：结构骨架配置 JSON
- Layer 3：用户填的 ResumeContent

**AI 不写代码，只输出配置 JSON**。

### 4.4 AI 模型分工

| AI | 职责 | 候选模型 |
|---|---|---|
| **生图 AI** | 看上传图 → 输出"去掉文字、保留装饰、提高清晰度"的高清 PNG | GPT Image 1 / Nano Banana / 即梦 4.0 / 千问 Wanx 2.5 |
| **推理 AI** | 看上传图 → 输出结构骨架配置 JSON | Claude Sonnet 4.5 / GPT-4o |

具体模型选型在 plan 阶段决定（需要跑一组真实样本对比）。

### 4.5 skill 形态

**本地 Claude Code skill**（`~/.claude/skills/template-studio/`）。

- 运营在 Claude Code CLI 跑：`@template-studio 处理 abbey.pdf`
- skill 内部协调：调生图 AI → 调推理 AI → 整合 → 通过环境变量里的 `DATABASE_URL` 直接连远程 PostgreSQL 写入
- 不做服务端 API（仅本地工具，PoC 优先）

### 4.6 入库通路

skill 直接连**远程生产数据库**写入（运营本地的 `~/.env` 或 `.env.template-studio` 提供 `DATABASE_URL`）。

理由：
- PoC 阶段复杂度最低
- 内部工具，不暴露给 C 端，安全性可控
- 走 Drizzle ORM 复用 schema 类型（避免 schema drift）

### 4.7 主题色 / 字体可调性

**保留**：用户在编辑器里改主题色 / 字体 / 字号，DB 模板必须响应。
- 主题色通过 CSS 变量（`--primary`）注入
- 字体通过现有 `FONT_MAP` 系统
- 装饰图本身的色调可能与用户改的主题色冲突 → UI 给提示，但不强制限制

---

## 5. 架构

### 5.1 数据流（运营上传到 C 端使用）

```
┌─────────────────────────────────────────────────────────────────┐
│  阶段 A：运营上传 → skill 处理（本地 Claude Code）               │
└─────────────────────────────────────────────────────────────────┘
       │
       │ 运营在 Claude Code 跑：
       │   @template-studio process abbey.pdf --name "陈媛媛优雅风"
       ▼
┌────────────────────────────────────────┐
│  skill: template-studio                │
│                                        │
│  ① 上传 PDF/PNG → 转首页截图              │
│  ② 调生图 AI                            │
│     prompt: "复刻这张简历的装饰          │
│      去除所有文字，提高清晰度到 300dpi"   │
│     → 拿到 decoration.png              │
│  ③ 上传 decoration.png 到 Vercel Blob   │
│  ④ 调推理 AI                            │
│     prompt: "看这张图，输出 JSON：       │
│      header 样式 / section 样式 /       │
│      主题色 / 字体 / 间距 ..."           │
│     → 拿到 layoutConfig.json           │
│  ⑤ 让运营在终端 review/微调               │
│  ⑥ 写入 templates 表（远程 DB）           │
└────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  阶段 B：C 端用户使用（Web）                                     │
└─────────────────────────────────────────────────────────────────┘
       │
       │ 用户在 dashboard 模板库选 "陈媛媛优雅风"
       ▼
┌────────────────────────────────────────┐
│  registry.getTemplateMeta(id)          │
│    内置（3 个）+ DB（N 个）合并查询       │
└────────────────────────────────────────┘
       │
       ▼
┌────────────────────────────────────────┐
│  <UploadedLayout                       │
│    content={resumeContent}             │
│    template={dbTemplate}               │
│    styleSettings={userOverrides} />    │
└────────────────────────────────────────┘
       │
       ▼
       渲染 / 编辑预览 / Puppeteer PDF
```

### 5.2 skill 接口

```
@template-studio process <input-file> [--name <name>] [--dry-run]
@template-studio list                                  # 列出已上传的模板
@template-studio delete <template-id>                  # 删除某个 DB 模板
@template-studio regenerate <template-id> [--decoration-only|--layout-only]
```

`--dry-run` 跑完不入库，把生成的装饰图 + 配置 JSON 输出到本地预览。

### 5.3 通用渲染器架构

```tsx
// lib/templates/uploaded/UploadedLayout.tsx
type Props = {
  content: ResumeContent
  template: UploadedTemplate    // DB 行
  styleSettings?: StyleSettings  // 用户在编辑器的 override
}

export function UploadedLayout({ content, template, styleSettings }: Props) {
  return (
    <ResumePage
      styleSettings={styleSettings}
      decoration={template.decoration}              // ← 装饰图层
      style={cssVarsFromTheme(template.layout.theme)}
    >
      <ResumeHeader 
        basics={content.basics}
        variant={template.layout.headerVariant}    // 复用 3 个 variant
      />
      {sectionOrder.map(key => (
        <ResumeSection
          variant={template.layout.sectionTitleVariant}
          icon={lucideIcon(template.layout.sectionIcons[key])}
          {...}
        />
      ))}
    </ResumePage>
  )
}
```

`<ResumePage>` 加 `decoration` prop（向后兼容，default `undefined`）。

---

## 6. 模板数据结构

### 6.1 DB 表 `templates`

```ts
// db/schema.ts
export const templates = pgTable('templates', {
  id: text('id').primaryKey(),                    // 'abbey-elegant'
  name: text('name').notNull(),                   // '陈媛媛优雅风'
  description: text('description'),
  thumbnailUrl: text('thumbnail_url'),
  source: text('source').notNull(),               // 'builtin' | 'uploaded'
  
  decoration: jsonb('decoration').$type<DecorationConfig>(),
  layout: jsonb('layout').$type<LayoutConfig>().notNull(),
  
  status: text('status').notNull().default('draft'),  // 'draft' | 'published'
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})
```

### 6.2 配置类型

```ts
type DecorationConfig = {
  bgImageUrl: string                                  // Vercel Blob URL
  placement: {
    position: 'absolute'
    top: string                                       // '0', '20px', ...
    right: string
    width: string                                     // '40%', '120mm'
    height: string                                    // 'auto'
    zIndex: number
    opacity: number
  }
  pageBgColor?: string                               // 浅底色，避免装饰图覆盖整个底
}

type LayoutConfig = {
  // 复用现有 variant，不重新发明
  headerVariant: 'professional' | 'classic' | 'modern-sidebar'
  sectionTitleVariant: 'professional' | 'classic' | 'modern' | 'card-wrapped'
  itemHeaderVariant: 'professional' | 'classic' | 'modern'
  
  // 主题色（CSS 变量）
  theme: {
    primaryColor: string
    accentColor: string
    cardBg?: string
    cardRadius?: string
    cardShadow?: string
    fontFamily?: string
  }
  
  // Section 图标映射
  sectionIcons: Record<string, string>               // 'experience': 'Briefcase'
}
```

### 6.3 新增 variant：`card-wrapped`

陈媛媛 Abbey 那张图的样式（圆形图标 + 横线 + 圆角白卡片包裹整段）需要新增一个 section title variant，加在 `lib/templates/shared/resume-section.tsx` 现有分支里。

---

## 7. 影响的文件清单

### 新增

- `~/.claude/skills/template-studio/SKILL.md` — skill 入口
- `~/.claude/skills/template-studio/scripts/process.ts` — 主流程
- `~/.claude/skills/template-studio/scripts/extract-decoration.ts` — 调生图 AI
- `~/.claude/skills/template-studio/scripts/infer-layout.ts` — 调推理 AI
- `~/.claude/skills/template-studio/scripts/db-insert.ts` — 入库
- `~/.claude/skills/template-studio/scripts/preview.ts` — `--dry-run` 输出
- `~/.claude/skills/template-studio/.env.example` — DATABASE_URL / AI keys
- `lib/templates/uploaded/UploadedLayout.tsx` — 通用渲染器
- `db/migrations/0XXX_add_templates_table.sql` — 建表
- `tests/unit/uploaded-layout.test.tsx` — 通用渲染器单测
- `tests/unit/template-registry-merge.test.ts` — 内置 + DB 合并查询单测

### 修改

| 文件 | 改动 |
|---|---|
| `db/schema.ts` | 加 `templates` 表 |
| `lib/templates/types.ts:3` | `TEMPLATE_IDS` 从字面量联合改字符串（保留内置 3 个为常量但允许扩展） |
| `lib/templates/registry.ts` | 加 `getTemplateMetaAsync`：先查内置，未命中查 DB |
| `lib/templates/shared/resume-page.tsx` | 加 `decoration?: DecorationConfig` prop |
| `lib/templates/shared/resume-section.tsx` | 加 `card-wrapped` variant 分支 |
| `app/(app)/dashboard/page.tsx` | 模板库列表合并内置 + DB 模板 |
| `components/editor/style-editor.tsx` | 模板卡片来源加 DB |
| `app/(app)/resume/[id]/edit/actions.ts` | 校验 templateId 时支持 DB 模板 |

---

## 8. 验收标准

### 8.1 自动化测试

- [ ] `templates` 表建表 migration 在干净 DB 上跑通
- [ ] `<UploadedLayout>` 单测：给定 mock 的 template + content，渲染出预期的 DOM 结构（装饰图 / header / sections）
- [ ] `getTemplateMetaAsync` 单测：内置 ID 不查 DB；未知 ID 查 DB 命中返回 DB 配置；都未命中 fallback 到默认
- [ ] `<ResumePage>` 单测：传 `decoration` 渲染装饰图层；不传向后兼容
- [ ] `card-wrapped` variant 单测：渲染出圆角卡片 + 圆形图标 + 横线
- [ ] 现有 3 个模板的所有单测继续通过（无回归）

### 8.2 手工验收

跑陈媛媛 Abbey 简历样本（已在 spec 上下文有该样本）：

- [ ] 在 Claude Code 跑 `@template-studio process abbey.pdf --name "陈媛媛优雅风"`
- [ ] skill 输出装饰图 PNG（无文字、清晰、与原图视觉相似度 ≥ 80%）
- [ ] skill 输出 layout JSON（headerVariant / sectionTitleVariant / theme.primaryColor 等字段都有合理值）
- [ ] `--dry-run` 模式下能在本地预览生成的模板（用 demo 简历填充）
- [ ] 正式入库后，C 端 dashboard 模板库出现新模板
- [ ] 用户选用新模板 → 编辑器实时预览正常 → PDF 导出与预览一致
- [ ] 用户在编辑器改主题色 / 字体 → 渲染响应（装饰图不变）

### 8.3 PR 闸门

`pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` 全绿。

---

## 9. 风险与对策

| 风险 | 严重度 | 对策 |
|---|---|---|
| **R1：AI 复刻精度上限**（85-95% 视觉一致） | 高 | 接受，在 spec 里明确；运营审核闸门 + `regenerate --decoration-only` 重生兜底 |
| **R2：AI 推断布局错位** | 中 | 多次跑同一张图取一致结果（self-consistency）；`--dry-run` 让运营 review；提供 `regenerate --layout-only` |
| **R3：装饰图色调与用户后续改的主题色冲突** | 中 | UI 给运营 + 用户提示；保留装饰图原色调建议作为模板默认主题色 |
| **R4：现有 React 模板与 DB 模板的渲染管线分叉** | 中 | 共用 `<ResumePage>` 和 shared 原语；分叉只在最外层 Layout 组件，不在 section 渲染层 |
| **R5：模板 ID 改字符串后失去 type-safe** | 低 | 内置 3 个保留 const + literal 类型；DB 模板用 `string`，运行时 fallback 到 default |
| **R6：本地 skill 直连生产 DB 的安全风险** | 中 | 用单独的运营账号 + 受限权限（只能 INSERT/UPDATE templates 表）；不走 root user |
| **R7：装饰图 Vercel Blob 流量爆炸** | 低 | 缩略图限制尺寸（800px）；首页装饰原图限制 < 2MB |
| **R8：富文本（TipTap）在 DB 模板下渲染异常** | 中 | 复用现有 `<ResumeRichText>`，不在 DB 模板里碰富文本配置 |
| **R9：头像位置在 DB 模板中可能与装饰图重叠** | 中 | LayoutConfig 加 `photoPlacement` 字段；运营在 review 时调整 |
| **R10：模板库滥增，质量参差** | 低 | `status: draft \| published` 区分；C 端只显示 published；运营手工 promote |

---

## 10. Self-Review

- **Placeholder 扫查**：无 TBD / TODO 占位，所有节都有内容
- **内部一致性**：三层架构（4.2）↔ 数据结构（6）↔ 通用渲染器（5.3）三处对齐；section title variant 在 6.3 + 7（修改文件）+ 9（R3）三处都提到
- **范围检查**：单一目标（运营上传简历做模板），未夹带 AI 内容润色 / 协作 / 引导流等其它产品方向
- **歧义检查**：「skill 跑在哪里」明确为本地（4.5）；「AI 写不写代码」明确为不写（4.3）；「精度预期」明确为 85-95%（3 + R1）
- **可行性检查**：基于 2026-05-24 调研：JadeAI 50 个 .ts 模板手工堆 + Reactive Resume @react-pdf 组件路线，本 spec 的 React + 共享 variant 路线是最小动作

---

## 11. 进入 plan 前的开放问题（待用户拍板）

1. **生图 AI 候选**：GPT Image 1 / Nano Banana / 即梦 4.0 / 千问 Wanx 2.5 哪个先试？建议：先试 Nano Banana（Google 系，与 Gemini 2.5 一脉同栈，i2i 编辑能力公认强） + 即梦 4.0（中文圈最佳）跑同一张图对比
2. **推理 AI 候选**：Claude Sonnet 4.5 / GPT-4o，建议 Claude Sonnet 4.5（项目其它 AI 模块已用 OpenAI 兼容 SDK，可统一）
3. **运营账号 DB 权限**：要为 skill 单独建一个 PG role 吗？（R6）
4. **入库前的 review 机制**：纯命令行 review，还是临时起一个本地 web 预览？建议本地 web 预览（运营接受度高于看 JSON）
5. **是否要给装饰图加水印 / 防盗用机制**：内部工具暂不需要

---

> 本 spec 评审通过后，进入 plan 阶段，按 `superpowers/writing-plans` 写实现步骤。
