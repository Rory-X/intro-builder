# Skill v2 — HTML 自由排版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Skill v1 enum-based LayoutConfig with HTML/CSS free-painting. Add `customHtml` + `customCss` to templates table; new SlotRenderer parses HTML, replaces `<slot data-bind="...">` with content from ResumeContent; UploadedLayout dispatches to SlotRenderer when customHtml present, falls back to v1 enum path otherwise (backward compatible — abbey/abbey-stub keep working).

**Architecture:** See spec §5 for full data flow. Key boundary: write side (Skill produces HTML/CSS) + render side (SlotRenderer consumes HTML/CSS) are this plan's scope. User-facing surface (`/templates` route, drawer, thumbnails) is the parallel agent's work — completely untouched here.

**Tech Stack:** Existing stack + 2 new deps: `isomorphic-dompurify` (SSR-safe XSS sanitize) + `html-react-parser` (HTML string → React node tree with visitor pattern).

**Spec:** `docs/superpowers/specs/2026-05-27-skill-html-templates.md`

---

## File Structure (locked in)

```
db/
  schema.ts                       # MOD: templates table gains customHtml + customCss columns
  migrations/
    00XX_template_custom_html.sql # NEW: ALTER TABLE add columns

lib/templates/uploaded/
  types.ts                        # MOD: UploadedTemplate Zod gains 2 nullable fields
  UploadedLayout.tsx              # MOD: dispatch to SlotRenderer when customHtml present
  fetch.ts                        # MOD: parseTemplateRow reads 2 new columns
  html-slot-renderer.tsx          # NEW: core renderer (~80-120 lines)
  slot-bindings.ts                # NEW: binding name → ResumeContent accessor (~60 lines)
  css-scope.ts                    # NEW: auto-scope CSS (~40 lines)

prototypes/handcoded-crimson/
  index-with-slots.html           # NEW: PoC retrofit with slot tags

app/dev-preview/template/
  handcoded-crimson/
    page.tsx                      # NEW: dev-only PoC validation route

template-studio-skill/
  SKILL.md                        # MOD: Step 3 rewrite (推断 enum → 写 HTML/CSS)
  scripts/
    insert-template.ts            # MOD: --custom-html / --custom-css file path args

tests/unit/
  html-slot-renderer.test.tsx     # NEW
  css-scope.test.ts               # NEW

package.json                      # MOD: + isomorphic-dompurify + html-react-parser
pnpm-lock.yaml                    # MOD
```

---

