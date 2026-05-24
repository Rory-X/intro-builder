# Template Studio Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the template-studio foundation so DB-stored templates can be selected and rendered alongside the 3 built-in React templates, with one hand-seeded sample template proving the end-to-end path.

**Architecture:** Add a `templates` Drizzle table that stores `decoration` (background image config) + `layout` (variant choices + theme + section icons) as `jsonb`. A new `<UploadedLayout>` React component is the single shared renderer for all DB templates — it composes existing shared primitives (`<ResumePage>`, `<ResumeHeader>`, section variants) parameterized by the DB row. `<ResumePage>` gains an optional `decoration` prop that absolute-positions a background image. Template registry is split: built-in templates remain typed const exports, DB templates are queried via a new async lookup that merges results. Dashboard / editor / actions all consume the merged list.

**Tech Stack:** Existing stack — Drizzle ORM · Postgres jsonb · React 19 · Tailwind v4 · Vitest + Testing Library · Vercel Blob (for thumbnails, not introduced this plan).

**Spec:** `docs/superpowers/specs/2026-05-24-template-studio-skill.md`

---

## File Structure (locked in)

```
db/
  schema.ts                       # MOD: add templates table
  migrations/
    XXXX_templates.sql            # NEW: create templates table + indexes
lib/templates/
  types.ts                        # MOD: TemplateId → string, BuiltinTemplateId stays literal union
  registry.ts                     # MOD: getTemplateMetaAsync merges built-in + DB
  uploaded/
    UploadedLayout.tsx            # NEW: shared renderer for all DB templates
    types.ts                      # NEW: DecorationConfig + LayoutConfig + UploadedTemplate
    fetch.ts                      # NEW: server-side DB lookup
  shared/
    resume-page.tsx               # MOD: add `decoration` prop
app/(app)/
  dashboard/
    page.tsx                      # MOD: merge built-in + DB templates in list
    actions.ts                    # MOD: createResume validates DB template ids
  resume/[id]/edit/
    actions.ts                    # MOD: saveResume validates DB template ids
    editor-client.tsx             # MOD: pass merged templates to selector
components/editor/
  style-editor.tsx                # MOD: render DB templates in selector
tests/unit/
  templates-uploaded-layout.test.tsx  # NEW
  templates-registry-merge.test.ts    # NEW
  templates-resume-page-decoration.test.tsx  # NEW
  resume-schema.test.ts           # MOD: TemplateId now string, default unchanged
db/seed/
  template-abbey-stub.ts          # NEW: hand-seeded sample for end-to-end verification
```

---

## Task 1: Add `templates` DB schema

**Files:**

- Create: `db/migrations/XXXX_templates.sql` (number depends on existing migrations)
- Modify: `db/schema.ts`
- Test: `tests/unit/db-schema.test.ts` (extend if exists, otherwise create)

**Pre-flight check:**

- [ ] `ls db/migrations/` to see next migration number
- [ ] Read `db/schema.ts` to confirm Drizzle column helpers in use

**Step 1: Define the table in `db/schema.ts`**

Add after existing tables:

```ts
export const templates = pgTable("templates", {
  id: text("id").primaryKey(),                 // 'abbey-elegant', 'cyber-001', ...
  name: text("name").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  source: text("source").notNull(),            // 'builtin' | 'uploaded'
  decoration: jsonb("decoration"),
  layout: jsonb("layout").notNull(),
  status: text("status").notNull().default("draft"),  // 'draft' | 'published'
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DbTemplate = typeof templates.$inferSelect;
export type NewDbTemplate = typeof templates.$inferInsert;
```

**Step 2: Generate migration**

- [ ] Run: `pnpm drizzle-kit generate`
- [ ] Confirm a new SQL file was created in `db/migrations/`
- [ ] Inspect it: should have `CREATE TABLE templates ...` + index on `status`

**Step 3: Apply migration locally**

