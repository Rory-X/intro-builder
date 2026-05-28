# intro-builder v0.5 — 模板库 Implementation Plan（合并版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a logged-in template library at `/templates` with thumbnails (built-in + DB-stored), drawer preview, "apply with my content" toggle, and reset-on-switch styleSettings. Reuse the partial Studio Foundation work (DB table + decoration prop already shipped) and absorb Foundation Task 4-9 (UploadedLayout / async merge / dashboard list / editor list / hand-seed) into this plan — they're the engine half of the same library. Add 2 new templates (`timeline`, `minimal`) **via the Studio Skill, not hand-written React**, validating the Skill end-to-end.

**Architecture:** Built-in templates stay as React Layout components; DB templates go through one shared `<UploadedLayout>` parameterized by `decoration` + `layout` jsonb. Registry exposes async `getAllTemplates()` merging both. Template gallery, editor selector, dashboard new-resume picker all consume the merged list. `setTemplate` accepts both ids and resolves at write time. No PNG thumbnails — `<TemplateLayout>` + CSS scale at runtime.

**Tech Stack:** Existing — no new deps. Uses `IntersectionObserver`, `ResizeObserver`, `useDeferredValue`. `tsx` (newly added in package.json) is available for any Node-side scripts (e.g., hand-seeding).

**Spec:** `docs/superpowers/specs/2026-05-24-template-library.md` + `docs/superpowers/specs/2026-05-24-template-studio-skill.md`

**Already shipped on this branch (`feature/template-studio-foundation`):**

- ✅ Foundation T1: `templates` DB table (`db/schema.ts`)
- ✅ Foundation T2: `TemplateId` loosened to `string`, `BuiltinTemplateId` literal union retained
- ✅ Foundation T3: `<ResumePage>` accepts `decoration` + style props

---

## 📍 实际进度同步（更新于 2026-05-25 22:00 — 由并行 session 产出）

> 这份 plan 写于 2026-05-24，把"还没做的事"全列了 - [ ]。但**自从 plan 落地之后又有 18 个 commit + 一波未 commit 改动**，整个 Phase 1 的"引擎层"已基本全部落地，且 Studio Skill 已经端到端跑通。下面按 plan 章节给真实状态。**未来 agent 接手时请先核对 git log 与本节，再按更新后的 - [ ] 工作。**

### Phase 1 — Engine（基本完成）

| Plan 章节 | 状态 | 证据 |
|---|---|---|
| **P1.1** UploadedLayout + types.ts | ✅ 已 commit | `636d30f feat(templates): add UploadedLayout shared renderer` + `2c04011 feat(templates): add decoration and style props to ResumePage`。文件存在 `lib/templates/uploaded/{types,UploadedLayout,fetch}.ts` |
| **P1.2** 异步 registry 合并 | ✅ 已 commit | `bb824c4 feat(templates): add async DB lookup with built-in + uploaded merge`。**注意命名**：实现叫 `listAllTemplatesAsync` / `getTemplateMetaAsync`（在 `lib/templates/registry-server.ts`），而非 plan 里写的 `getAllTemplates`。 |
| **P1.3** Render dispatch | ✅ 已 commit | `b87c277 feat(templates): dispatch UploadedLayout vs built-in based on source`。同时 `lib/templates/render.tsx` + `render-server.tsx` 提供了 `<TemplateRender>` SC + `<ClientTemplateRenderFromSerializable>` 客户端版（plan 没写客户端拆分，是实现时为消除 N+1 加的）。 |
| **P1.4** TemplateMeta 扩展 (`defaultStyleSettings`/`category`/`tags`) | ❌ **未做** | 三套内置 meta.ts 都没扩展。这一步还在原计划里，需要做。 |
| **P1.5** `setTemplate` + `resetStyleSettings` flag | 🟡 部分 | `setTemplate`、`duplicateResume`、`createResume` 都已经走 `getTemplateMetaAsync` 校验 DB id（`f3c7637` 等）。但 `resetStyleSettings` flag + `set-template-action.test.ts` 没做——这块依赖 P1.4 的 `defaultStyleSettings` 字段先到位。 |

### Phase 2 — Library UI（完全没动）

P2.1 / P2.2 / P2.3 全部 **❌ 未开工**。`/templates` 路由、`<TemplateThumbnail>`、`<TemplatePreviewDrawer>`、demo-resume 都不存在。

### Phase 3 — Entry points（部分做了）