## Task 1: Add `customHtml` + `customCss` columns to `templates` table

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/00XX_template_custom_html.sql`

**Pre-flight:**
- [ ] `ls db/migrations/` to find next migration number
- [ ] Read `db/schema.ts` to see templates table location

**Step 1: Add columns in schema.ts**

Add to existing `templates` pgTable definition:

```ts
export const templates = pgTable("templates", {
  // ... existing columns ...
  customHtml: text("customHtml"),  // nullable
  customCss: text("customCss"),    // nullable
});
```

**Step 2: Generate migration**
- [ ] Run: `pnpm drizzle-kit generate`
- [ ] Verify: new SQL file in `db/migrations/`, contains `ALTER TABLE templates ADD COLUMN`

**Step 3: Apply migration**
- [ ] Run: `pnpm exec tsx --env-file=.env.local scripts/apply-templates-migration.ts` (use the existing migration helper for Neon HTTP — drizzle-kit migrate hangs from CN to ap-southeast-1)
- [ ] Verify: `pnpm exec tsx --env-file=.env.local -e 'import {db} from "@/db";import {sql} from "drizzle-orm";const r=await db.execute(sql\`SELECT column_name FROM information_schema.columns WHERE table_name=\${\"templates\"}\`);console.log(r)'` shows the 2 new columns

**Step 4: Type check**
- [ ] `pnpm tsc --noEmit` PASS

**Step 5: Commit**
```bash
git add db/schema.ts db/migrations/
git commit -m "feat(db): add customHtml/customCss columns for Skill v2 HTML templates"
```

---

## Task 2: Extend `UploadedTemplate` Zod schema

**Files:**
- Modify: `lib/templates/uploaded/types.ts`

**Step 1: Add 2 nullable string fields**

```ts
export const UploadedTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  decoration: DecorationConfig.nullable(),
  layout: LayoutConfig,                    // v1 path still required
  customHtml: z.string().nullable(),       // NEW
  customCss: z.string().nullable(),        // NEW
});
```

**Step 2: Test schema accepts both v1 (customHtml=null) and v2 (customHtml present) shapes**

Add to `tests/unit/templates-uploaded-types.test.ts` (create if not exists):

```ts
it("UploadedTemplate accepts v1 shape with customHtml=null", () => {
  expect(UploadedTemplate.safeParse({ ..., customHtml: null, customCss: null }).success).toBe(true);
});
it("UploadedTemplate accepts v2 shape with customHtml present", () => {
  expect(UploadedTemplate.safeParse({ ..., customHtml: "<article>...</article>", customCss: ".foo {}" }).success).toBe(true);
});
```

**Step 3: Commit**
```bash
git add lib/templates/uploaded/types.ts tests/unit/templates-uploaded-types.test.ts
git commit -m "feat(templates): extend UploadedTemplate Zod with customHtml/customCss"
```

---

## Task 3: Add deps + `fetch.ts` reads new columns

**Files:**
- Modify: `package.json` + `pnpm-lock.yaml`
- Modify: `lib/templates/uploaded/fetch.ts`

**Step 1: Install**
- [ ] `pnpm add isomorphic-dompurify html-react-parser`
- [ ] Verify both appear in `package.json` dependencies

**Step 2: Update parseTemplateRow**

`lib/templates/uploaded/fetch.ts:103-123` — `parseTemplateRow` constructs the candidate object. Add the 2 new fields:

```ts
const candidate = {
  id: row.id,
  name: row.name,
  description: row.description,
  thumbnailUrl: row.thumbnailUrl,
  decoration: row.decoration,
  layout: row.layout,
  customHtml: row.customHtml,    // NEW
  customCss: row.customCss,      // NEW
};
```

**Step 3: Test**
- [ ] `pnpm tsc --noEmit` PASS
- [ ] `pnpm test --run lib/templates/uploaded` PASS (or whatever filter pattern)

**Step 4: Commit**
```bash
git add package.json pnpm-lock.yaml lib/templates/uploaded/fetch.ts
git commit -m "feat(templates): wire customHtml/customCss read path + add dompurify/html-react-parser deps"
```

---

## Task 4: Implement CSS auto-scope util

**Files:**
- Create: `lib/templates/uploaded/css-scope.ts`
- Create: `tests/unit/css-scope.test.ts`

**Step 1: Write the util**

`lib/templates/uploaded/css-scope.ts` (~40 lines):

```ts
/**
 * Prepend [data-template-id="<id>"] to every selector in `css`.
 * Simple string-based — handles 80% of cases (top-level rules).
 * 
 * Bails on @media / @keyframes / @supports for now — throws so the
 * Skill knows to rewrite. v2 implementation can use PostCSS if needed.
 */
export function scopeCss(css: string, templateId: string): string {
  const scope = `[data-template-id="${templateId}"]`;
  // 1. detect at-rules (@media / @keyframes / @supports / @import) — throw
  if (/@(media|keyframes|supports|import)/i.test(css)) {
    throw new Error("scopeCss: @media/@keyframes/@supports/@import not supported in v1");
  }
  // 2. forbid universal / element-only selectors at top level
  // (heuristic: bare `body { ... }` or `* { ... }` outside a class chain)
  // ...
  // 3. transform `selector { ... }` → `[scope] selector { ... }`
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectors, body) => {
    const scoped = selectors
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => `${scope} ${s}`)
      .join(", ");
    return `${scoped} { ${body.trim()} }`;
  });
}
```

**Step 2: Test cases**

`tests/unit/css-scope.test.ts`:

```ts
it("prepends scope to single selector", () => {
  expect(scopeCss(".foo { color: red }", "tpl1"))
    .toBe(`[data-template-id="tpl1"] .foo { color: red }`);
});
it("handles multi-selector comma list", () => {
  expect(scopeCss(".a, .b { color: red }", "tpl1"))
    .toBe(`[data-template-id="tpl1"] .a, [data-template-id="tpl1"] .b { color: red }`);
});
it("throws on @media", () => {
  expect(() => scopeCss("@media (min-width: 600px) { .foo {} }", "tpl1")).toThrow();
});
it("preserves CSS variables in body", () => {
  expect(scopeCss(".foo { font-size: var(--font-size) }", "tpl1"))
    .toContain("var(--font-size)");
});
```

**Step 3: Run tests**
- [ ] `pnpm test --run css-scope` PASS

**Step 4: Commit**
```bash
git add lib/templates/uploaded/css-scope.ts tests/unit/css-scope.test.ts
git commit -m "feat(templates): add CSS auto-scope util for Skill v2"
```

---

## Task 5: Implement slot bindings registry

**Files:**
- Create: `lib/templates/uploaded/slot-bindings.ts`

**Step 1: Define the binding registry**

```ts
// lib/templates/uploaded/slot-bindings.ts
import type { ResumeContent } from "@/lib/resume-schema";

