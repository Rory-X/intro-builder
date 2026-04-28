# intro-builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a web resume builder (intro-builder) — Next.js 15 + Neon Postgres + Auth.js Magic Link + @react-pdf/renderer export, deployable on Vercel Hobby for ≤100 users/month.

**Architecture:** Next.js 15 App Router with Server Components + Server Actions for CRUD, Drizzle/Neon HTTP driver for DB, Auth.js v5 (Resend provider, Magic Link, no password) with Drizzle adapter, jsonb `resume.content` drives both on-screen Layout.tsx and server-rendered @react-pdf/renderer Pdf.tsx per template — no DOM→PDF screenshotting.

**Tech Stack:** pnpm · Next.js 15 · React 19 · TypeScript strict · Tailwind v4 · shadcn/ui · Drizzle ORM · @neondatabase/serverless · Auth.js v5 · Resend · @react-pdf/renderer · zod · react-hook-form · @dnd-kit · Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-04-28-intro-builder-design.md`

---

## File Structure (locked in before tasks)

```
intro-web/
  package.json, pnpm-lock.yaml, next.config.ts, tsconfig.json, tailwind.config.ts,
  postcss.config.mjs, drizzle.config.ts, vitest.config.ts, middleware.ts,
  .env.local (gitignored), .env.example, .gitignore, README.md
  app/
    layout.tsx, page.tsx, globals.css, not-found.tsx
    (auth)/login/page.tsx, (auth)/login/actions.ts, (auth)/verify-request/page.tsx
    (app)/dashboard/page.tsx, (app)/dashboard/actions.ts
    (app)/resume/[id]/edit/page.tsx
    (app)/resume/[id]/edit/editor-client.tsx
    (app)/resume/[id]/edit/actions.ts
    (app)/resume/[id]/preview/page.tsx
    r/[slug]/page.tsx
    api/auth/[...nextauth]/route.ts
    api/pdf/[id]/route.ts
  components/
    ui/                # shadcn-generated (button, input, card, label, textarea, ...)
    editor/basics-editor.tsx, education-editor.tsx, experience-editor.tsx,
           projects-editor.tsx, skills-editor.tsx, sortable-list.tsx
    preview/preview-panel.tsx
  db/
    index.ts, schema.ts, migrations/ (drizzle-kit output)
  lib/
    auth.ts, auth-helpers.ts, resume-schema.ts, slug.ts, cn.ts
    templates/index.ts
    templates/classic/{Layout.tsx,Pdf.tsx,meta.ts}
    templates/modern/{Layout.tsx,Pdf.tsx,meta.ts}
  public/fonts/NotoSansSC-Regular.otf
  tests/
    unit/resume-schema.test.ts
    unit/slug.test.ts
    unit/templates-classic-layout.test.tsx
    unit/dashboard-actions.test.ts
```

**Responsibility boundaries.**
- `db/schema.ts` is the **single** source of persistence shape; `lib/resume-schema.ts` is the runtime-validated shape stored in `resume.content`.
- `lib/templates/<id>/Layout.tsx` is the on-screen preview (React DOM); `lib/templates/<id>/Pdf.tsx` is the PDF output (@react-pdf/renderer). Both consume `ResumeContent`. Do not cross-import them.
- Server Actions live next to their route (`actions.ts`). Pure functions live under `lib/`. No business logic inside React components.

---

## Test Strategy

- **Unit (Vitest + Testing Library):** zod schemas, pure helpers (slug), Server Actions (mocked db), template Layout rendering smoke tests.
- **Integration:** skip until plan is working — Neon + Auth.js integration verified manually with `pnpm dev` per the "Run it yourself" steps in Tasks 9 & 14.
- **E2E (out of scope for MVP).** Playwright deferred to P1.
- **TDD discipline:** every code-producing task writes test first, watches it fail, then makes it pass.

---

## Task 1: Scaffold Next.js 15 project

**Files:**
- Create: `intro-web/` (entire Next.js scaffold via CLI)
- Create: `intro-web/.gitignore` (generated)

- [ ] **Step 1: Run create-next-app non-interactively**

Run in `/Users/qianjiahao/proj/intro-web`:

```bash
pnpm dlx create-next-app@latest . \
  --ts --tailwind --eslint --app --no-src-dir \
  --import-alias="@/*" --use-pnpm --turbopack --no-git --yes