| Plan 章节 | 状态 | 证据 |
|---|---|---|
| **P3.0** 三处入口 + `proxy.ts` 保护 `/templates` | ❌ 未做 | header 没加 nav link，editor popover 没加 CTA，proxy.ts 没加 `/templates` 路径。 |
| **P3.a** dashboard 列出 DB templates | ✅ 已 commit | `e9f0492` + `5e944ad`（消除 N+1）。`app/(app)/dashboard/page.tsx` 已经用 `listAllTemplatesAsync`。 |
| **P3.b** editor selector 列出 DB templates | ✅ 已 commit | `de72f2e` + `f3c7637`。`components/editor/style-editor.tsx` 已渲染合并列表，`allTemplates` 是必填 prop。**但** abbey-stub 没缩略图，按设计会显示 name-only placeholder。 |

### Phase 4 — Content + verification

| Plan 章节 | 状态 | 证据 |
|---|---|---|
| **P4.1** Hand-seed abbey-stub | ✅ 已 commit | `59ed2ce chore(db): add abbey-stub seed`。**注意**：seed 在本会话被改了（加了 dotenv `--env-file=.env.local` 兼容），未 commit。 |
| **P4.2** 用 Skill 生成 timeline + minimal | 🟡 **Skill 已可用**，但**生成的不是 timeline / minimal** | Skill 完整端到端验证过了：用 `abbey` 参考图（陈媛媛简历）跑通 `extract-decoration → 推 layout → upsert DB`，DB 里现在有 `id=abbey` 的 uploaded 模板。但**plan 期望的 `timeline` 和 `minimal` 没生成**——abbey 只是 e2e 验证选的样本。计划里这一行需要重新走两次 Skill。 |
| **P4.3** 最终验证 + handoff | ❌ 未做 | tests/tsc/lint/build 没在闭环里跑过；浏览器手动 smoke 因登录关卡跳过。 |

### 未 commit 清单（本会话产出，**还没进 git**）

> 这是关键——上一个 agent 看不到这些，所以会以为某些东西还没做。

```
M  db/seed/template-abbey-stub.ts          # 加 dotenv 兼容（独立 tsx 跑必需）
M  package.json                            # 加 tsx 到 devDependencies
M  pnpm-lock.yaml                          # tsx 依赖
?? template-studio-skill/                  # ⭐ Studio Skill 实体（spec §6 落地）
   SKILL.md                                #   入口文档（路由 + I/O + 流程）
   scripts/extract-decoration.py           #   gpt-image-2 /edits 封装
   scripts/insert-template.ts              #   UPSERT templates 行（一次往返，幂等）
?? scripts/                                # 项目辅助脚本
   apply-templates-migration.ts            #   一次性：用 Neon HTTP 跑 0001 migration
                                           #   （drizzle-kit migrate 在国内连 ap-southeast-1 hang）
   verify-templates.ts                     #   读 listAllTemplatesAsync 验证 abbey 入库
?? public/templates/                       # 静态服务的装饰图
   decorations/abbey.png                   #   ⭐ Skill 生成的真实装饰底图（64KB）
?? docs/test-samples/                      # Skill 测试样本
   abbey-resume-reference.png              #   原始参考简历（陈媛媛 Abbey 样式）
   abbey-decoration-extracted-v1.png       #   v1 输出（圆环位置镜像了，已废弃）
   abbey-decoration-extracted-v2.png       #   v2 输出（位置正确）
```

DB 真实状态（远程 Neon）：
```
templates 表 2 行 uploaded：
  • abbey-stub  Abbey Stub（验证用）  decoration=null   layout=professional 三件套
  • abbey       陈媛媛 Abbey          decoration=yes    layout=professional + #3B8BCD + 8 个 sectionIcons
```

`listAllTemplatesAsync` 返回 5 项：3 builtin + 2 uploaded。引擎层端到端验证通过。

### Skill 真实产出 schema（验证 spec §6 设计）

Skill 跑出来的 `decoration` + `layout` JSON 与 `lib/templates/uploaded/types.ts` 类型签名 100% 对齐。spec §6.2 的 schema 设计可视为已落地、已被生产端验证。

### 下一个 agent 接手最该做的事（按优先级）

