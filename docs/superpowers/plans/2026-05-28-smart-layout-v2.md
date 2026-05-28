# Smart Layout v2 — Implementation Plan

> 日期：2026-05-28
> 关联 Spec：`docs/superpowers/specs/2026-05-28-smart-layout-v2.md`

**Goal:** 智能排版算法可调维度从 3 个扩到 5 个；MIN 三件套压低；让内置 + v2 模板都消费新字段。

**Architecture:** 4 个切片，每片 commit 后 app 仍可跑（向后兼容默认值不变）。

**分支:** `feature/smart-layout-v2`（已建）

---

## 切片 1：schema 加字段（仅扩展，零行为变化）

### Task 1.1: `lib/resume-schema.ts` 加 sectionGap / itemGap

**Files:** `lib/resume-schema.ts`、`tests/unit/resume-schema.test.ts`

**Step 1: 扩展 StyleSettings**

```ts
export const StyleSettings = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
  fontSize: z.number().min(8).max(16).default(13),       // min 10→8
  lineHeight: z.number().min(1.05).max(2.0).default(1.6),// min 1.2→1.05
  pagePadding: z.number().min(8).max(60).default(40),    // min 20→8
  sectionGap: z.number().min(4).max(24).default(16),     // 新增
  itemGap: z.number().min(2).max(16).default(12),        // 新增
});

export const DEFAULT_STYLE_SETTINGS: StyleSettings = {
  fontFamily: "sans",
  fontSize: 13,
  lineHeight: 1.6,
  pagePadding: 40,
  sectionGap: 16,
  itemGap: 12,
};
```

**Step 2: 测试向后兼容**
- [ ] 加测试：旧 styleSettings（无 sectionGap / itemGap）parse 成功，自动填 default
- [ ] 加测试：MIN 边界 fontSize=8 / lineHeight=1.05 / pagePadding=8 接受

**Step 3: 闸门**
- [ ] `pnpm test resume-schema` PASS
- [ ] `pnpm tsc --noEmit` PASS

**Step 4: Commit**
```bash
git add lib/resume-schema.ts tests/unit/resume-schema.test.ts
git commit -m "feat(schema): add sectionGap/itemGap, lower MIN bounds for smart-layout v2"
```

---

## 切片 2：算法层升级

### Task 2.1: `lib/smart-layout.ts` 加新维度 + 调 MIN

**Files:** `lib/smart-layout.ts`、`tests/unit/smart-layout.test.ts`

**Step 1: 调 MIN 常量 + 加 2 个新 MIN**

```ts
const MIN_FONT = 8;          // 10→8
const MIN_LINE_HEIGHT = 1.05; // 1.2→1.05
const MIN_PADDING = 8;        // 20→8
const MIN_SECTION_GAP = 4;    // 新增
const MIN_ITEM_GAP = 2;       // 新增
```

**Step 2: `interpolateSettings` 扩到 5 维**

linear interpolation 同模式加上 sectionGap / itemGap 的 lerp。Round 到整数。

**Step 3: 测试**
- [ ] `interpolateSettings(current, 0)` 输出 = 5 个 MIN 值
- [ ] `interpolateSettings(current, 1)` 输出 = current（含 sectionGap/itemGap 不变）
- [ ] `interpolateSettings(current, 0.5)` 5 个字段都是中点

### Task 2.2: `hooks/use-smart-layout.ts` 测量函数加 CSS 变量写入

**Files:** `hooks/use-smart-layout.ts`

**Step 1: `measure` 函数除 inline style 外加 setProperty**

```ts
article.style.fontSize = `${ss.fontSize}px`;
article.style.lineHeight = `${ss.lineHeight}`;
article.style.padding = `${ss.pagePadding}px`;
article.style.fontFamily = FONT_MAP[ss.fontFamily].css;
article.style.setProperty("--section-gap", `${ss.sectionGap}px`);  // 新增
article.style.setProperty("--item-gap", `${ss.itemGap}px`);        // 新增
```

`originalStyle` 保存/恢复机制不变（getAttribute("style") + setAttribute("style", ...) 已经覆盖 CSS 变量）。

**Step 2: 闸门**
- [ ] `pnpm test smart-layout` PASS
- [ ] `pnpm tsc --noEmit` PASS

**Step 3: Commit**
```bash
git add lib/smart-layout.ts hooks/use-smart-layout.ts tests/unit/smart-layout.test.ts
git commit -m "feat(smart-layout): extend algorithm to 5 dimensions + lower MIN bounds"
```

---

## 切片 3：渲染层联动

### Task 3.1: `ResumePage` 注入 CSS 变量

**Files:** `lib/templates/shared/resume-page.tsx`

**Step 1: articleStyle 加两个 CSS 变量**

```ts
const articleStyle: React.CSSProperties = {
  ...style,
  fontSize: `${ss.fontSize}px`,
  lineHeight: ss.lineHeight,
  padding: `${ss.pagePadding}px`,
  fontFamily: FONT_MAP[fontKey].css,
  backgroundColor: decoration?.pageBgColor ?? "#ffffff",
  color: "#000000",
  ["--section-gap" as string]: `${ss.sectionGap}px`,  // 新增
  ["--item-gap" as string]: `${ss.itemGap}px`,        // 新增
};
```

### Task 3.2: `ResumeSection` 把 mt-X 改成 var

**Files:** `lib/templates/shared/resume-section.tsx`