```

Expected: scaffold lands in current directory, uses pnpm, Tailwind v4, App Router, `@/*` alias.

- [ ] **Step 2: Verify dev server boots**

```bash
pnpm dev &
sleep 6 && curl -sI http://localhost:3000 | head -1
kill %1
```

Expected: `HTTP/1.1 200 OK`.

- [ ] **Step 3: Commit**

```bash
git init && git add -A
git commit -m "chore: scaffold Next.js 15 with pnpm, App Router, Tailwind v4"
```

---

## Task 2: Install runtime & dev dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

```bash
pnpm add next-auth@beta @auth/drizzle-adapter resend \
  drizzle-orm @neondatabase/serverless \
  @react-pdf/renderer \
  @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities \
  react-hook-form @hookform/resolvers zod \
  lucide-react nanoid clsx tailwind-merge class-variance-authority
```

- [ ] **Step 2: Install dev deps**

```bash
pnpm add -D drizzle-kit dotenv \
  vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom \
  @types/react @types/react-dom @types/node
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add runtime + dev dependencies"
```

---

## Task 3: Initialize shadcn/ui and add base primitives

**Files:**
- Create: `components.json`, `components/ui/*.tsx`, `lib/cn.ts` (or `lib/utils.ts`)

- [ ] **Step 1: Init shadcn**

```bash
pnpm dlx shadcn@latest init -y -d --base-color=slate
```

Expected: creates `components.json`, `components/ui/`, `lib/utils.ts`, adjusts `app/globals.css`.

- [ ] **Step 2: Add primitives used across editor & auth**

```bash
pnpm dlx shadcn@latest add button input label textarea card \
  dropdown-menu dialog toast separator checkbox sonner
```

- [ ] **Step 3: Commit**

```bash
git add components.json components/ lib/utils.ts app/globals.css
git commit -m "chore: init shadcn/ui with base primitives"
```

---

## Task 4: Vitest setup + smoke test

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/unit/smoke.test.ts`
- Modify: `package.json` (add `"test"` script)

- [ ] **Step 1: Write vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

`tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Add test script**

Modify `package.json` `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing smoke test**

`tests/unit/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("environment is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Run test**

```bash
pnpm test
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts tests/ package.json
git commit -m "test: add vitest + jsdom setup and smoke test"
```

---

## Task 5: Env template + drizzle config

**Files:**
- Create: `.env.example`, `drizzle.config.ts`
- Modify: `.gitignore` (ensure `.env.local` ignored)

- [ ] **Step 1: Write `.env.example`**

```
# Neon Postgres (auto-injected on Vercel when you add the Neon integration)
DATABASE_URL="postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# Auth.js
AUTH_SECRET=""              # openssl rand -base64 32
AUTH_URL="http://localhost:3000"
AUTH_TRUST_HOST="true"

# Resend (magic link)
AUTH_RESEND_KEY=""
AUTH_EMAIL_FROM="login@example.com"
```

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 3: Ensure `.env.local` ignored**

Append to `.gitignore` if missing:

```
.env
.env.local
.env.*.local
```

- [ ] **Step 4: Commit**

```bash
git add .env.example drizzle.config.ts .gitignore
git commit -m "chore: add env template and drizzle config"
```

---

## Task 6: Zod ResumeContent schema (TDD)

**Files:**
- Create: `lib/resume-schema.ts`
- Create: `tests/unit/resume-schema.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/resume-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ResumeContent, emptyResumeContent } from "@/lib/resume-schema";

describe("ResumeContent", () => {
  it("accepts empty default skeleton", () => {
    const r = ResumeContent.safeParse(emptyResumeContent());
    expect(r.success).toBe(true);
  });

  it("rejects invalid email in basics", () => {
    const bad = { ...emptyResumeContent() };
    bad.basics.email = "not-an-email";
    expect(ResumeContent.safeParse(bad).success).toBe(false);
  });

  it("requires at least name + email in basics", () => {
    const bad = emptyResumeContent();
    bad.basics.name = "";
    expect(ResumeContent.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test -- resume-schema
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/resume-schema.ts`:

```ts
import { z } from "zod";

const nonEmpty = z.string().min(1, "必填");

export const Basics = z.object({
  name: nonEmpty,
  title: z.string().default(""),
  email: z.string().email(),
  phone: z.string().default(""),
  location: z.string().default(""),
  website: z.string().url().optional().or(z.literal("")).default(""),
  summary: z.string().default(""),
});

export const Education = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  major: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  gpa: z.string().optional().default(""),
  highlights: z.array(z.string()).default([]),
});

export const Experience = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  location: z.string().optional().default(""),
  bullets: z.array(z.string()).default([]),
});

export const Project = z.object({
  name: z.string().default(""),
  stack: z.array(z.string()).default([]),
  link: z.string().optional().default(""),
  bullets: z.array(z.string()).default([]),
});

export const SkillGroup = z.object({
  category: z.string().default(""),
  items: z.array(z.string()).default([]),
});

export const CustomSection = z.object({
  title: z.string().default(""),
  content: z.string().default(""),
});

export const ResumeContent = z.object({
  basics: Basics,
  education: z.array(Education).default([]),
  experience: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  skills: z.array(SkillGroup).default([]),
  custom: z.array(CustomSection).default([]),
});

export type ResumeContent = z.infer<typeof ResumeContent>;

export const emptyResumeContent = (): ResumeContent => ({
  basics: {
    name: "你的姓名",
    title: "目标岗位",
    email: "you@example.com",
    phone: "",
    location: "",
    website: "",
    summary: "",
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  custom: [],
});
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test -- resume-schema
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/resume-schema.ts tests/unit/resume-schema.test.ts
git commit -m "feat(schema): add ResumeContent zod schema with tests"
```

---

## Task 7: Drizzle schema (Auth.js tables + resume) + initial migration

**Files:**
- Create: `db/schema.ts`, `db/index.ts`
- Generate: `db/migrations/0000_*.sql`

- [ ] **Step 1: Write `db/schema.ts`**

```ts
import {
  pgTable, text, timestamp, jsonb, primaryKey, integer, boolean,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ResumeContent } from "@/lib/resume-schema";

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
}, (t) => ({
  emailIdx: uniqueIndex("user_email_idx").on(t.email),
}));

export const accounts = pgTable("account", {
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<AdapterAccountType>().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (a) => ({
  pk: primaryKey({ columns: [a.provider, a.providerAccountId] }),
}));

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verificationToken", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (v) => ({
  pk: primaryKey({ columns: [v.identifier, v.token] }),
}));

export const resumes = pgTable("resume", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("我的简历"),
  templateId: text("templateId").notNull().default("classic"),
  content: jsonb("content").$type<ResumeContent>().notNull(),
  slug: text("slug"),
  isPublic: boolean("isPublic").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
}, (r) => ({
  userIdx: index("resume_user_idx").on(r.userId),
  slugIdx: uniqueIndex("resume_slug_idx").on(r.slug),
}));
```

- [ ] **Step 2: Write `db/index.ts`**

```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Generate migration**

```bash
pnpm drizzle-kit generate
```

Expected: creates `db/migrations/0000_*.sql` plus `meta/`.

- [ ] **Step 4: (Prereq) Provision Neon database**

Run `pnpm dlx vercel link` then `pnpm dlx vercel env pull .env.local` after adding Neon integration via Vercel dashboard. If you haven't set up Vercel yet, create a free Neon project at neon.tech, copy the pooled connection string into `.env.local` `DATABASE_URL`.

- [ ] **Step 5: Apply migration**

```bash
pnpm drizzle-kit migrate
```

Expected: "No migrations to apply" → "Applied 1 migration".

- [ ] **Step 6: Commit**

```bash
git add db/
git commit -m "feat(db): add Drizzle schema for auth + resume and generate migration"
```

---

## Task 8: Auth.js v5 config + Drizzle adapter + Resend provider

**Files:**
- Create: `lib/auth.ts`, `lib/auth-helpers.ts`, `app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Write `lib/auth.ts`**

```ts
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY!,
      from: process.env.AUTH_EMAIL_FROM!,
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/verify-request",
  },
  trustHost: true,
});
```

- [ ] **Step 2: Write route handler**

`app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from "@/lib/auth";
export const runtime = "nodejs";
```

- [ ] **Step 3: Write helper**

`lib/auth-helpers.ts`:

```ts
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}
```

- [ ] **Step 4: Smoke check — dev server starts without crashing**

```bash
pnpm dev &
sleep 6 && curl -sI http://localhost:3000/api/auth/session | head -1
kill %1
```

Expected: `HTTP/1.1 200 OK` and body `{}` (no session yet).

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth-helpers.ts app/api/auth/
git commit -m "feat(auth): configure Auth.js v5 with Resend magic link + Drizzle adapter"
```

---

## Task 9: Login + verify-request pages

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/(auth)/login/actions.ts`, `app/(auth)/verify-request/page.tsx`

- [ ] **Step 1: Write the Server Action**

`app/(auth)/login/actions.ts`:

```ts
"use server";
import { signIn } from "@/lib/auth";
import { z } from "zod";

const Schema = z.object({ email: z.string().email() });

export async function sendLoginLink(formData: FormData) {
  const parsed = Schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: "请输入有效邮箱" };
  }
  await signIn("resend", { email: parsed.data.email, redirectTo: "/dashboard" });
}
```

- [ ] **Step 2: Write `/login` page**

`app/(auth)/login/page.tsx`:

```tsx
import { sendLoginLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">登录 intro-builder</h1>
      <p className="text-sm text-muted-foreground">我们会给你的邮箱发送一个一次性登录链接。</p>
      <form action={sendLoginLink} className="flex flex-col gap-3">
        <Label htmlFor="email">邮箱</Label>
        <Input id="email" name="email" type="email" required placeholder="you@example.com" />
        <Button type="submit">发送登录链接</Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Write `/verify-request` page**

`app/(auth)/verify-request/page.tsx`:

```tsx
export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">请检查邮箱</h1>
      <p className="text-sm text-muted-foreground">
        我们发了一封登录邮件过去，点里面的链接即可登录。如果几分钟没收到，请检查垃圾箱。
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Manual verify**

Set `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_SECRET` in `.env.local`. Then:

```bash
pnpm dev
# open http://localhost:3000/login, submit your email, check inbox, click link
```

Expected: clicking magic link in email lands on `/dashboard` (404 for now — next task).

- [ ] **Step 5: Commit**

```bash
git add app/\(auth\)/
git commit -m "feat(auth): add login and verify-request pages with magic link action"
```

---

## Task 10: Middleware (route protection) + root layout polish

**Files:**
- Create: `middleware.ts`
- Modify: `app/layout.tsx` (add `<Toaster />`)

- [ ] **Step 1: Write middleware**

`middleware.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const PROTECTED = [/^\/dashboard/, /^\/resume\/[^/]+\/edit/, /^\/resume\/[^/]+\/preview/];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED.some((re) => re.test(pathname));
  if (needsAuth && !req.auth) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|fonts).*)"],
};
```

- [ ] **Step 2: Add Sonner toaster**

Modify `app/layout.tsx`, inside `<body>` append:

```tsx
import { Toaster } from "@/components/ui/sonner";
// ... inside RootLayout body, after {children}:
<Toaster />
```

- [ ] **Step 3: Smoke check**

```bash
pnpm dev &
sleep 6 && curl -sI -L http://localhost:3000/dashboard | grep -i location
kill %1
```

Expected: redirect to `/login?next=/dashboard`.

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/layout.tsx
git commit -m "feat(auth): add middleware route protection and toaster"
```

---

## Task 11: Dashboard list + createResume Server Action (TDD for action)

**Files:**
- Create: `app/(app)/dashboard/page.tsx`, `app/(app)/dashboard/actions.ts`
- Create: `tests/unit/dashboard-actions.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/dashboard-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({ db: { insert: vi.fn() } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((u: string) => { throw new Error("REDIRECT:" + u); }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { createResume } from "@/app/(app)/dashboard/actions";

describe("createResume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    await expect(createResume()).rejects.toThrow("REDIRECT:/login");
  });

  it("inserts a resume and redirects to edit", async () => {
    (auth as any).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const values = vi.fn().mockReturnValue({ returning });
    (db.insert as any).mockReturnValue({ values });
    await expect(createResume()).rejects.toThrow("REDIRECT:/resume/r1/edit");
    expect(values).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test -- dashboard-actions
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement action**

`app/(app)/dashboard/actions.ts`:

```ts
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { emptyResumeContent } from "@/lib/resume-schema";

export async function createResume() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [row] = await db.insert(resumes).values({
    userId: session.user.id,
    title: "新简历",
    templateId: "classic",
    content: emptyResumeContent(),
  }).returning({ id: resumes.id });
  revalidatePath("/dashboard");
  redirect(`/resume/${row.id}/edit`);
}

export async function deleteResume(id: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await db.delete(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
  revalidatePath("/dashboard");
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test -- dashboard-actions
```

Expected: 2 passed.

- [ ] **Step 5: Implement dashboard page**

`app/(app)/dashboard/page.tsx`:

```tsx
import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createResume, deleteResume } from "./actions";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const list = await db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的简历</h1>
        <form action={createResume}><Button type="submit">新建简历</Button></form>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((r) => (
          <Card key={r.id}>
            <CardHeader><CardTitle className="truncate">{r.title}</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between">
              <Link className="text-sm underline" href={`/resume/${r.id}/edit`}>编辑</Link>
              <form action={async () => { "use server"; await deleteResume(r.id); }}>
                <Button type="submit" variant="ghost" size="sm">删除</Button>
              </form>
            </CardContent>
          </Card>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">还没有简历，点右上角新建一份。</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/dashboard/ tests/unit/dashboard-actions.test.ts
git commit -m "feat(dashboard): list resumes with create/delete Server Actions (TDD)"
```

---

## Task 12: Editor shell + saveResume Server Action with debounced autosave

**Files:**
- Create: `app/(app)/resume/[id]/edit/page.tsx`, `app/(app)/resume/[id]/edit/actions.ts`, `app/(app)/resume/[id]/edit/editor-client.tsx`

- [ ] **Step 1: Write save action**

`app/(app)/resume/[id]/edit/actions.ts`:

```ts
"use server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";

export async function saveResume(id: string, content: unknown, title?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const parsed = ResumeContent.safeParse(content);
  if (!parsed.success) throw new Error("invalid: " + parsed.error.message);
  await db.update(resumes)
    .set({
      content: parsed.data,
      ...(title ? { title } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}

export async function setTemplate(id: string, templateId: "classic" | "modern") {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  await db.update(resumes).set({ templateId, updatedAt: new Date() })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}
```

- [ ] **Step 2: Write RSC page (fetch + hand off to client)**

`app/(app)/resume/[id]/edit/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import EditorClient from "./editor-client";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, userId)),
  });
  if (!row) notFound();
  return (
    <EditorClient
      id={row.id}
      initialTitle={row.title}
      initialTemplate={row.templateId as "classic" | "modern"}
      initialContent={row.content}
    />
  );
}
```

- [ ] **Step 3: Write client editor shell**

`app/(app)/resume/[id]/edit/editor-client.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ResumeContent } from "@/lib/resume-schema";
import { saveResume, setTemplate } from "./actions";
import { PreviewPanel } from "@/components/preview/preview-panel";
import { BasicsEditor } from "@/components/editor/basics-editor";
import { ExperienceEditor } from "@/components/editor/experience-editor";
import { EducationEditor } from "@/components/editor/education-editor";
import { ProjectsEditor } from "@/components/editor/projects-editor";
import { SkillsEditor } from "@/components/editor/skills-editor";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  id: string;
  initialTitle: string;
  initialTemplate: "classic" | "modern";
  initialContent: ResumeContent;
};

export default function EditorClient({ id, initialTitle, initialTemplate, initialContent }: Props) {
  const form = useForm<ResumeContent>({
    resolver: zodResolver(ResumeContent),
    defaultValues: initialContent,
    mode: "onChange",
  });
  const [title, setTitleState] = useState(initialTitle);
  const [template, setTemplateState] = useState<"classic" | "modern">(initialTemplate);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = form.watch();

  // debounce 2s autosave
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      startTransition(async () => {
        try {
          await saveResume(id, values, title);
        } catch (e: any) {
          toast.error("保存失败：" + e.message);
        }
      });
    }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), title]);

  async function changeTemplate(next: "classic" | "modern") {
    setTemplateState(next);
    await setTemplate(id, next);
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <div className="space-y-6 overflow-y-auto border-r p-6">
        <div className="flex items-center gap-3">
          <Input
            value={title}
            onChange={(e) => setTitleState(e.target.value)}
            className="max-w-xs text-base"
          />
          <span className="text-xs text-muted-foreground">{isPending ? "保存中…" : "已保存"}</span>
          <div className="ml-auto flex gap-2">
            <Button
              variant={template === "classic" ? "default" : "outline"}
              size="sm"
              onClick={() => changeTemplate("classic")}
            >经典</Button>
            <Button
              variant={template === "modern" ? "default" : "outline"}
              size="sm"
              onClick={() => changeTemplate("modern")}
            >现代</Button>
            <a
              href={`/api/pdf/${id}`}
              className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
            >下载 PDF</a>
          </div>
        </div>
        <FormProvider {...form}>
          <BasicsEditor />
          <ExperienceEditor />
          <EducationEditor />
          <ProjectsEditor />
          <SkillsEditor />
        </FormProvider>
      </div>
      <div className="overflow-y-auto bg-slate-100 p-6">
        <PreviewPanel content={values} templateId={template} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Placeholder preview panel (replaced in Task 14)**

`components/preview/preview-panel.tsx`:

```tsx
import type { ResumeContent } from "@/lib/resume-schema";
export function PreviewPanel({ content, templateId }: { content: ResumeContent; templateId: string }) {
  return (
    <div className="mx-auto w-full max-w-[800px] rounded bg-white p-8 shadow">
      <div className="mb-4 text-xs text-muted-foreground">template: {templateId}</div>
      <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(content, null, 2)}</pre>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/resume/ components/preview/
git commit -m "feat(editor): scaffold editor page with debounced autosave"
```

---

## Task 13: Section editors (basics / experience / education / projects / skills)

**Files:**
- Create: `components/editor/basics-editor.tsx`, `experience-editor.tsx`, `education-editor.tsx`, `projects-editor.tsx`, `skills-editor.tsx`

- [ ] **Step 1: basics-editor.tsx**

`components/editor/basics-editor.tsx`:

```tsx
"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ResumeContent } from "@/lib/resume-schema";

export function BasicsEditor() {
  const { register, formState } = useFormContext<ResumeContent>();
  const err = formState.errors.basics;
  const F = ({ k, label, type = "text" }: { k: keyof ResumeContent["basics"]; label: string; type?: string }) => (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      <Input type={type} {...register(`basics.${k}` as const)} />
      {err?.[k]?.message && <p className="text-xs text-red-500">{String(err[k]?.message)}</p>}
    </div>
  );
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 text-lg font-semibold">基础信息</h2>
      <div className="grid grid-cols-2 gap-3">
        <F k="name" label="姓名" />
        <F k="title" label="目标岗位" />
        <F k="email" label="邮箱" type="email" />
        <F k="phone" label="电话" />
        <F k="location" label="城市" />
        <F k="website" label="个人主页 (可选)" />
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <Label>自我介绍</Label>
        <Textarea rows={4} {...register("basics.summary")} />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Generic list editor helper + experience editor**

`components/editor/sortable-list.tsx`:

```tsx
"use client";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SortableItem({ id, children, onDelete }: { id: string; children: React.ReactNode; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
         className="flex gap-2 rounded border p-3">
      <button type="button" className="cursor-grab" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1">{children}</div>
      <Button type="button" variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

export function ReorderProvider<T extends { __id: string }>({
  items, onReorder, children,
}: { items: T[]; onReorder: (items: T[]) => void; children: React.ReactNode }) {
  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
      if (!over || active.id === over.id) return;
      const oldI = items.findIndex((i) => i.__id === active.id);
      const newI = items.findIndex((i) => i.__id === over.id);
      onReorder(arrayMove(items, oldI, newI));
    }}>
      <SortableContext items={items.map((i) => i.__id)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}
```

`components/editor/experience-editor.tsx`:

```tsx
"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function ExperienceEditor() {
  const { register, control } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "experience" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        工作经历
        <Button type="button" size="sm" onClick={() => append({ company: "", title: "", start: "", end: "", location: "", bullets: [""] })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>公司</Label><Input {...register(`experience.${idx}.company` as const)} /></div>
              <div><Label>职位</Label><Input {...register(`experience.${idx}.title` as const)} /></div>
              <div><Label>开始</Label><Input placeholder="2023.07" {...register(`experience.${idx}.start` as const)} /></div>
              <div><Label>结束</Label><Input placeholder="至今" {...register(`experience.${idx}.end` as const)} /></div>
            </div>
            <div>
              <Label>工作成果 (每行一条 bullet)</Label>
              <BulletsField name={`experience.${idx}.bullets`} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BulletsField({ name }: { name: `experience.${number}.bullets` | `projects.${number}.bullets` | `education.${number}.highlights` }) {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const value = (watch(name) as string[]) ?? [];
  const joined = value.join("\n");
  return (
    <Textarea
      rows={4}
      value={joined}
      onChange={(e) => setValue(name as any, e.target.value.split("\n").filter(Boolean) as any, { shouldDirty: true })}
    />
  );
}
```

- [ ] **Step 3: education-editor.tsx (mirror experience, swap fields)**

```tsx
"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function EducationEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "education" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        教育背景
        <Button type="button" size="sm" onClick={() => append({ school: "", degree: "", major: "", start: "", end: "", gpa: "", highlights: [] })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>学校</Label><Input {...register(`education.${idx}.school` as const)} /></div>
              <div><Label>学历</Label><Input {...register(`education.${idx}.degree` as const)} /></div>
              <div><Label>专业</Label><Input {...register(`education.${idx}.major` as const)} /></div>
              <div><Label>GPA</Label><Input {...register(`education.${idx}.gpa` as const)} /></div>
              <div><Label>开始</Label><Input {...register(`education.${idx}.start` as const)} /></div>
              <div><Label>结束</Label><Input {...register(`education.${idx}.end` as const)} /></div>
            </div>
            <div>
              <Label>亮点 (每行一条)</Label>
              <Textarea
                rows={3}
                value={((watch(`education.${idx}.highlights` as const) as string[]) ?? []).join("\n")}
                onChange={(e) => setValue(`education.${idx}.highlights` as const, e.target.value.split("\n").filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: projects-editor.tsx**

```tsx
"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function ProjectsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "projects" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        项目经历
        <Button type="button" size="sm" onClick={() => append({ name: "", stack: [], link: "", bullets: [] })}>
          + 新增
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div><Label>项目名</Label><Input {...register(`projects.${idx}.name` as const)} /></div>
              <div><Label>链接</Label><Input {...register(`projects.${idx}.link` as const)} /></div>
            </div>
            <div>
              <Label>技术栈 (逗号分隔)</Label>
              <Input
                value={((watch(`projects.${idx}.stack` as const) as string[]) ?? []).join(", ")}
                onChange={(e) => setValue(`projects.${idx}.stack` as const, e.target.value.split(",").map(s => s.trim()).filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <div>
              <Label>项目亮点 (每行一条)</Label>
              <Textarea
                rows={3}
                value={((watch(`projects.${idx}.bullets` as const) as string[]) ?? []).join("\n")}
                onChange={(e) => setValue(`projects.${idx}.bullets` as const, e.target.value.split("\n").filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此条</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: skills-editor.tsx**

```tsx
"use client";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { ResumeContent } from "@/lib/resume-schema";

export function SkillsEditor() {
  const { register, control, watch, setValue } = useFormContext<ResumeContent>();
  const { fields, append, remove } = useFieldArray({ control, name: "skills" });
  return (
    <section className="rounded border p-4">
      <h2 className="mb-3 flex items-center justify-between text-lg font-semibold">
        技能
        <Button type="button" size="sm" onClick={() => append({ category: "", items: [] })}>
          + 新增分组
        </Button>
      </h2>
      <div className="space-y-3">
        {fields.map((f, idx) => (
          <div key={f.id} className="space-y-2 rounded border p-3">
            <div><Label>分类名 (如：语言 / 框架)</Label><Input {...register(`skills.${idx}.category` as const)} /></div>
            <div>
              <Label>项目列表 (逗号分隔)</Label>
              <Input
                value={((watch(`skills.${idx}.items` as const) as string[]) ?? []).join(", ")}
                onChange={(e) => setValue(`skills.${idx}.items` as const, e.target.value.split(",").map(s => s.trim()).filter(Boolean), { shouldDirty: true })}
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(idx)}>删除此组</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add components/editor/
git commit -m "feat(editor): add section editors for basics/exp/edu/projects/skills"
```

---

## Task 14: Classic template — Layout (DOM preview) + render test

**Files:**
- Create: `lib/templates/index.ts`, `lib/templates/classic/meta.ts`, `lib/templates/classic/Layout.tsx`
- Create: `tests/unit/templates-classic-layout.test.tsx`
- Modify: `components/preview/preview-panel.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/templates-classic-layout.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { emptyResumeContent } from "@/lib/resume-schema";

describe("ClassicLayout", () => {
  it("renders basics name as heading", () => {
    const c = emptyResumeContent();
    c.basics.name = "张三";
    c.experience = [{ company: "字节跳动", title: "前端工程师", start: "2022", end: "至今", location: "北京", bullets: ["主导 X 项目"] }];
    render(<ClassicLayout content={c} />);
    expect(screen.getByRole("heading", { name: "张三" })).toBeInTheDocument();
    expect(screen.getByText("字节跳动")).toBeInTheDocument();
    expect(screen.getByText("主导 X 项目")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm test -- templates-classic-layout
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement Classic Layout**

`lib/templates/classic/meta.ts`:

```ts
export const classicMeta = { id: "classic" as const, name: "经典", description: "大厂保守，黑白单栏" };
```

`lib/templates/classic/Layout.tsx`:

```tsx
import type { ResumeContent } from "@/lib/resume-schema";

export function ClassicLayout({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <article className="mx-auto max-w-[800px] bg-white p-10 font-serif text-[13px] leading-relaxed text-black">
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold">{b.name}</h1>
        {b.title && <p className="text-base">{b.title}</p>}
        <p className="text-xs text-neutral-600">
          {[b.email, b.phone, b.location, b.website].filter(Boolean).join(" · ")}
        </p>
      </header>
      {b.summary && <Section title="自我介绍"><p>{b.summary}</p></Section>}
      {content.experience.length > 0 && (
        <Section title="工作经历">
          {content.experience.map((e, i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between font-semibold">
                <span>{e.company} — {e.title}</span>
                <span className="font-normal">{e.start} – {e.end}</span>
              </div>
              <ul className="list-disc pl-5">
                {e.bullets.map((b, j) => <li key={j}>{b}</li>)}
              </ul>
            </div>
          ))}
        </Section>
      )}
      {content.education.length > 0 && (
        <Section title="教育背景">
          {content.education.map((e, i) => (
            <div key={i} className="mb-1 flex justify-between">
              <span><strong>{e.school}</strong> {e.degree} {e.major}{e.gpa ? ` · GPA ${e.gpa}` : ""}</span>
              <span>{e.start} – {e.end}</span>
            </div>
          ))}
        </Section>
      )}
      {content.projects.length > 0 && (
        <Section title="项目经历">
          {content.projects.map((p, i) => (
            <div key={i} className="mb-2">
              <div className="font-semibold">{p.name} {p.stack.length > 0 && <span className="font-normal text-neutral-600">({p.stack.join(", ")})</span>}</div>
              <ul className="list-disc pl-5">{p.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
            </div>
          ))}
        </Section>
      )}
      {content.skills.length > 0 && (
        <Section title="技能">
          {content.skills.map((s, i) => (
            <div key={i}><strong>{s.category}:</strong> {s.items.join(", ")}</div>
          ))}
        </Section>
      )}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="mb-1 border-b border-black pb-0.5 text-sm font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}
```

`lib/templates/index.ts`:

```ts
export { ClassicLayout } from "./classic/Layout";
export { classicMeta } from "./classic/meta";
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm test -- templates-classic-layout
```

Expected: 1 passed.

- [ ] **Step 5: Wire preview panel**

Overwrite `components/preview/preview-panel.tsx`:

```tsx
import type { ResumeContent } from "@/lib/resume-schema";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";

export function PreviewPanel({ content, templateId }: { content: ResumeContent; templateId: "classic" | "modern" }) {
  const Layout = templateId === "modern" ? ModernLayout : ClassicLayout;
  return (
    <div className="mx-auto w-full max-w-[820px]">
      <Layout content={content} />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/templates/ tests/unit/templates-classic-layout.test.tsx components/preview/preview-panel.tsx
git commit -m "feat(templates): implement Classic layout with render test"
```

---

## Task 15: Modern template Layout

**Files:**
- Create: `lib/templates/modern/{meta.ts,Layout.tsx}`

- [ ] **Step 1: Implement**

`lib/templates/modern/meta.ts`:

```ts
export const modernMeta = { id: "modern" as const, name: "现代", description: "技术风双栏" };
```

`lib/templates/modern/Layout.tsx`:

```tsx
import type { ResumeContent } from "@/lib/resume-schema";

export function ModernLayout({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <article className="mx-auto grid max-w-[820px] grid-cols-[220px_1fr] gap-6 bg-white p-8 text-[12.5px] leading-relaxed text-black">
      <aside className="space-y-4 border-r pr-4">
        <div>
          <h1 className="text-xl font-bold">{b.name}</h1>
          <p className="text-sm text-neutral-600">{b.title}</p>
        </div>
        <div className="space-y-0.5 text-xs">
          {b.email && <div>📧 {b.email}</div>}
          {b.phone && <div>📱 {b.phone}</div>}
          {b.location && <div>📍 {b.location}</div>}
          {b.website && <div>🔗 {b.website}</div>}
        </div>
        {content.skills.length > 0 && (
          <div>
            <h2 className="mb-1 text-sm font-bold">技能</h2>
            {content.skills.map((s, i) => (
              <div key={i} className="mb-1">
                <div className="text-xs font-semibold">{s.category}</div>
                <div className="text-xs text-neutral-700">{s.items.join(", ")}</div>
              </div>
            ))}
          </div>
        )}
        {content.education.length > 0 && (
          <div>
            <h2 className="mb-1 text-sm font-bold">教育</h2>
            {content.education.map((e, i) => (
              <div key={i} className="mb-1 text-xs">
                <div className="font-semibold">{e.school}</div>
                <div>{e.degree} {e.major}</div>
                <div className="text-neutral-600">{e.start} – {e.end}</div>
              </div>
            ))}
          </div>
        )}
      </aside>
      <main className="space-y-4">
        {b.summary && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">自我介绍</h2>
            <p>{b.summary}</p>
          </section>
        )}
        {content.experience.length > 0 && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">工作经历</h2>
            {content.experience.map((e, i) => (
              <div key={i} className="mb-2">
                <div className="flex justify-between">
                  <span className="font-semibold">{e.title} @ {e.company}</span>
                  <span className="text-xs text-neutral-600">{e.start} – {e.end}</span>
                </div>
                <ul className="list-disc pl-5">{e.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            ))}
          </section>
        )}
        {content.projects.length > 0 && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">项目</h2>
            {content.projects.map((p, i) => (
              <div key={i} className="mb-2">
                <div className="font-semibold">{p.name}{p.stack.length > 0 && <span className="ml-2 font-normal text-neutral-600">{p.stack.join(" · ")}</span>}</div>
                <ul className="list-disc pl-5">{p.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            ))}
          </section>
        )}
      </main>
    </article>
  );
}
```

Add export to `lib/templates/index.ts`:

```ts
export { ModernLayout } from "./modern/Layout";
export { modernMeta } from "./modern/meta";
```

- [ ] **Step 2: Smoke check**

Run `pnpm dev`, visit `/resume/<id>/edit`, toggle template button — both Classic and Modern render.

- [ ] **Step 3: Commit**

```bash
git add lib/templates/modern/ lib/templates/index.ts
git commit -m "feat(templates): add Modern layout"
```

---

## Task 16: PDF export — font + Classic Pdf.tsx + route

**Files:**
- Create: `public/fonts/NotoSansSC-Regular.otf` (downloaded)
- Create: `lib/templates/classic/Pdf.tsx`, `lib/templates/modern/Pdf.tsx`, `app/api/pdf/[id]/route.ts`

- [ ] **Step 1: Download Noto Sans SC regular font**

```bash
mkdir -p public/fonts
curl -L -o public/fonts/NotoSansSC-Regular.otf \
  https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansSC-Regular.otf
ls -lh public/fonts/NotoSansSC-Regular.otf
```

Expected: ~10 MB file present. If size seems off, re-run.

- [ ] **Step 2: Implement Classic PDF renderer**

`lib/templates/classic/Pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "node:path";
import type { ResumeContent } from "@/lib/resume-schema";

Font.register({
  family: "NotoSansSC",
  src: path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf"),
});

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "NotoSansSC", fontSize: 10, lineHeight: 1.45, color: "#111" },
  h1: { fontSize: 20, textAlign: "center", marginBottom: 2 },
  role: { textAlign: "center", fontSize: 11, marginBottom: 2 },
  meta: { textAlign: "center", fontSize: 9, color: "#555", marginBottom: 10 },
  section: { marginTop: 10 },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottom: "1 solid #000", paddingBottom: 2, marginBottom: 4, textTransform: "uppercase" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontWeight: 700 },
  bullet: { marginLeft: 10, marginTop: 1 },
});

export function ClassicPdf({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>{b.name}</Text>
        {b.title ? <Text style={styles.role}>{b.title}</Text> : null}
        <Text style={styles.meta}>{[b.email, b.phone, b.location, b.website].filter(Boolean).join("  ·  ")}</Text>

        {b.summary ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>自我介绍</Text>
            <Text>{b.summary}</Text>
          </View>
        ) : null}

        {content.experience.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>工作经历</Text>
            {content.experience.map((e, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <View style={styles.row}>
                  <Text style={styles.bold}>{e.company} — {e.title}</Text>
                  <Text>{e.start} – {e.end}</Text>
                </View>
                {e.bullets.map((x, j) => <Text key={j} style={styles.bullet}>• {x}</Text>)}
              </View>
            ))}
          </View>
        )}

        {content.education.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>教育背景</Text>
            {content.education.map((e, i) => (
              <View key={i} style={styles.row}>
                <Text><Text style={styles.bold}>{e.school}</Text> {e.degree} {e.major}{e.gpa ? ` · GPA ${e.gpa}` : ""}</Text>
                <Text>{e.start} – {e.end}</Text>
              </View>
            ))}
          </View>
        )}

        {content.projects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>项目经历</Text>
            {content.projects.map((p, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <Text style={styles.bold}>{p.name}{p.stack.length > 0 ? `  (${p.stack.join(", ")})` : ""}</Text>
                {p.bullets.map((x, j) => <Text key={j} style={styles.bullet}>• {x}</Text>)}
              </View>
            ))}
          </View>
        )}

        {content.skills.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>技能</Text>
            {content.skills.map((s, i) => (
              <Text key={i}><Text style={styles.bold}>{s.category}: </Text>{s.items.join(", ")}</Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 3: Implement Modern Pdf (compact variant of Classic, double column)**

`lib/templates/modern/Pdf.tsx`:

```tsx
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import path from "node:path";
import type { ResumeContent } from "@/lib/resume-schema";

Font.register({
  family: "NotoSansSC",
  src: path.join(process.cwd(), "public/fonts/NotoSansSC-Regular.otf"),
});

const s = StyleSheet.create({
  page: { padding: 32, fontFamily: "NotoSansSC", fontSize: 9.5, lineHeight: 1.45, color: "#111", flexDirection: "row" },
  side: { width: 160, paddingRight: 12, borderRight: "1 solid #bbb" },
  main: { flex: 1, paddingLeft: 12 },
  name: { fontSize: 16, fontWeight: 700 },
  role: { color: "#555", marginBottom: 8 },
  sectionTitle: { fontSize: 10.5, fontWeight: 700, marginTop: 8, marginBottom: 3, borderBottom: "1 solid #000", paddingBottom: 1 },
  sideTitle: { fontSize: 10, fontWeight: 700, marginTop: 8, marginBottom: 2 },
  bullet: { marginLeft: 10, marginTop: 1 },
  row: { flexDirection: "row", justifyContent: "space-between" },
});

export function ModernPdf({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.side}>
          <Text style={s.name}>{b.name}</Text>
          <Text style={s.role}>{b.title}</Text>
          {b.email ? <Text>{b.email}</Text> : null}
          {b.phone ? <Text>{b.phone}</Text> : null}
          {b.location ? <Text>{b.location}</Text> : null}
          {b.website ? <Text>{b.website}</Text> : null}
          {content.skills.length > 0 && (
            <>
              <Text style={s.sideTitle}>技能</Text>
              {content.skills.map((g, i) => (
                <View key={i} style={{ marginBottom: 3 }}>
                  <Text style={{ fontWeight: 700 }}>{g.category}</Text>
                  <Text>{g.items.join(", ")}</Text>
                </View>
              ))}
            </>
          )}
          {content.education.length > 0 && (
            <>
              <Text style={s.sideTitle}>教育</Text>
              {content.education.map((e, i) => (
                <View key={i} style={{ marginBottom: 3 }}>
                  <Text style={{ fontWeight: 700 }}>{e.school}</Text>
                  <Text>{e.degree} {e.major}</Text>
                  <Text style={{ color: "#666" }}>{e.start} – {e.end}</Text>
                </View>
              ))}
            </>
          )}
        </View>
        <View style={s.main}>
          {b.summary ? (
            <>
              <Text style={s.sectionTitle}>自我介绍</Text>
              <Text>{b.summary}</Text>
            </>
          ) : null}
          {content.experience.length > 0 && (
            <>
              <Text style={s.sectionTitle}>工作经历</Text>
              {content.experience.map((e, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <View style={s.row}>
                    <Text style={{ fontWeight: 700 }}>{e.title} @ {e.company}</Text>
                    <Text style={{ color: "#666" }}>{e.start} – {e.end}</Text>
                  </View>
                  {e.bullets.map((x, j) => <Text key={j} style={s.bullet}>• {x}</Text>)}
                </View>
              ))}
            </>
          )}
          {content.projects.length > 0 && (
            <>
              <Text style={s.sectionTitle}>项目</Text>
              {content.projects.map((p, i) => (
                <View key={i} style={{ marginBottom: 5 }}>
                  <Text style={{ fontWeight: 700 }}>{p.name}{p.stack.length > 0 ? `  ${p.stack.join(" · ")}` : ""}</Text>
                  {p.bullets.map((x, j) => <Text key={j} style={s.bullet}>• {x}</Text>)}
                </View>
              ))}
            </>
          )}
        </View>
      </Page>
    </Document>
  );
}
```

- [ ] **Step 4: Implement PDF route handler**

`app/api/pdf/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { renderToStream } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";
import { ClassicPdf } from "@/lib/templates/classic/Pdf";
import { ModernPdf } from "@/lib/templates/modern/Pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return new NextResponse("unauthorized", { status: 401 });
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.id, id), eq(resumes.userId, session.user.id)),
  });
  if (!row) return new NextResponse("not found", { status: 404 });
  const parsed = ResumeContent.safeParse(row.content);
  if (!parsed.success) return new NextResponse("invalid content", { status: 500 });
  const doc = row.templateId === "modern"
    ? <ModernPdf content={parsed.data} />
    : <ClassicPdf content={parsed.data} />;
  const stream = await renderToStream(doc);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(row.title)}.pdf"`,
    },
  });
}
```

Note: this file uses JSX so rename to `.tsx` if TypeScript complains. If keeping `.ts`, replace JSX with `React.createElement(ClassicPdf, { content: parsed.data })`. Prefer renaming to `.tsx`.

- [ ] **Step 5: Smoke check**

```bash
pnpm dev
# log in, create a resume, add one experience row, click "下载 PDF"
```

Expected: browser downloads `<title>.pdf`; open and verify Chinese characters render (not tofu).

- [ ] **Step 6: Commit**

```bash
git add public/fonts/ lib/templates/classic/Pdf.tsx lib/templates/modern/Pdf.tsx app/api/pdf/
git commit -m "feat(pdf): server-render PDFs via @react-pdf/renderer with Noto Sans SC"
```

---

## Task 17: Public share link `/r/[slug]`

**Files:**
- Create: `lib/slug.ts`, `tests/unit/slug.test.ts`, `app/r/[slug]/page.tsx`
- Modify: `app/(app)/resume/[id]/edit/actions.ts` (add `toggleShare`)
- Modify: `app/(app)/resume/[id]/edit/editor-client.tsx` (share toggle UI)

- [ ] **Step 1: Write slug test**

`tests/unit/slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newSlug } from "@/lib/slug";

describe("newSlug", () => {
  it("returns a 10-char url-safe string", () => {
    const s = newSlug();
    expect(s).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
  it("is unique enough across 100 calls", () => {
    const set = new Set(Array.from({ length: 100 }, () => newSlug()));
    expect(set.size).toBe(100);
  });
});
```

- [ ] **Step 2: Implement slug**

`lib/slug.ts`:

```ts
import { customAlphabet } from "nanoid";
const nano = customAlphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-", 10);
export const newSlug = () => nano();
```

- [ ] **Step 3: Run test**

```bash
pnpm test -- slug
```

Expected: 2 passed.

- [ ] **Step 4: Add toggleShare action**

Append to `app/(app)/resume/[id]/edit/actions.ts`:

```ts
import { newSlug } from "@/lib/slug";

export async function toggleShare(id: string, enable: boolean) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  await db.update(resumes).set({
    isPublic: enable,
    slug: enable ? newSlug() : null,
    updatedAt: new Date(),
  }).where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
}
```

- [ ] **Step 5: Public page**

`app/r/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { ResumeContent } from "@/lib/resume-schema";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";

export const revalidate = 60;

export default async function PublicResume({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await db.query.resumes.findFirst({
    where: and(eq(resumes.slug, slug), eq(resumes.isPublic, true)),
  });
  if (!row) notFound();
  const parsed = ResumeContent.safeParse(row.content);
  if (!parsed.success) notFound();
  const Layout = row.templateId === "modern" ? ModernLayout : ClassicLayout;
  return (
    <main className="bg-slate-100 py-8">
      <Layout content={parsed.data} />
    </main>
  );
}
```

- [ ] **Step 6: Add share toggle UI**

In `editor-client.tsx`, add near the PDF button:

```tsx
import { toggleShare } from "./actions";

// inside component:
const [isPublic, setIsPublic] = useState(false);
const [publicSlug, setPublicSlug] = useState<string | null>(null);
async function onToggleShare() {
  const next = !isPublic;
  await toggleShare(id, next);
  setIsPublic(next);
  if (next) {
    const res = await fetch(`/api/share-slug/${id}`);
    setPublicSlug((await res.json()).slug);
  } else {
    setPublicSlug(null);
  }
}
```

For the initial slug fetch, pass `initialIsPublic` and `initialSlug` props from the page (extend `EditorClient` props and RSC). Detailed diff:

In `app/(app)/resume/[id]/edit/page.tsx` add to the `<EditorClient ... />`:

```tsx
initialIsPublic={row.isPublic}
initialSlug={row.slug ?? null}
```

In `editor-client.tsx` add to `Props`:

```ts
initialIsPublic: boolean;
initialSlug: string | null;
```

and replace the `useState` defaults:

```ts
const [isPublic, setIsPublic] = useState(initialIsPublic);
const [publicSlug, setPublicSlug] = useState<string | null>(initialSlug);
```

Drop the `fetch("/api/share-slug/...")` branch — instead have `toggleShare` return the new slug:

Update action:

```ts
export async function toggleShare(id: string, enable: boolean): Promise<{ slug: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const slug = enable ? newSlug() : null;
  await db.update(resumes).set({ isPublic: enable, slug, updatedAt: new Date() })
    .where(and(eq(resumes.id, id), eq(resumes.userId, session.user.id)));
  return { slug };
}
```

Update client:

```tsx
async function onToggleShare() {
  const next = !isPublic;
  const { slug } = await toggleShare(id, next);
  setIsPublic(next);
  setPublicSlug(slug);
}
```

And render a share button + copyable link:

```tsx
<Button size="sm" variant="outline" onClick={onToggleShare}>
  {isPublic ? "关闭分享" : "开启分享"}
</Button>
{isPublic && publicSlug && (
  <span className="text-xs text-muted-foreground">
    分享: {`${location.origin}/r/${publicSlug}`}
  </span>
)}
```

- [ ] **Step 7: Commit**

```bash
git add lib/slug.ts tests/unit/slug.test.ts app/r/ app/\(app\)/resume/
git commit -m "feat(share): public read-only /r/[slug] with toggle from editor"
```

---

## Task 18: Landing page + README + deploy instructions

**Files:**
- Modify: `app/page.tsx`, `README.md`
- Create: `README.md` deploy section

- [ ] **Step 1: Write landing page**

`app/page.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">intro-builder</h1>
      <p className="text-lg text-muted-foreground">
        面向互联网求职者的在线简历排版工具。登录即开始，自动保存，一键导出 PDF。
      </p>
      <Link href="/login">
        <Button size="lg">免费开始</Button>
      </Link>
    </main>
  );
}
```

- [ ] **Step 2: Write README**

`README.md`:

````markdown
# intro-builder

在线简历排版工具。Next.js 15 + Neon Postgres + Auth.js + @react-pdf/renderer。

## 本地开发

```bash
pnpm install
cp .env.example .env.local   # 填入 DATABASE_URL / AUTH_SECRET / AUTH_RESEND_KEY / AUTH_EMAIL_FROM
pnpm drizzle-kit migrate
pnpm dev
```

## Vercel 部署

1. GitHub 推到一个 repo，Vercel → Import Project。
2. Vercel → Storage → Add Neon Postgres（免费档）。自动注入 `DATABASE_URL`。
3. Resend 注册 → 验证域名 → 拿 API Key。
4. Vercel 项目环境变量：
   - `AUTH_SECRET` (`openssl rand -base64 32`)
   - `AUTH_URL` (部署后域名)
   - `AUTH_RESEND_KEY`
   - `AUTH_EMAIL_FROM` (如 `login@your-domain.com`)
5. 本地跑 `pnpm drizzle-kit migrate`（用生产 `DATABASE_URL`）初始化表。
6. Vercel Deploy。

## 目录

- `app/` — 路由与页面
- `components/editor/` — 编辑器分区组件
- `lib/templates/` — 模板（Layout 预览 + Pdf 导出）
- `db/` — Drizzle schema + migrations
- `docs/superpowers/` — 设计 spec 与实施 plan

## License

MIT
````

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx README.md
git commit -m "docs: add landing page and deploy README"
```

---

## Task 19: Final lint + typecheck + test pass + push

**Files:** none

- [ ] **Step 1: Typecheck**

```bash
pnpm tsc --noEmit
```

Expected: 0 errors. Fix any.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: 0 errors. Fix any.

- [ ] **Step 3: Full test run**

```bash
pnpm test
```

Expected: all green.

- [ ] **Step 4: Production build**

```bash
pnpm build
```

Expected: build succeeds; no warnings about missing env at build time (env checked at request).

- [ ] **Step 5: Push & create Vercel project**

```bash
git push -u origin main
pnpm dlx vercel link
pnpm dlx vercel env pull .env.local   # after adding Neon + envs via Vercel dashboard
pnpm dlx vercel --prod
```

Verify the deployed URL's `/login`, `/dashboard`, PDF download, and `/r/<slug>`.

- [ ] **Step 6: Tag release**

```bash
git tag v0.1.0
git push --tags
```

---

## Self-Review

**Spec coverage.**
- §2 stack → Task 1-3 (scaffold + deps + shadcn), Task 7 (DB), Task 8 (auth) ✅
- §4 data model → Task 7 ✅
- §5 routes → login/verify-request (9), dashboard (11), edit (12-13), preview implicit in editor, `/r/[slug]` (17), api/auth (8), api/pdf (16) ✅. **Gap fix:** `/resume/[id]/preview` listed in spec §5 not explicitly built; decision — merged into the in-editor live preview panel plus `/r/[slug]` covers standalone preview via sharing. Not a separate task needed.
- §6 flows → sign-in (8-9), save (12), export PDF (16), public share (17) ✅
- §7 templates → Task 14 (classic Layout), 15 (modern Layout), 16 (both Pdf) ✅
- §8 env → Task 5 (.env.example) + Task 18 (README) ✅
- §10 risks: Neon cold start (no explicit mitigation task — documented only; acceptable for MVP). Soft delete deferred to P1 per §11.
- §11 out-of-scope honored — no AI, no mobile polish beyond responsive editor grid, no og-image generation.

**Placeholder scan.** Searched for "TODO", "TBD", "fill in", "similar to task" — none. Every code block is complete.

**Type consistency.** `ResumeContent` shape used identically in schema, action, Layout, Pdf, route handler. `templateId` enum `"classic" | "modern"` consistent. `toggleShare` signature reconciled in Task 17 (returns `{ slug }`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-intro-builder.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution** — I execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