1. **浏览器渲染验证（P4.3 的提前部分）**——abbey 模板入库了，但**没人看过它真的渲染长什么样**。所有 schema 设计的对错最后只能由"渲染出来好不好看"裁决。先解决登录关卡（已加 `AUTH_DEV_BYPASS=1`，但 `requireUserId` 还会重定向），打开 `/dashboard` 或编辑器 picker 看 abbey。
2. **P1.4 TemplateMeta 扩展**——这是 P1.5 `resetStyleSettings` 和 P2.3 抽屉显示「该模板的默认排版」的前置依赖。
3. **Zod runtime validator**（plan 里没显式列出，但相关讨论确认应该补）——目前 `fetch.ts` 用 `as` cast 信任 DB 内容；Skill 输出错或 DB 被人手改时前端会直接崩。在 `lib/templates/uploaded/types.ts` 旁边加一对 `DecorationConfigSchema` / `LayoutConfigSchema` Zod，`fetch.ts` 在 `rowToTemplate` 里 parse。
4. **commit 未 commit 部分**——template-studio-skill/ 应该 commit，是这个 plan P4.2 的实体。建议拆 2 个 commit：①「feat(skill): add template-studio Studio Skill (spec §6 production)」+ ②「chore(scripts): add migration/verify helpers」。
5. **Phase 2 UI 才正式开工**——上面 1-4 是引擎和契约的收尾，UI 是新工作。

### 与 plan 的差异需要 plan 作者确认

- **P4.2 用 Skill 生成 timeline + minimal**：abbey 不是 timeline 也不是 minimal。abbey 的 layout variant 是 `professional`，跟内置 `professional` 模板视觉差别只有"颜色 + 装饰图 + icon 集"——满足"5 张缩略图"目标 OK，但**没有提供 plan 期望的"骨架差异"**（比如 timeline 鳃骨视觉、minimal 大留白）。**两条路选一**：(a) 跑两次 Skill 用真正的 timeline / minimal 参考图样本；(b) 接受「v0.5 第一波 = 装饰差异，骨架差异留 v0.5.2」并修改 spec。
- **P3.b style-editor 显示 abbey-stub 缩略图**：当前 abbey-stub 的 `thumbnailUrl=null`，UI 渲染 name-only placeholder。是否要给 abbey-stub 也截一张缩略图？还是接受"无缩略图"作为最简验证状态？

---


## File Structure (locked in)

```
lib/templates/
  types.ts                          # MOD (P1.4): TemplateMeta gains defaultStyleSettings/category/tags
  registry.ts                       # MOD (P1.2): add getAllTemplates() async merge
  uploaded/
    UploadedLayout.tsx              # NEW (P1.1): shared renderer for DB templates
    types.ts                        # NEW (P1.1): DecorationConfig + LayoutConfig + UploadedTemplate
    fetch.ts                        # NEW (P1.2): server-side DB lookup
  professional/meta.ts              # MOD (P1.4): defaultStyleSettings + category + tags
  classic/meta.ts                   # MOD (P1.4)
  modern/meta.ts                    # MOD (P1.4)
  shared/
    resume-page.tsx                 # already MOD'd in T3
app/
  templates/
    page.tsx                        # NEW (P2.2): server-rendered gallery
    template-library-client.tsx     # NEW (P2.2): client shell
  (app)/
    resume/[id]/edit/
      actions.ts                    # MOD (P1.5): setTemplate + resetStyleSettings flag; resolve DB ids
      editor-client.tsx             # MOD (P3.b): merged templates in selector
    dashboard/
      page.tsx                      # MOD (P3.a): merged templates in new-resume list
      actions.ts                    # MOD (P3.a): createResume validates DB ids
components/
  templates/
    template-card.tsx               # NEW (P2.1): card with lazy thumbnail
    template-thumbnail.tsx          # NEW (P2.1): scaled <TemplateLayout|UploadedLayout>
    template-preview-drawer.tsx    # NEW (P2.3): A4 preview + meta + apply CTA
    use-fit-thumbnail.ts            # NEW (P2.1): hook for scrollHeight measurement
  shell/
    header.tsx                      # MOD (P3.0): add 「模板库」 nav link
  editor/
    style-editor.tsx                # MOD (P3.0): "查看全部模板 →" CTA + DB templates in quick-pick
proxy.ts                            # MOD (P3.0): protect /templates (logged-in only this release)
db/seed/
  template-abbey-stub.ts            # NEW (P4.1): hand-seeded sample
scripts/
  generate-template-from-skill.ts   # NEW (P4.2): glue between Skill output and DB insert
tests/unit/
  templates-uploaded-layout.test.tsx  # NEW (P1.1)
  templates-registry-merge.test.ts    # NEW (P1.2)
  template-thumbnail.test.tsx         # NEW (P2.1)
  template-preview-drawer.test.tsx    # NEW (P2.3)
  set-template-action.test.ts         # NEW (P1.5)
```