各 variant 的 `mt-3 / mt-3.5 / mt-4` className 移除，改成 `style={{ marginTop: 'var(--section-gap, 16px)' }}`。fallback 保留原数值（mt-3=12px / mt-3.5=14px / mt-4=16px），保证默认视觉不变。

⚠️ 注意：所有 variant 同时改成 var(--section-gap)，**意味着 default 16 会让 mt-3 / mt-3.5 的 variant 视觉略有变化**——这是 spec §2 第 3 点目标"算法压缩对所有模板物理生效"的代价。如果 default=16 在 mt-3 variant 上视觉不可接受，回退方案：每个 variant 用不同 fallback（mt-3 → `var(--section-gap, 12px)`），但用户调 sectionGap 时 5 个模板表现一致。**先按统一 fallback=16 做，跑视觉冒烟看效果再决定**。

类似的 item gap 在 ResumeSection 内部的 entry 之间间距也要改。检查 `space-y-X` 类，找到 entry container 的 vertical spacing 改成 `style={{ rowGap: 'var(--item-gap)' }}` 或类似。

### Task 3.3: `SlotRenderer` cssVars 加 3 个新变量

**Files:** `lib/templates/uploaded/html-slot-renderer.tsx`

```ts
const cssVars: Record<string, string> = {
  "--font-family": fontFamilyValue(styleSettings.fontFamily),
  "--font-size": `${styleSettings.fontSize}px`,
  "--line-height": String(styleSettings.lineHeight),
  "--page-padding": `${styleSettings.pagePadding}px`,  // 新增
  "--section-gap": `${styleSettings.sectionGap}px`,    // 新增
  "--item-gap": `${styleSettings.itemGap}px`,          // 新增
};
```

**Step 4: 测试**
- [ ] 内置 ResumePage 渲染时 article inline style 含 --section-gap / --item-gap
- [ ] SlotRenderer 输出外层 div style 含 --page-padding / --section-gap / --item-gap

**Step 5: 闸门**
- [ ] `pnpm test` PASS
- [ ] `pnpm tsc --noEmit` PASS

**Step 6: Commit**
```bash
git add lib/templates/shared/resume-page.tsx lib/templates/shared/resume-section.tsx lib/templates/uploaded/html-slot-renderer.tsx tests/unit/
git commit -m "feat(templates): inject CSS variables for section/item gap + page padding"
```

---

## 切片 4：模板侧迁移

### Task 4.1: SKILL.md §4.2 dual-constraint 升级

**Files:** `template-studio-skill/SKILL.md`

把 dual-constraint 第 1 条改成：
- font-size / line-height 必须 `var(--*)`
- **page-level padding 必须 `var(--page-padding)`**
- **section / item gap 必须 `var(--section-gap)` / `var(--item-gap)`**
- 装饰、颜色、圆角、阴影、component-level padding（banner/card 内边距）→ 可硬编码

§4.4 A4 单页约束部分加一句："如果内容多到默认 sectionGap=16 / itemGap=12 装不下，由 smart-layout 算法自动压缩；模板写死硬编码 padding 会让算法压缩物理失效。"

### Task 4.2: DB 现有 2 个模板手工迁移

**Files:** （DB 改动，无文件）

**Step 1: 用 tsx 脚本读取 abbey-blue 当前 customCss**

```bash
pnpm exec tsx --env-file=.env.local -e '
import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq } from "drizzle-orm";
const t = await db.select().from(templates).where(eq(templates.id, "abbey-blue"));
console.log(t[0]?.customCss);
'
```

**Step 2: 在 customCss 里把硬编码 padding/margin 改成 var**

article 顶层 padding → `var(--page-padding)`。section 之间 margin-top → `var(--section-gap)`。entry 之间 margin/padding → `var(--item-gap)`。

**Step 3: UPDATE DB**

```bash
pnpm exec tsx --env-file=.env.local -e '
import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq } from "drizzle-orm";
const newCss = `...修改后的 css...`;
await db.update(templates).set({ customCss: newCss }).where(eq(templates.id, "abbey-blue"));
'
```

crimson-banner 同样处理。

**Step 4: 验证 dev-preview**

- [ ] `pnpm dev`
- [ ] 访问 `/dev-preview/template/abbey-blue`、`/dev-preview/template/crimson-banner`
- [ ] 对比修改前后视觉一致（默认 styleSettings 下）

**Step 5: Commit**
```bash
git add template-studio-skill/SKILL.md
git commit -m "docs(skill): require var(--page-padding/--section-gap/--item-gap) in v2 templates"
```

---

## 切片 5：验证 + 冒烟

### Task 5.1: 跑闸门

- [ ] `pnpm test` 全绿
- [ ] `pnpm tsc --noEmit` 全绿
- [ ] `pnpm lint` 全绿
- [ ] `pnpm build` 全绿

### Task 5.2: 手工冒烟

- [ ] `pnpm dev` 起开发服务器
- [ ] 创建一份内容大的简历（5 工作 + 4 项目 + 完整教育 + 技能 + 总结）
- [ ] 内置模板（professional）下点"整理成一页" → status=optimized
- [ ] 切到 abbey-blue（v2 模板） → 点"整理成一页" → status=optimized
- [ ] 切到 crimson-banner（v2 模板） → 点"整理成一页" → status=optimized
- [ ] 不点智能排版时各模板视觉与本期前一致（截图对比）

### Task 5.3: 报告 + 等 zoo 拍板合并

合并到 main 由 zoo 测试后授权（按 AGENTS.md §7 第 16 条）。