- [ ] Run: `pnpm drizzle-kit migrate` (or your project's apply command)
- [ ] Verify with: `psql $DATABASE_URL -c "\d templates"` shows the table

**Step 4: Type check**

- [ ] Run: `pnpm tsc --noEmit`
- [ ] Expected: PASS

**Step 5: Commit**

```bash
git add db/schema.ts db/migrations/
git commit -m "feat(db): add templates table for DB-stored resume templates"
```

---

## Task 2: Loosen `TemplateId` type to allow DB ids

**Files:**

- Modify: `lib/templates/types.ts:3-4`
- Modify: `lib/templates/registry.ts` (only `resolveTemplateId` signature)
- Test: `tests/unit/resume-schema.test.ts` (ensure default fallback still works)

**Step 1: Read current state**

- [ ] Read `lib/templates/types.ts` to confirm TEMPLATE_IDS is the only literal-union choke point

**Step 2: Write the failing test**

Add to `tests/unit/resume-schema.test.ts` (or new file `tests/unit/templates-types.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { resolveTemplateId, BUILTIN_TEMPLATE_IDS, DEFAULT_TEMPLATE_ID } from "@/lib/templates/registry";

describe("resolveTemplateId", () => {
  it("returns the id unchanged for any built-in", () => {
    for (const id of BUILTIN_TEMPLATE_IDS) {
      expect(resolveTemplateId(id)).toBe(id);
    }
  });
  it("returns the id unchanged for unknown ids (DB lookup happens later)", () => {
    expect(resolveTemplateId("uploaded-abbey-001")).toBe("uploaded-abbey-001");
  });
  it("falls back to default for null/undefined", () => {
    expect(resolveTemplateId(null)).toBe(DEFAULT_TEMPLATE_ID);
    expect(resolveTemplateId(undefined)).toBe(DEFAULT_TEMPLATE_ID);
  });
});
```

**Step 3: Run test to verify it fails**

- [ ] Run: `pnpm test templates-types -- --run`
- [ ] Expected: FAIL — `resolveTemplateId('uploaded-abbey-001')` currently returns DEFAULT_TEMPLATE_ID

**Step 4: Update types**

In `lib/templates/types.ts`:

```ts
import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";

export const BUILTIN_TEMPLATE_IDS = ["professional", "classic", "modern"] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];
/** Either a built-in id or a DB-uploaded template id. Runtime validates DB existence. */
export type TemplateId = string;

export const DEFAULT_TEMPLATE_ID: BuiltinTemplateId = "professional";

export type TemplateLayoutProps = {
  content: ResumeContent;
  sectionOrder?: string[];
  styleSettings?: StyleSettings;
  showEmptyPlaceholders?: boolean;
};

// Backward-compat alias for code that previously imported TEMPLATE_IDS
export const TEMPLATE_IDS = BUILTIN_TEMPLATE_IDS;
```

In `lib/templates/registry.ts`, update `resolveTemplateId`:

```ts
export function resolveTemplateId(id: string | null | undefined): TemplateId {
  if (id == null || id === "") return DEFAULT_TEMPLATE_ID;
  return id;  // accept any string — built-in lookup or DB lookup happens later
}
```

Re-export `BUILTIN_TEMPLATE_IDS` from registry for tests.

**Step 5: Run test to verify it passes**

- [ ] Run: `pnpm test templates-types -- --run`
- [ ] Expected: PASS

**Step 6: Type check + lint full project**

- [ ] Run: `pnpm tsc --noEmit`
- [ ] Run: `pnpm lint`
- [ ] Fix any TypeScript errors that surface from old `TemplateId` literal-union usages (e.g. switch exhaustiveness)
- [ ] Expected: both PASS

**Step 7: Commit**

```bash
git add lib/templates/ tests/unit/
git commit -m "feat(templates): loosen TemplateId to string to allow DB-stored templates"
```

---

## Task 3: Add `decoration` prop to `<ResumePage>`

**Files:**

- Modify: `lib/templates/shared/resume-page.tsx`
- Test: `tests/unit/templates-resume-page-decoration.test.tsx` (new)

**Step 1: Define `DecorationConfig` type**

Create `lib/templates/uploaded/types.ts`:

```ts
export type DecorationConfig = {
  bgImageUrl: string;
  placement: {
    position: "absolute";
    top: string;
    right: string;
    width: string;
    height: string;
    zIndex: number;
    opacity: number;
  };
  pageBgColor?: string;
};

// LayoutConfig + UploadedTemplate types added in Task 4
```

**Step 2: Write the failing test**

`tests/unit/templates-resume-page-decoration.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ResumePage } from "@/lib/templates/shared/resume-page";

describe("ResumePage decoration", () => {
  it("renders no decoration img when prop is undefined (backward compat)", () => {
    const { container } = render(
      <ResumePage>
        <div>content</div>
      </ResumePage>
    );
    expect(container.querySelector("img[data-template-decoration]")).toBeNull();
  });

  it("renders an absolute-positioned img when decoration is provided", () => {
    const { container } = render(
      <ResumePage
        decoration={{
          bgImageUrl: "https://example.com/abbey-bg.png",
          placement: {
            position: "absolute",
            top: "0",
            right: "0",
            width: "40%",
            height: "auto",
            zIndex: 0,
            opacity: 1,
          },
        }}
      >
        <div>content</div>
      </ResumePage>
    );
    const img = container.querySelector("img[data-template-decoration]") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://example.com/abbey-bg.png");
    expect(img.style.position).toBe("absolute");
    expect(img.style.right).toBe("0px");
  });

  it("applies pageBgColor to the article background when provided", () => {
    const { container } = render(
      <ResumePage
        decoration={{
          bgImageUrl: "x",
          placement: { position: "absolute", top: "0", right: "0", width: "0", height: "0", zIndex: 0, opacity: 1 },
          pageBgColor: "#eef3f6",
        }}
      >
        <div />
      </ResumePage>
    );
    const article = container.querySelector("article")!;
    expect(article.style.backgroundColor).toBe("rgb(238, 243, 246)");
  });
});
```

**Step 3: Run test to verify it fails**

- [ ] Run: `pnpm test resume-page-decoration -- --run`
- [ ] Expected: FAIL — `decoration` prop not accepted

**Step 4: Modify `ResumePage`**

```tsx
import type { DecorationConfig } from "@/lib/templates/uploaded/types";

type Props = {
  styleSettings?: StyleSettings;
  className?: string;
  maxWidthClass?: string;
  decoration?: DecorationConfig;
  children: React.ReactNode;
};

export function ResumePage({
  styleSettings,
  className,
  maxWidthClass = "max-w-[800px]",
  decoration,
  children,
}: Props) {
  const ss = mergeStyleSettings(styleSettings);

  return (
    <article
      className={cn("relative mx-auto", maxWidthClass, className)}
      style={{
        fontSize: `${ss.fontSize}px`,
        lineHeight: ss.lineHeight,
        padding: `${ss.pagePadding}px`,
        fontFamily: FONT_MAP[ss.fontFamily].css,
        backgroundColor: decoration?.pageBgColor ?? "#ffffff",
        color: "#000000",
      }}
    >
      {decoration?.bgImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-template-decoration
          src={decoration.bgImageUrl}
          alt=""
          aria-hidden
          className="pointer-events-none"
          style={{
            position: decoration.placement.position,
            top: decoration.placement.top,
            right: decoration.placement.right,
            width: decoration.placement.width,
            height: decoration.placement.height,
            zIndex: decoration.placement.zIndex,
            opacity: decoration.placement.opacity,
          }}
        />
      )}
      <div className="relative" style={{ zIndex: 1 }}>
        {children}
      </div>
    </article>
  );
}
```

**Step 5: Run test to verify it passes**

- [ ] Run: `pnpm test resume-page-decoration -- --run`
- [ ] Expected: PASS (3/3)

**Step 6: Verify existing template tests still pass (no regression)**

- [ ] Run: `pnpm test templates -- --run`
- [ ] Expected: ALL PASS

**Step 7: Commit**

```bash
git add lib/templates/shared/resume-page.tsx lib/templates/uploaded/types.ts tests/unit/templates-resume-page-decoration.test.tsx
git commit -m "feat(templates): add decoration prop to ResumePage for DB-stored templates"
```

---

## Task 4: Create `<UploadedLayout>` shared renderer

**Files:**

- Create: `lib/templates/uploaded/UploadedLayout.tsx`
- Modify: `lib/templates/uploaded/types.ts` (add LayoutConfig + UploadedTemplate)
- Test: `tests/unit/templates-uploaded-layout.test.tsx` (new)

**Step 1: Extend types**

`lib/templates/uploaded/types.ts`:

```ts
import type { ResumeHeaderVariant } from "@/lib/templates/shared/resume-header";
import type { ResumeSectionVariant } from "@/lib/templates/shared/resume-section";

// DecorationConfig from Task 3 stays

export type LayoutConfig = {
  headerVariant: ResumeHeaderVariant;
  sectionTitleVariant: ResumeSectionVariant;
  itemHeaderVariant: "professional" | "classic" | "modern";
  theme: {
    primaryColor: string;
    accentColor?: string;
    cardBg?: string;
    cardRadius?: string;
    cardShadow?: string;
    fontFamily?: string;
  };
  sectionIcons: Record<string, string>;  // section key → lucide icon name
};

export type UploadedTemplate = {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  decoration: DecorationConfig | null;
  layout: LayoutConfig;
};
```

**Step 2: Write the failing test**

`tests/unit/templates-uploaded-layout.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { UploadedLayout } from "@/lib/templates/uploaded/UploadedLayout";
import { demoResumeContent } from "@/lib/demo-resume";
import type { UploadedTemplate } from "@/lib/templates/uploaded/types";

const sampleTemplate: UploadedTemplate = {
  id: "test-001",
  name: "Test Template",
  description: null,
  thumbnailUrl: null,
  decoration: {
    bgImageUrl: "https://example.com/bg.png",
    placement: {
      position: "absolute",
      top: "0",
      right: "0",
      width: "40%",
      height: "auto",
      zIndex: 0,
      opacity: 1,
    },
  },
  layout: {
    headerVariant: "professional",
    sectionTitleVariant: "professional",
    itemHeaderVariant: "professional",
    theme: { primaryColor: "#137880" },
    sectionIcons: {},
  },
};

describe("UploadedLayout", () => {
  it("renders the candidate name from content", () => {
    const { getByText } = render(
      <UploadedLayout content={demoResumeContent} template={sampleTemplate} />
    );
    expect(getByText(demoResumeContent.basics.name)).toBeInTheDocument();
  });

  it("renders the decoration image when present", () => {
    const { container } = render(
      <UploadedLayout content={demoResumeContent} template={sampleTemplate} />
    );
    expect(container.querySelector("img[data-template-decoration]")).not.toBeNull();
  });

  it("applies primaryColor as a CSS variable on the wrapper", () => {
    const { container } = render(
      <UploadedLayout content={demoResumeContent} template={sampleTemplate} />
    );
    const article = container.querySelector("article")!;
    expect(article.style.getPropertyValue("--primary")).toBe("#137880");
  });

  it("renders all sections from sectionOrder", () => {
    const { container } = render(
      <UploadedLayout content={demoResumeContent} template={sampleTemplate} />
    );
    // Demo content has experience, education, projects, skills
    expect(container.textContent).toContain("工作经历");
    expect(container.textContent).toContain("教育背景");
  });

  it("works without decoration (decoration: null)", () => {
    const { container } = render(
      <UploadedLayout
        content={demoResumeContent}
        template={{ ...sampleTemplate, decoration: null }}
      />
    );
    expect(container.querySelector("img[data-template-decoration]")).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

- [ ] Run: `pnpm test uploaded-layout -- --run`
- [ ] Expected: FAIL — `UploadedLayout` not found

**Step 4: Implement `UploadedLayout`**

`lib/templates/uploaded/UploadedLayout.tsx`:

```tsx
import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import { buildResumeSections, getSectionOrder } from "@/lib/templates/shared/render-sections";
import type { UploadedTemplate } from "./types";

type Props = TemplateLayoutProps & {
  template: UploadedTemplate;
};

export function UploadedLayout({
  content,
  sectionOrder,
  styleSettings,
  showEmptyPlaceholders,
  template,
}: Props) {
  const order = getSectionOrder(content, sectionOrder);
  const sections = buildResumeSections(content, template.layout.sectionTitleVariant, {
    includeBasicsSummary: true,
    showEmptyPlaceholders,
  });

  const themeStyle: React.CSSProperties = {
    "--primary": template.layout.theme.primaryColor,
    ...(template.layout.theme.accentColor && { "--accent": template.layout.theme.accentColor }),
  } as React.CSSProperties;

  return (
    <ResumePage
      styleSettings={styleSettings}
      decoration={template.decoration ?? undefined}
      maxWidthClass="max-w-[800px]"
      className=""
    >
      <div style={themeStyle}>
        <ResumeHeader
          basics={content.basics}
          variant={template.layout.headerVariant}
          showEmptyPlaceholders={showEmptyPlaceholders}
        />
        {order.map((key) => sections[key] ?? null)}
      </div>
    </ResumePage>
  );
}
```

Note: The `--primary` CSS variable is set on the inner div, NOT on `<article>`, because Task 3's test expects `article.style.getPropertyValue("--primary")` — adjust the test to query the inner div, OR move the style up to article. **Decision: move style to article** because it's simpler and one fewer layer.

Adjust implementation accordingly: pass `style` through `<ResumePage>`. This requires Task 3's `<ResumePage>` to accept and merge a `style` prop. **Add to Task 3 if not done.**

**Pre-flight adjustment to Task 3:** if Task 3's `ResumePage` doesn't take `style` as a merge-into-article prop, add it now and re-run Task 3's tests.

**Step 5: Run test to verify it passes**

- [ ] Run: `pnpm test uploaded-layout -- --run`
- [ ] Expected: PASS (5/5)

**Step 6: Run full template suite for regression**

- [ ] Run: `pnpm test templates -- --run`
- [ ] Expected: ALL PASS

**Step 7: Commit**

```bash
git add lib/templates/uploaded/ tests/unit/templates-uploaded-layout.test.tsx
git commit -m "feat(templates): add UploadedLayout shared renderer for DB-stored templates"
```

---

## Task 5: Add async DB lookup to template registry

**Files:**

- Create: `lib/templates/uploaded/fetch.ts`
- Modify: `lib/templates/registry.ts`
- Test: `tests/unit/templates-registry-merge.test.ts` (new)

**Step 1: Write the failing test**

`tests/unit/templates-registry-merge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTemplateMetaAsync, listAllTemplatesAsync, BUILTIN_TEMPLATE_IDS } from "@/lib/templates/registry";

vi.mock("@/lib/templates/uploaded/fetch", () => ({
  fetchUploadedTemplate: vi.fn(),
  listUploadedTemplates: vi.fn(),
}));

import { fetchUploadedTemplate, listUploadedTemplates } from "@/lib/templates/uploaded/fetch";

const mockTemplate = {
  id: "abbey-elegant",
  name: "陈媛媛优雅风",
  description: null,
  thumbnailUrl: null,
  decoration: null,
  layout: {
    headerVariant: "professional" as const,
    sectionTitleVariant: "professional" as const,
    itemHeaderVariant: "professional" as const,
    theme: { primaryColor: "#137880" },
    sectionIcons: {},
  },
};

describe("getTemplateMetaAsync", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns built-in meta without hitting DB for built-in ids", async () => {
    for (const id of BUILTIN_TEMPLATE_IDS) {
      const meta = await getTemplateMetaAsync(id);
      expect(meta.id).toBe(id);
      expect(meta.source).toBe("builtin");
    }
    expect(fetchUploadedTemplate).not.toHaveBeenCalled();
  });

  it("queries DB for unknown id and returns DB template wrapped", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(mockTemplate);
    const meta = await getTemplateMetaAsync("abbey-elegant");
    expect(meta.id).toBe("abbey-elegant");
    expect(meta.source).toBe("uploaded");
    expect(meta.template).toEqual(mockTemplate);
  });

  it("falls back to default for unknown id with no DB hit", async () => {
    vi.mocked(fetchUploadedTemplate).mockResolvedValue(null);
    const meta = await getTemplateMetaAsync("does-not-exist");
    expect(meta.id).toBe("professional");  // DEFAULT_TEMPLATE_ID
    expect(meta.source).toBe("builtin");
  });
});