---

## Phase 1 — Engine completion (absorb Foundation T4-T6 + Library M1-M2)

### P1.1 — `<UploadedLayout>` shared renderer

- [ ] `lib/templates/uploaded/types.ts`: define `DecorationConfig` (background image config) + `LayoutConfig` (variant choices + theme + section icons) + `UploadedTemplate` (DB row shape).
- [ ] `lib/templates/uploaded/UploadedLayout.tsx`: implements `TemplateLayoutProps`. Composes existing shared primitives (`<ResumePage>`, `<ResumeHeader>`, section variants) parameterized by the DB row. No new visual primitives.
- [ ] `tests/unit/templates-uploaded-layout.test.tsx`: render with a known fixture, assert variants pick correctly.
- [ ] Acceptance: `tsc --noEmit` clean; vitest passes; manual: render fixture in storybook-style harness if needed.

### P1.2 — Async registry merge

- [ ] `lib/templates/uploaded/fetch.ts`: server-side `fetchPublishedTemplates()` querying `templates` where `status = 'published'`.
- [ ] `lib/templates/registry.ts`: add `getAllTemplates(): Promise<TemplateMeta[]>` merging built-in + DB results. Built-in templates stay synchronously available (`TEMPLATES`); the new async function is for callers needing the full list.
- [ ] `tests/unit/templates-registry-merge.test.ts`: assert (a) no DB templates → only 3 built-in, (b) with DB rows → built-in + DB ordered with built-in first.
- [ ] Acceptance: same.

### P1.3 — Render correct layout component based on `source`

- [ ] `lib/templates/registry.ts`: `getTemplateLayoutAsync(id)` resolves to `BuiltinTemplate.Layout` or `<UploadedLayout decoration={} layout={} />`.
- [ ] Update render call sites that need DB templates: `/r/[slug]/page.tsx`, `app/(app)/resume/[id]/preview/page.tsx`, `/api/pdf/[id]/route.tsx`. Synchronous registry calls fed by built-in id keep working unchanged — the async version is opt-in for new code.
- [ ] Acceptance: existing 3 templates still render identically; switch a test resume to a hand-inserted DB template id (manual DB insert for now), `/preview` and `/api/pdf/[id]` both render.

### P1.4 — Extend `TemplateMeta` with `defaultStyleSettings/category/tags`

- [ ] `lib/templates/types.ts`: extend `TemplateMeta` with required `defaultStyleSettings: StyleSettings` and optional `category: TemplateCategory` / `tags: string[]`. Add union type `TemplateCategory = "simple" | "timeline" | "twocol" | "creative" | "academic"`. Make sure both built-in and uploaded templates surface these.
- [ ] `lib/templates/professional/meta.ts`: `defaultStyleSettings: STYLE_PRESETS.standard.settings`, `category: "simple"`, `tags: ["通用", "ATS 友好"]`.
- [ ] `lib/templates/classic/meta.ts`: same defaults, `category: "simple"`, `tags: ["衬线", "传统"]`.
- [ ] `lib/templates/modern/meta.ts`: tighter defaults (fontSize 12, pagePadding 32), `category: "twocol"`, `tags: ["双栏", "头像"]`.
- [ ] `lib/templates/uploaded/types.ts` + `fetch.ts`: derive `defaultStyleSettings/category/tags` from DB row (default to `STYLE_PRESETS.standard.settings` if not stored, plan jsonb extension if needed in P4).
- [ ] Acceptance: `getTemplateMeta('professional').defaultStyleSettings` and `getAllTemplates()[N].defaultStyleSettings` both return values.

### P1.5 — `setTemplate` + `resetStyleSettings` flag

- [ ] `app/(app)/resume/[id]/edit/actions.ts:setTemplate(id, templateId, options?)`: optional `{ resetStyleSettings?: boolean }` defaulting `true`. When true, write `styleSettings = (await getAllTemplates()).find(...).defaultStyleSettings` in the same transaction. Resolve DB ids: validate against published templates; reject unknown ids.
- [ ] Re-auth + re-zod-parse the body inside the action.
- [ ] `tests/unit/set-template-action.test.ts`: (a) flag default true resets, (b) flag false keeps existing, (c) content + sectionOrder untouched, (d) DB id resolves, (e) unknown id rejected.
- [ ] Acceptance: existing call sites (style-editor, dashboard duplicate) pass — implicit opt-in to reset matches spec § 4.2.