/**
 * Map a binding name (e.g. "basics.name") to its renderer function.
 * Renderer takes the resume content + current iteration context, returns React node.
 *
 * Iteration context tracks loop state: when inside <slot data-bind="sectionOrder">,
 * "section.title" resolves to the current section being iterated.
 */
export type IterationContext = {
  section?: { id: string; title: string; items: unknown[] };
  item?: { /* current item */ };
};

export const SLOT_BINDINGS = {
  "basics.name": (c, _ctx) => c.basics?.name ?? "",
  "basics.title": (c, _ctx) => c.basics?.title ?? "",
  "basics.email": (c, _ctx) => c.basics?.email ?? "",
  "basics.phone": (c, _ctx) => c.basics?.phone ?? "",
  // ... full list per spec §4.3 ...
  
  // Iteration markers — handled specially (loop slot, not value slot)
  "sectionOrder": "loop",
  "section.items": "loop",
  
  // Iteration values — only valid inside corresponding loop
  "section.title": (c, ctx) => ctx.section?.title ?? "",
  "item.header.title": (c, ctx) => ctx.item?.header?.title ?? "",
  // ...
} as const;

export type BindingName = keyof typeof SLOT_BINDINGS;

export function isValidBinding(name: string): name is BindingName {
  return name in SLOT_BINDINGS;
}
```

**Step 2: Commit**
```bash
git add lib/templates/uploaded/slot-bindings.ts
git commit -m "feat(templates): add slot binding registry for Skill v2"
```

---

## Task 6: Implement `<SlotRenderer>` core (heaviest task)

**Files:**
- Create: `lib/templates/uploaded/html-slot-renderer.tsx`
- Create: `tests/unit/html-slot-renderer.test.tsx`

**Step 1: Implement renderer**

`lib/templates/uploaded/html-slot-renderer.tsx` (~80-120 lines):

Outline:

```tsx
"use client";  // or server-safe — verify

import DOMPurify from "isomorphic-dompurify";
import parse, { domToReact, Element } from "html-react-parser";
import { SLOT_BINDINGS, isValidBinding, type IterationContext } from "./slot-bindings";
import { scopeCss } from "./css-scope";
import { RichTextRenderer } from "@/components/preview/rich-text-renderer";

const SAFE_TAGS = ["article","header","main","section","div","span","p","h1","h2","h3","h4","h5","h6","ul","ol","li","strong","em","a","img","time","template","slot","figure","figcaption"];
const SAFE_ATTRS = ["class","id","data-bind","data-template","src","alt","href","title"];

export function SlotRenderer({ html, css, content, styleSettings, decoration, templateId }: SlotRendererProps) {
  // 1. Sanitize HTML
  const cleanHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: SAFE_TAGS,
    ALLOWED_ATTR: SAFE_ATTRS,
    KEEP_CONTENT: false,
  });
  
  // 2. Scope CSS
  const scopedCss = css ? scopeCss(css, templateId) : "";
  
  // 3. Extract <template> definitions for loop slots
  const templates = extractTemplates(cleanHtml);  // Map<id, html>
  
  // 4. Parse main HTML, walking nodes; replace <slot> elements
  const cssVars = computeCssVars(styleSettings);
  const reactTree = parse(cleanHtml, {
    replace: (node) => transformSlot(node, content, templates, /* iteration ctx */ {}),
  });
  
  return (
    <div data-template-id={templateId} style={cssVars}>
      <style dangerouslySetInnerHTML={{ __html: scopedCss }} />
      {reactTree}
    </div>
  );
}