describe("listAllTemplatesAsync", () => {
  it("merges built-in (3) + DB results", async () => {
    vi.mocked(listUploadedTemplates).mockResolvedValue([mockTemplate]);
    const all = await listAllTemplatesAsync();
    expect(all).toHaveLength(4);
    expect(all.filter((t) => t.source === "builtin")).toHaveLength(3);
    expect(all.filter((t) => t.source === "uploaded")).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

- [ ] Run: `pnpm test templates-registry-merge -- --run`
- [ ] Expected: FAIL — `getTemplateMetaAsync` / `listAllTemplatesAsync` / `fetch.ts` not found

**Step 3: Implement DB fetch**

`lib/templates/uploaded/fetch.ts`:

```ts
import { db } from "@/db";
import { templates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { UploadedTemplate } from "./types";

export async function fetchUploadedTemplate(id: string): Promise<UploadedTemplate | null> {
  const rows = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.status, "published")))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToTemplate(rows[0]);
}

export async function listUploadedTemplates(): Promise<UploadedTemplate[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.status, "published"))
    .orderBy(templates.createdAt);
  return rows.map(rowToTemplate);
}

function rowToTemplate(row: typeof templates.$inferSelect): UploadedTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    thumbnailUrl: row.thumbnailUrl,
    decoration: row.decoration as UploadedTemplate["decoration"],
    layout: row.layout as UploadedTemplate["layout"],
  };
}
```

**Step 4: Implement registry merge**

In `lib/templates/registry.ts`, add:

```ts
import { fetchUploadedTemplate, listUploadedTemplates } from "./uploaded/fetch";
import type { UploadedTemplate } from "./uploaded/types";

export type ResolvedTemplateMeta =
  | { source: "builtin"; id: BuiltinTemplateId; meta: TemplateMeta }
  | { source: "uploaded"; id: string; template: UploadedTemplate; meta: TemplateMeta };

export async function getTemplateMetaAsync(id: string | null | undefined): Promise<ResolvedTemplateMeta> {
  // Built-in fast path
  if (id && (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(id)) {
    const meta = TEMPLATES.find((t) => t.id === id)!;
    return { source: "builtin", id: id as BuiltinTemplateId, meta };
  }
  // DB lookup
  if (id) {
    const dbTemplate = await fetchUploadedTemplate(id);
    if (dbTemplate) {
      return {
        source: "uploaded",
        id: dbTemplate.id,
        template: dbTemplate,
        meta: {
          id: dbTemplate.id as TemplateId,
          name: dbTemplate.name,
          description: dbTemplate.description ?? "",
          // Layout is wired to UploadedLayout in the consumer, not here
          // Consumers should branch on `source` to pick the renderer
          Layout: () => null as never,  // sentinel; do not use directly
        },
      };
    }
  }
  // Fallback
  const fallback = TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
  return { source: "builtin", id: DEFAULT_TEMPLATE_ID, meta: fallback };
}

export type AllTemplatesItem = {
  id: string;
  name: string;
  description: string;
  thumbnailUrl: string | null;
  source: "builtin" | "uploaded";
  isRecommended?: boolean;
};

export async function listAllTemplatesAsync(): Promise<AllTemplatesItem[]> {
  const builtin: AllTemplatesItem[] = TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    thumbnailUrl: null,
    source: "builtin",
    isRecommended: t.isRecommended,
  }));
  const uploaded = await listUploadedTemplates();
  const uploadedItems: AllTemplatesItem[] = uploaded.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    thumbnailUrl: t.thumbnailUrl,
    source: "uploaded",
  }));
  return [...builtin, ...uploadedItems];
}
```

**Step 5: Run test to verify it passes**

- [ ] Run: `pnpm test templates-registry-merge -- --run`
- [ ] Expected: PASS (4/4)

**Step 6: Run full test suite**

- [ ] Run: `pnpm test -- --run`
- [ ] Expected: ALL PASS (no regression)

**Step 7: Commit**

```bash
git add lib/templates/uploaded/fetch.ts lib/templates/registry.ts tests/unit/templates-registry-merge.test.ts
git commit -m "feat(templates): add async DB lookup with built-in + uploaded merge"
```

---

## Task 6: Render correct layout component based on `source`

**Files:**

- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx` (or wherever the Layout is invoked)
- Modify: `app/(app)/resume/[id]/preview/page.tsx` (PDF / share preview path)
- Modify: `app/r/[slug]/page.tsx` (public read-only)

**Step 1: Find all layout consumers**

- [ ] Run: `grep -rn "getTemplateLayout\|getTemplateMeta\b" app/ components/ lib/`
- [ ] List every call site that picks a Layout component

**Step 2: Add a small dispatcher**

Create `lib/templates/render.tsx`:

```tsx
import type { TemplateLayoutProps } from "./types";
import { UploadedLayout } from "./uploaded/UploadedLayout";
import { getTemplateMetaAsync, type ResolvedTemplateMeta } from "./registry";

export type ResolvedRenderer = {
  source: "builtin" | "uploaded";
  Render: (props: TemplateLayoutProps) => React.ReactNode;
};

export async function resolveTemplateRenderer(id: string | null | undefined): Promise<ResolvedRenderer> {
  const resolved = await getTemplateMetaAsync(id);
  if (resolved.source === "builtin") {
    const Layout = resolved.meta.Layout;
    return { source: "builtin", Render: (p) => <Layout {...p} /> };
  }
  const tpl = resolved.template;
  return {
    source: "uploaded",
    Render: (p) => <UploadedLayout {...p} template={tpl} />,
  };
}
```

**Step 3: Update server-side preview page**

In `app/(app)/resume/[id]/preview/page.tsx`:

- [ ] Replace direct `getTemplateLayout(id)` call with `await resolveTemplateRenderer(id)`
- [ ] Use `Render({ content, sectionOrder, styleSettings })` to render

**Step 4: Update share read-only page**

Same pattern in `app/r/[slug]/page.tsx`.

**Step 5: Update client-side editor preview**

The editor preview is a client component watching RHF state. We can't `await` in render. **Approach:**

- [ ] On the server (parent page `app/(app)/resume/[id]/edit/page.tsx`), call `resolveTemplateRenderer(initialTemplateId)` and pass the resolved `template` (if source = uploaded) as a serializable prop down to client.
- [ ] If user **switches** to a different template in the editor (incl. another uploaded one), trigger a refetch via `useSWR(`/api/templates/${id}`)` — add a tiny `app/api/templates/[id]/route.ts` that returns `UploadedTemplate | null`.
- [ ] Client picks renderer based on `source` and either uses the static built-in Layout import or wraps `<UploadedLayout template={fetched} />`.

**Step 6: Manual check**

- [ ] `pnpm dev`, open an existing resume; preview should render unchanged
- [ ] Change templateId via the form to "professional" / "classic" / "modern" — verify all 3 still render
- [ ] (DB has no uploaded templates yet — Task 9 covers that)

**Step 7: Type check + lint + test full**

- [ ] Run: `pnpm tsc --noEmit && pnpm lint && pnpm test -- --run`
- [ ] Expected: ALL PASS

**Step 8: Commit**

```bash
git add app/ lib/templates/render.tsx
git commit -m "feat(templates): dispatch UploadedLayout vs built-in based on template source"
```

---

## Task 7: Surface DB templates in dashboard list

**Files:**

- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/dashboard/actions.ts` (validate templateId on createResume)

**Step 1: Read current state**

- [ ] Read `app/(app)/dashboard/page.tsx` to see how templates are listed today (probably a static list from `TEMPLATES`)
- [ ] Read `app/(app)/dashboard/actions.ts` `createResume` to find templateId validation

**Step 2: Replace static template list with `listAllTemplatesAsync`**

```tsx
import { listAllTemplatesAsync } from "@/lib/templates/registry";

export default async function DashboardPage() {
  // ... existing auth + resume fetch
  const allTemplates = await listAllTemplatesAsync();
  // ... render template gallery using allTemplates
}
```

In the template gallery component, render `thumbnailUrl` (if present) for uploaded ones; for built-in keep current preview JSX.

**Step 3: Update `createResume` validation**

Replace `BUILTIN_TEMPLATE_IDS.includes(templateId)` with:

```ts
const resolved = await getTemplateMetaAsync(templateId);
// resolved.id is what we persist (defaults to professional if invalid)
```

**Step 4: Manual check**

- [ ] `pnpm dev`, dashboard shows the 3 built-in cards as before, no errors

**Step 5: Type check + tests**

- [ ] `pnpm tsc --noEmit && pnpm test -- --run`

**Step 6: Commit**

```bash
git add app/(app)/dashboard/
git commit -m "feat(dashboard): merge built-in + DB templates in gallery"
```

---

## Task 8: Surface DB templates in editor template selector

**Files:**

- Modify: `components/editor/style-editor.tsx`
- Modify: `app/(app)/resume/[id]/edit/page.tsx` (server) — pass `allTemplates` down
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx` (client)
- Modify: `app/(app)/resume/[id]/edit/actions.ts` (saveResume validation)

**Step 1: Pass `allTemplates` from server to client**

In `page.tsx`:

```tsx
const allTemplates = await listAllTemplatesAsync();
// pass to <EditorClient allTemplates={allTemplates} />
```

In `editor-client.tsx`, accept and pass to `<StyleEditor>`.

**Step 2: Render DB cards in `<StyleEditor>`**

In the template-card section of `style-editor.tsx`:

- [ ] Map over `allTemplates` instead of static `TEMPLATES`
- [ ] For built-in: keep current visual
- [ ] For uploaded: render thumbnail + name + description; selection writes the id to RHF as before

**Step 3: Update `saveResume` validation**

`actions.ts`:

```ts
const resolved = await getTemplateMetaAsync(parsed.templateId);
parsed.templateId = resolved.id;  // normalize
```

**Step 4: Manual check**

- [ ] `pnpm dev`, open a resume editor
- [ ] Template selector shows built-in 3
- [ ] No DB templates yet (Task 9 adds one) but selector doesn't crash

**Step 5: Type check + tests**

**Step 6: Commit**

```bash
git add app/(app)/resume/[id]/edit/ components/editor/style-editor.tsx
git commit -m "feat(editor): surface DB templates in editor selector"
```

---

## Task 9: Hand-seed one DB template + end-to-end verification

**Files:**

- Create: `db/seed/template-abbey-stub.ts` — a script that inserts one row
- Run manually; do NOT auto-run on every migrate

**Step 1: Write a stub seed**

`db/seed/template-abbey-stub.ts`:

```ts
import { db } from "@/db";
import { templates } from "@/db/schema";

async function main() {
  await db.insert(templates).values({
    id: "abbey-stub",
    name: "Abbey Stub（验证用）",
    description: "Foundation 验证模板，用现有 professional variant 渲染",
    thumbnailUrl: null,
    source: "uploaded",
    decoration: null,  // Foundation plan doesn't ship a real decoration image
    layout: {
      headerVariant: "professional",
      sectionTitleVariant: "professional",
      itemHeaderVariant: "professional",
      theme: { primaryColor: "#137880" },
      sectionIcons: {
        experience: "Briefcase",
        education: "GraduationCap",
        projects: "FolderKanban",
        skills: "Sparkles",
      },
    },
    status: "published",
    createdBy: "seed-script",
  }).onConflictDoNothing();
  console.log("Seeded abbey-stub");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

**Step 2: Run the seed against your local DB**

- [ ] Run: `pnpm tsx db/seed/template-abbey-stub.ts`
- [ ] Verify: `psql $DATABASE_URL -c "SELECT id, name, source FROM templates"`
- [ ] Expected: one row with id=abbey-stub

**Step 3: End-to-end manual test**

- [ ] `pnpm dev`
- [ ] Dashboard: see "Abbey Stub" card alongside built-in 3
- [ ] Click "新建简历" with Abbey Stub selected
- [ ] Editor opens; template selector shows 4 cards, Abbey Stub is selected
- [ ] Edit basics (name, phone, email) — preview updates live
- [ ] Switch to professional, switch back to abbey-stub — both render correctly, no layout glitch
- [ ] Click 下载 PDF — PDF generated, opens, content matches preview
- [ ] Toggle share link, open `/r/[slug]` — public page renders abbey-stub correctly
- [ ] Switch back to professional, save — Abbey Stub deselected cleanly

**Step 4: Run full DoD gates**

- [ ] `pnpm test -- --run` PASS
- [ ] `pnpm tsc --noEmit` PASS
- [ ] `pnpm lint` PASS
- [ ] `pnpm build` PASS

**Step 5: Commit**

```bash
git add db/seed/template-abbey-stub.ts
git commit -m "chore(db): add abbey-stub seed for foundation verification"
```

**Step 6: Open PR + request review**

- [ ] Push the feature branch
- [ ] Open PR titled `feat: template-studio foundation (DB-stored templates)`
- [ ] Body includes: spec link, screenshots of dashboard with 4 cards, screenshots of editor with abbey-stub selected
- [ ] Wait for review per `superpowers/requesting-code-review`

---

## Definition of Done (Plan 1)

The plan is **done** when ALL of the following are true:

- ✅ All 9 tasks committed
- ✅ `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build` all pass on the branch
- ✅ Dashboard shows 4 templates (3 built-in + abbey-stub)
- ✅ User can select abbey-stub, edit, preview, export PDF, share — all work identically to built-in templates
- ✅ Switching among the 4 templates is smooth, no errors in console
- ✅ Spec referenced in PR description; PR approved
- ✅ Merged to main

After merge, the **next plan** picks up:

1. **Plan 2:** new `card-wrapped` section title variant (so DB templates can have novel visuals beyond the existing 3 variants)
2. **Plan 3:** skill scaffolding + mock AI

---

## Risks & Pre-mitigations (carried from spec)

- **R5 (TemplateId loosening loses type-safety on switch exhaustiveness):** Task 2 step 6 explicitly fixes any TS errors that surface. If Task 2 produces > 5 errors, **STOP** and reassess; possibly split TemplateId into BuiltinTemplateId (literal union) for switches and TemplateId (string) for runtime resolution.
- **Editor client preview can't await DB:** Task 6 step 5 adds `/api/templates/[id]` for client-side fetch. If this introduces flicker on template switch, Plan 2 can add SWR caching.
- **abbey-stub uses no real decoration image:** Plan 1 only proves the *plumbing* works. Plan 2+ adds the real visual variant.

---

## Execution Handoff

Plan complete. Two execution options:

1. **Subagent-Driven (this session)** — I dispatch fresh subagent per task, review between tasks, fast iteration
2. **Parallel Session (separate)** — Open new session with `superpowers/executing-plans`, batch execution with checkpoints

**Which approach?**