---

## Phase 2 — Library UI (Library M3-M5)

### P2.1 — `<TemplateThumbnail>` primitive with auto-fit scaling + lazy mount

- [ ] `components/templates/use-fit-thumbnail.ts`: hook taking `tplRef` + `containerRef`, measures `tpl.scrollHeight`, returns `{ scale, top: 0, left: centeringOffset }`. Re-runs on `ResizeObserver` and `document.fonts.ready`.
- [ ] `components/templates/template-thumbnail.tsx`: renders `<div ref={containerRef} className="aspect-[210/297] overflow-hidden relative">` with a 595×content `<TemplateLayout>` (or `<UploadedLayout>` for DB) inside, applies the hook output via `style={{ transform: scale(...) }}`. Top-aligned (per prototype).
- [ ] Lazy mount: `IntersectionObserver` — render skeleton until card enters viewport, then mount the inner Layout.
- [ ] `tests/unit/template-thumbnail.test.tsx`: scale calc + skeleton-before-mount.
- [ ] Acceptance: temporary harness page renders 8 cards with no jank in DevTools Performance trace on a typical laptop.

### P2.2 — Gallery page + "use my content" toggle

- [ ] `app/templates/page.tsx`: server, calls `auth()` + fetches user's most-recent resume (if any) + `getAllTemplates()`. Passes `{ templates, userResume, demoResume }` to client.
- [ ] `app/templates/template-library-client.tsx`: 4-col grid (≥1180px) → 3 / 2 / 1 down to 560px. Toggle defaults ON if `userResume` exists.
- [ ] On toggle: thumbnails consume `userResume.content` vs `DEMO_RESUME` from `lib/demo-resume.ts`.
- [ ] `useDeferredValue` on the resume content prop to avoid 8 simultaneous re-renders blocking input.
- [ ] `lib/demo-resume.ts`: ensure DEMO covers every section type richly (basics, education, experience, projects, skills, custom).
- [ ] Acceptance: visit `/templates` logged in, 3+ thumbnails populated. Toggle switches content. No hydration warnings.

### P2.3 — Preview drawer + apply flow

- [ ] `components/templates/template-preview-drawer.tsx`: shadcn `<Sheet>` right-aligned (≤960px). Two-column body — left: `<TemplateLayout>` at full A4 (595×842) inside scrollable wrapper; right: meta pane (name, description, tags, default styleSettings preview, feature list, CTAs).
- [ ] CTA「应用到当前简历」: calls `setTemplate(resumeId, templateId)` (resetStyleSettings true). On success: toast + close drawer + redirect (if `from=editor`) to `/resume/[id]/edit`, else stay on `/templates`.
- [ ] Cancel = close drawer, no DB write.
- [ ] resumeId source: `from=editor&resumeId=<id>` query → that resume; otherwise → user's most-recent resume; if none → CTA disabled with hint「先创建一份简历」.
- [ ] `tests/unit/template-preview-drawer.test.tsx`: ESC close, outside click close, apply with correct args, cancel no-op.
- [ ] Acceptance: end-to-end manual — open drawer, click apply, toast, DB row updated (templateId + styleSettings reset), content + tiptap marks intact.

---

## Phase 3 — Entry points (Library M6 + Foundation T7-T8)

### P3.0 — Three Library entry points

- [ ] `components/shell/header.tsx`: add `<Link href="/templates">模板库</Link>` between existing nav links (only when session exists).
- [ ] `components/editor/style-editor.tsx`: top of popover, CTA row「查看全部模板 →」navigating to `/templates?from=editor&resumeId=<id>`. Keep existing 3-button quick-pick fallback.
- [ ] `proxy.ts`: add `/templates` to protected paths (logged-in only). TODO comment for v0.5.1 reversal.
- [ ] Acceptance: logged out → `/templates` redirects to `/login?next=/templates`. Logged in → land back. Editor popover → `/templates?from=editor&...`, apply, redirected back to editor.

### P3.a — Surface DB templates in dashboard

- [ ] `app/(app)/dashboard/page.tsx`: replace direct `TEMPLATES` import with `await getAllTemplates()`.
- [ ] `app/(app)/dashboard/actions.ts:createResume`: validate `templateId` against `getAllTemplates()` ids before insert.
- [ ] Acceptance: dashboard "新建简历" picker lists built-in + any published DB templates.

### P3.b — Surface DB templates in editor template selector