function transformSlot(node, content, templates, ctx) {
  if (!(node instanceof Element)) return undefined;
  if (node.name !== "slot") return undefined;
  
  const binding = node.attribs?.["data-bind"];
  const templateId = node.attribs?.["data-template"];
  
  if (!binding || !isValidBinding(binding)) {
    return <span style={{ color: "red" }}>[未知 slot: {binding}]</span>;
  }
  
  const handler = SLOT_BINDINGS[binding];
  if (handler === "loop") {
    return renderLoop(binding, content, templates, templateId, ctx);
  }
  
  // value slot
  const value = handler(content, ctx);
  
  // bullets / rich-text fields → RichTextRenderer
  if (binding === "item.bullets") return <RichTextRenderer doc={value} />;
  
  return <>{value}</>;
}

// renderLoop: clone the referenced <template> for each iteration item
// computeCssVars: { "--font-family": ..., "--font-size": ..., "--line-height": ... }
// extractTemplates: parse out <template id="..."> definitions
```

**Step 2: Tests**

`tests/unit/html-slot-renderer.test.tsx`:

```tsx
it("replaces <slot data-bind='basics.name'> with content.basics.name", () => {
  const { container } = render(<SlotRenderer 
    html='<article><h1><slot data-bind="basics.name" /></h1></article>'
    css={null} content={{ basics: { name: "张三" } }} 
    styleSettings={DEFAULT} decoration={null} templateId="t1" />);
  expect(container.querySelector("h1")?.textContent).toBe("张三");
});

it("loops sectionOrder", () => {
  const html = `<article>
    <slot data-bind="sectionOrder" data-template="sec" />
  </article>
  <template id="sec"><h2><slot data-bind="section.title" /></h2></template>`;
  const { container } = render(<SlotRenderer ... />);
  expect(container.querySelectorAll("h2")).toHaveLength(/* sectionOrder.length */);
});

it("renders [未知 slot] for invalid binding", () => {
  const { container } = render(<SlotRenderer 
    html='<article><slot data-bind="experience.foobar" /></article>' 
    ... />);
  expect(container.textContent).toContain("[未知 slot: experience.foobar]");
});

it("strips <script> via DOMPurify", () => {
  const { container } = render(<SlotRenderer 
    html='<article><script>alert(1)</script><slot data-bind="basics.name"/></article>'
    ... />);
  expect(container.querySelector("script")).toBeNull();
});

it("injects styleSettings as CSS variables", () => {
  const { container } = render(<SlotRenderer 
    styleSettings={{ fontFamily: "serif", fontSize: 14, lineHeight: 1.6 }}
    ... />);
  const root = container.querySelector("[data-template-id]") as HTMLElement;
  expect(root.style.getPropertyValue("--font-size")).toBe("14px");
});
```

**Step 3: Run tests + tsc**
- [ ] `pnpm test --run html-slot-renderer` PASS
- [ ] `pnpm tsc --noEmit` PASS

**Step 4: Commit**
```bash
git add lib/templates/uploaded/html-slot-renderer.tsx tests/unit/html-slot-renderer.test.tsx
git commit -m "feat(templates): implement SlotRenderer for Skill v2 HTML templates"
```

---

## Task 7: Convert handcoded-crimson PoC to slot HTML

**Files:**
- Create: `prototypes/handcoded-crimson/index-with-slots.html`

**Step 1: Read original PoC**
- [ ] `Read prototypes/handcoded-crimson/index.html` (250 lines)

**Step 2: Replace hardcoded content with slot tags**

Pattern: every place that says "陈媛媛 Abbey" / "字节跳动" / "138-0000-0000" / 等 → corresponding `<slot data-bind="...">`.

The structure becomes:

```html
<article class="crimson-banner">
  <header class="banner">
    <img src="<decoration-img>" alt="banner" class="banner-bg" />
    <div class="banner-content">
      <h1><slot data-bind="basics.name" /></h1>
      <p class="contact">
        <slot data-bind="basics.phone" /> · 
        <slot data-bind="basics.email" />
      </p>
    </div>
  </header>
  
  <main>
    <slot data-bind="sectionOrder" data-template="section-tpl" />
  </main>
</article>