- [ ] `app/(app)/resume/[id]/edit/editor-client.tsx`: pass merged templates (server-fetched) to selector.
- [ ] `components/editor/style-editor.tsx`: render full merged list in quick-pick (alongside CTA from P3.0).
- [ ] Acceptance: existing 3 still work; published DB templates appear in popover.

---

## Phase 4 — Content + verification (Foundation T9 + Library M7-M9 redesigned)

### P4.1 — Hand-seed one DB sample

- [ ] `db/seed/template-abbey-stub.ts`: a hand-typed `decoration` + `layout` jsonb — the "minimum viable DB template" — proving the engine path.
- [ ] One-off `pnpm tsx db/seed/template-abbey-stub.ts` to insert. Status `published`.
- [ ] Acceptance: gallery shows 4 thumbnails, abbey-stub renders & PDF-exports correctly.

### P4.2 — Use the Studio Skill to generate `timeline` + `minimal`

- [ ] **Strategic shift from original Library M7-M8:** instead of hand-writing 200-400 LOC React Layouts, use the existing Studio Skill to generate two DB-stored templates from sample resume images.
- [ ] `scripts/generate-template-from-skill.ts`: glue script — takes Skill output (decoration + layout JSON) and inserts into `templates` table with status `published`.
- [ ] Source images: pick two reference resumes whose visual ≠ existing 3 (timeline-rail style + minimalist large-name style).
- [ ] Run Skill → produce JSON → run script → verify in `/templates` that two new thumbnails appear.
- [ ] Acceptance: 5 thumbnails total in gallery (3 built-in + 1 abbey-stub + 2 Skill-generated). Apply each to a real resume → preview + PDF render correctly.
- [ ] **If the Skill's output quality blocks this**: fall back to hand-writing the Layouts (per original plan), but file a Skill bug for follow-up.

### P4.3 — Verification gates + handoff

- [ ] `pnpm test` — all green.
- [ ] `pnpm tsc --noEmit` — clean.
- [ ] `pnpm lint` — clean.
- [ ] `pnpm build` — clean.
- [ ] Manual smoke (per AGENTS.md §6):
  - [ ] Logged out: `/templates` → `/login?next=/templates`.
  - [ ] Dashboard: nav link visible, click → `/templates`.
  - [ ] Editor: popover CTA → `/templates?from=editor&resumeId=...` → apply → back to editor with new template + reset styleSettings + content intact (incl. tiptap marks).
  - [ ] Toggle "use my content" off/on cleanly (< 200ms visual flicker).
  - [ ] Apply a DB template → renders in `/resume/[id]/preview` and PDF identically.
  - [ ] Apply built-in templates → still works as before.
  - [ ] Dark mode: every new surface has `dark:` variants.
- [ ] Update `README.md` if user-facing surface changes ("3 套模板" → "5+ 套" etc).
- [ ] Open PR, link this plan, request review.

---

## Risks & Mitigations

- **8 thumbnails simultaneous render** → IntersectionObserver lazy + `useDeferredValue` for content prop. Verify with DevTools Performance trace before declaring P2.1 done.
- **Skill output quality** (P4.2) → if AI-generated layout doesn't pass smoke, fall back to hand-writing — don't ship broken templates.
- **`getAllTemplates()` async cascade** → server-only callers should await; client callers receive serialized result. Make sure no client component tries to call the async fn directly.
- **Built-in vs uploaded TemplateMeta divergence** → enforce shared `TemplateMeta` shape; if DB rows lack `defaultStyleSettings`, fall back to `STYLE_PRESETS.standard.settings` deterministically.
- **Drift from shared primitives** in `<UploadedLayout>` → no `style={{...}}` overrides; everything goes through `<ResumePage>` + variants.

## Out-of-Scope (do not creep)

- ❌ No public access to `/templates` for logged-out users (v0.5.1).
- ❌ No "save my settings as a custom template" UI.
- ❌ No analytics events.
- ❌ No PNG fallback thumbnails — escalate before regressing.
- ❌ No academic/creative/twocol React Layouts (those should also go through Skill in v0.5.2+).

## After Merge

- Tag `v0.5.0`.
- Note in `journal.md`: which templates shipped (and how — hand-seed vs Skill), any Skill quality findings.
- Open follow-up issue for v0.5.1: public `/templates` + ghost-resume registration callback.
- Open follow-up issue for v0.5.2: more DB templates via Skill, eventually retire built-in React templates if Skill maturity warrants.