<template id="section-tpl">
  <section class="crimson-card">
    <h2 class="section-title"><slot data-bind="section.title" /></h2>
    <slot data-bind="section.items" data-template="item-tpl" />
  </section>
</template>

<template id="item-tpl">
  <div class="crimson-item">
    <div class="item-header">
      <strong><slot data-bind="item.header.title" /></strong>
      <span class="date"><slot data-bind="item.header.dateRange" /></span>
    </div>
    <slot data-bind="item.bullets" />
  </div>
</template>
```

**Step 3: CSS adjustments** — change hardcoded font-size / font-family / line-height to CSS variables:

```css
.crimson-banner {
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: var(--line-height);
}
```

Other CSS (colors, padding, margins, decorations) stay hardcoded per dual constraint (§4.2).

**Step 4: Commit**
```bash
git add prototypes/handcoded-crimson/index-with-slots.html
git commit -m "feat(prototypes): retrofit crimson PoC with slot tags"
```

---

## Task 8: Add dev-preview route to validate PoC

**Files:**
- Create: `app/dev-preview/template/handcoded-crimson/page.tsx`

**Step 1: Read existing dev-preview pattern**
- [ ] `ls app/dev-preview/template/` to see existing routes (e9c21b9 added one)
- [ ] Read pattern, follow same convention

**Step 2: Implement page**

```tsx
// app/dev-preview/template/handcoded-crimson/page.tsx
import { readFileSync } from "node:fs";
import path from "node:path";
import { SlotRenderer } from "@/lib/templates/uploaded/html-slot-renderer";
import { DEMO_RESUME } from "@/lib/demo-resume";
import { DEFAULT_STYLE_SETTINGS } from "@/lib/style-presets";

export const dynamic = "force-dynamic";

export default function CrimsonPocPreview() {
  // Read file at runtime (dev-only) — split HTML and CSS sections
  const filePath = path.join(process.cwd(), "prototypes/handcoded-crimson/index-with-slots.html");
  const fileContent = readFileSync(filePath, "utf-8");
  const { html, css } = splitHtmlCss(fileContent);  // helper: extract <style> contents
  
  return (
    <div className="mx-auto max-w-[800px] my-8">
      <SlotRenderer
        html={html}
        css={css}
        content={DEMO_RESUME}
        styleSettings={DEFAULT_STYLE_SETTINGS}
        decoration={null}
        templateId="handcoded-crimson"
      />
    </div>
  );
}

function splitHtmlCss(fileContent) {
  // Extract <style>...</style> contents into css; rest stays as html
  const styleMatch = fileContent.match(/<style>([\s\S]*?)<\/style>/);
  const css = styleMatch?.[1] ?? null;
  const html = fileContent.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<!DOCTYPE html>|<\/?html.*?>|<head>[\s\S]*?<\/head>|<\/?body.*?>/g, "").trim();
  return { html, css };
}
```

**Step 3: Browser test**
- [ ] `pnpm dev` (if not running)
- [ ] Open `http://localhost:3000/dev-preview/template/handcoded-crimson`
- [ ] Compare visually to `docs/handcoded-crimson-banner-png-v4.png`
- [ ] Acceptance: ≥ 90% visual match

**Step 4: Test sectionOrder reordering**
- [ ] Modify DEMO_RESUME or create a test resume with custom sectionOrder
- [ ] Verify section order in render matches sectionOrder

**Step 5: Test styleSettings injection**
- [ ] Pass different fontSize/fontFamily/lineHeight to SlotRenderer
- [ ] Verify visual changes in browser

**Step 6: Commit**
```bash
git add app/dev-preview/template/handcoded-crimson/
git commit -m "feat(dev): add crimson PoC preview route — Skill v2 PoC validation"
```

---

## Task 9: Wire `<UploadedLayout>` dispatch

**Files:**
- Modify: `lib/templates/uploaded/UploadedLayout.tsx`

**Step 1: Read current UploadedLayout**
- [ ] Read `lib/templates/uploaded/UploadedLayout.tsx`

**Step 2: Add dispatch branch at top**

```tsx
export function UploadedLayout({ template, content, sectionOrder, styleSettings }) {
  if (template.customHtml) {
    return (
      <SlotRenderer
        html={template.customHtml}
        css={template.customCss}
        content={content}
        styleSettings={styleSettings}
        decoration={template.decoration}
        templateId={template.id}
      />
    );
  }
  // EXISTING v1 enum-based rendering — unchanged below
  return /* existing impl */;
}
```

**Step 3: Test backward compatibility**
- [ ] `pnpm test --run uploaded-layout` PASS (abbey/abbey-stub paths unchanged)
- [ ] Browser: open dashboard, abbey thumbnail still renders correctly

**Step 4: Commit**
```bash
git add lib/templates/uploaded/UploadedLayout.tsx
git commit -m "feat(templates): UploadedLayout dispatches to SlotRenderer when customHtml present"
```

---

## Task 10: Update SKILL.md + insert-template.ts

**Files:**
- Modify: `template-studio-skill/SKILL.md`
- Modify: `template-studio-skill/scripts/insert-template.ts`

**Step 1: SKILL.md Step 3 rewrite**

Replace current Step 3 (推断 LayoutConfig) with:

```markdown
### Step 3：看参考图，写 HTML + CSS

不再推断 enum 配置。直接看图写 HTML + CSS，遵守两条规则：

#### 3.1 对偶约束（用户能调的属性必须 CSS 变量）

| 用户能调？ | 写法 |
|---|---|
| ✅ font-size / font-family / line-height | **必须 var(--font-size) / var(--font-family) / var(--line-height)** |
| ❌ color / padding / margin / border-radius / shadow / decoration | 可硬编码 |

写完后跑自检：
```bash
grep -E "font-(size|family)|line-height" customCss.css | grep -v "var("
```
非空则说明硬编码了用户该能调的属性，**重写**。

#### 3.2 Slot 契约（带 slot 的 HTML 模板）

合法 binding 名：
- `basics.name` / `basics.title` / `basics.email` / `basics.phone` / `basics.location` / `basics.url` / `basics.avatar`
- `sectionOrder` 循环 + `section.title` / `section.items`
- `item.header.{title,subtitle,dateRange,location}` + `item.bullets`

参考完整示例：`prototypes/handcoded-crimson/index-with-slots.html`。

#### 3.3 安全约束

- 禁止 inline `<script>` / `on*` 属性 / `<iframe>`
- 禁止 `position: fixed` / `position: sticky`
- 禁止 universal selector（`* { ... }`）和 element-only selector（`body { ... }`）
- 禁止 `@media` / `@keyframes` / `@supports`（v1 实现暂不支持）
```

**Step 2: insert-template.ts add args**

Add `--custom-html <path>` and `--custom-css <path>` flags. Read file contents into the INSERT.

**Step 3: Smoke test**
- [ ] `pnpm exec tsx --env-file=.env.local template-studio-skill/scripts/insert-template.ts --id test-v2 --name "Test v2" --custom-html prototypes/handcoded-crimson/index-with-slots.html --custom-css /dev/null`
- [ ] Verify in DB: `SELECT id, customHtml IS NOT NULL FROM templates WHERE id='test-v2';`
- [ ] Then DELETE the test row

**Step 4: Commit**
```bash
git add template-studio-skill/
git commit -m "feat(skill): rewrite SKILL.md Step 3 + insert-template.ts for HTML/CSS path"
```

---

## Task 11: 端到端 Skill v2 实跑验证

**Files:**
- 不创建新源码文件，只产出 DB 一行新模板 + 验收日志

**Pre-flight:**
- [ ] Task 1-10 全部 commit 完毕
- [ ] dev server 跑着（`pnpm dev`），dashboard 能开
- [ ] 准备一张干净的参考简历图（PNG/PDF），位于 `docs/test-samples/` 下，不含原模特真实姓名/照片（避免 crimson-banner 那次的版权坑）

**Step 1: 端到端跑 Skill v2**
- [ ] 在 Claude Code 起新对话："把 `docs/test-samples/<your-image>.png` 做成模板，id=`v2-smoke-test`"
- [ ] Skill 应按新 SKILL.md 的 Step 3：看图直接写 HTML+CSS（不再推断 enum）
- [ ] 验证 Skill 输出的 customCss 通过 `grep -E "font-(size|family)|line-height" | grep -v "var("` 自检（应为空）
- [ ] `insert-template.ts` 写入 DB，`status='draft'`

**Step 2: 浏览器验证**
- [ ] 在 DB 手动 promote 到 `published`（一行 SQL）
- [ ] 打开 dashboard，新模板缩略图出现
- [ ] 编辑器 picker 选用新模板，预览渲染正常
- [ ] 拖动 sectionOrder → 渲染响应
- [ ] 改 styleSettings 的字体/字号/行距 → 渲染响应
- [ ] 富文本加粗/标红/链接 → 在新模板里正常渲染
- [ ] PDF 导出与预览一致

**Step 3: 回归验证**
- [ ] abbey 模板 / abbey-stub 模板 / 内置 3 套模板渲染未回归
- [ ] `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` 全绿

**Step 4: 清理或保留**
- [ ] 决定 `v2-smoke-test` 模板是保留为示范模板还是删除
- [ ] 保留则留 `status=published`；删除则跑 `pnpm exec tsx --env-file=.env.local scripts/rollback-crimson.ts <id>`

**Step 5: Commit（如保留模板）**
```bash
# 仅当 v2-smoke-test 保留时
git add docs/test-samples/<your-image>.png  # 参考图
git commit -m "feat(templates): add Skill v2 e2e smoke test template"
```

如果不保留模板，Task 11 不产生 commit，仅在 PR 描述里附验收截图。

---

## Definition of Done

The plan is **done** when ALL of the following are true:

- ✅ All 10 tasks committed
- ✅ `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` all pass
- ✅ `prototypes/handcoded-crimson/index-with-slots.html` renders at `/dev-preview/template/handcoded-crimson` with ≥ 90% visual match to `docs/handcoded-crimson-banner-png-v4.png`
- ✅ User editing sectionOrder / styleSettings → SlotRenderer reflects changes
- ✅ TipTap rich-text marks render correctly inside slots
- ✅ Existing abbey / abbey-stub / professional / classic / modern templates render unchanged (no regression)
- ✅ Task 11 端到端 Skill v2 实跑验证全部 PASS
- ✅ commit 完留在 feature/template-studio-foundation 分支
- ✅ 等待用户决定何时合并到 main（不主动 push / merge / 开 PR）

After merge, the **next plan** picks up:

1. **Plan v2.x.1:** SKILL.md prompt engineering iteration based on real Skill v2 invocations (likely needs adjustments to the prompt for AI to consistently follow dual constraint)
2. **Plan v2.x.2:** Browser-based template editor for runtime tweaks (not in scope here)
3. **Plan v2.x.3:** PostCSS-based CSS scope upgrade if @media/@keyframes use cases emerge

---

## Risks & Pre-mitigations (carried from spec §9)

- **R1 (Claude writes wrong slot name):** Renderer's `[未知 slot: <name>]` fallback is loud and visible — error surfaces immediately during PoC validation (Task 8). SKILL.md ships a complete binding name table.
- **R2 (Claude hardcodes font-size violating dual constraint):** Task 10 ships a grep-based self-check command in SKILL.md. Future enhancement: pre-INSERT validation in `insert-template.ts` rejects writes that fail the grep.
- **R3 (rich-text marks conflict with template's strong/em styles):** Task 6 wraps RichTextRenderer in `isolation: isolate` div. Verify in Task 8 PoC validation with bold/italic in bullets.
- **R5 (CSS auto-scope simple regex breaks on @rules):** Task 4 css-scope.ts throws explicitly on @media/@keyframes/@supports — Skill sees error, adjusts. Future: PostCSS upgrade.
- **R6 (Claude writes universal selector polluting main app):** Task 4 should also detect & reject `*` and bare element selectors — add to css-scope.ts.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Same-session sequential** (this session) — execute Tasks 1-10 in order, review between each task.
2. **Parallel agent batch** — open new session with `superpowers/executing-plans`, batch execution with checkpoints. Recommended only after Task 6 (SlotRenderer) is reviewed manually — that's the architectural keystone.

**Recommended sequence given current branch state:**

- Task 1-3 first (DB + types + deps) — small commits, foundation
- Task 4-5 next (CSS scope + bindings) — leaf utils, easy review
- **Task 6 (SlotRenderer) — pause for review here**, this is architecturally critical
- Task 7-8 (PoC retrofit + dev preview) — validation
- Task 9-10 (UploadedLayout dispatch + Skill update) — wiring final

**Which approach?**
