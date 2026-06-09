# Email Code Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email verification-code login as the first/default login tab, with automatic registration for new emails after successful code verification.

**Architecture:** Keep session creation inside Auth.js. A new server-side helper authorizes email-code login by verifying a one-time code, finding or creating the user, and returning the Auth.js user shape; `lib/auth.ts` exposes it through a dedicated `email-code` Credentials provider. The login page adds a two-step email-code tab before the existing magic-link and password tabs.

**Tech Stack:** Next.js 16 App Router, React 19, Auth.js v5, Drizzle ORM, Resend, Zod, Vitest, Testing Library.

---

## File Structure

- Create: `lib/email-code-login.ts`
  - Owns email normalization and valid-code user lookup/create behavior.
  - Imports `db`, `users`, `verifyCode`, and `eq`.
- Create: `tests/unit/email-code-login.test.ts`
  - Unit tests for existing-user login, new-user auto-registration, invalid code rejection, and email normalization.
- Modify: `lib/auth.ts`
  - Adds `email-code` Credentials provider that calls `authorizeEmailCodeLogin`.
- Modify: `lib/email-code.ts`
  - Supports purpose-specific email copy for login and password setup.
- Modify: `app/(app)/settings/actions.ts`
  - Calls password-purpose code email so settings copy stays correct.
- Modify: `app/(auth)/login/actions.ts`
  - Adds `sendLoginCode` and `loginWithEmailCode` actions.
- Modify: `app/(auth)/login/page.tsx`
  - Passes the two new actions into `LoginTabs`.
- Modify: `app/(auth)/login/login-tabs.tsx`
  - Adds the first/default `邮箱验证码` tab and keeps existing tabs.
- Create: `tests/unit/login-actions.test.ts`
  - Unit tests action parsing and sign-in provider selection.
- Create: `tests/unit/login-tabs.test.tsx`
  - Component tests for default tab and retained tabs.

## Task 1: Email-Code Login Core

**Files:**
- Create: `tests/unit/email-code-login.test.ts`
- Create: `lib/email-code-login.ts`
- Modify: `lib/auth.ts`

- [x] **Step 1: Write failing tests for email-code authorization**

Create `tests/unit/email-code-login.test.ts` with mocked `db` and `verifyCode`. Cover:

```ts
it("returns an existing user when the verification code is valid", async () => {
  (verifyCode as Mock).mockResolvedValue(true);
  (db.query.users.findFirst as Mock).mockResolvedValue({
    id: "u1",
    email: "alice@example.com",
    name: "Alice",
  });

  await expect(authorizeEmailCodeLogin({
    email: " Alice@Example.com ",
    code: "123456",
  })).resolves.toEqual({
    id: "u1",
    email: "alice@example.com",
    name: "Alice",
  });
});
```

Also assert:

```ts
expect(verifyCode).toHaveBeenCalledWith("alice@example.com", "123456");
```

New-user case should mock `findFirst` as `null`, mock `db.insert(users).values(...).returning()` as `[{ id: "u2", email: "new@example.com", name: null }]`, and expect an inserted `emailVerified` `Date`.

Invalid-code case should mock `verifyCode` as `false`, expect `null`, and expect no insert.

- [x] **Step 2: Run the new test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/email-code-login.test.ts
```

Expected: fails because `@/lib/email-code-login` does not exist.

- [x] **Step 3: Implement `authorizeEmailCodeLogin`**

Create `lib/email-code-login.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyCode } from "@/lib/email-code";

export type EmailCodeLoginInput = {
  email: string;
  code: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function authorizeEmailCodeLogin(input: EmailCodeLoginInput) {
  const email = normalizeEmail(input.email);
  const valid = await verifyCode(email, input.code);
  if (!valid) return null;

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return { id: existing.id, email: existing.email, name: existing.name };
  }

  const [created] = await db.insert(users).values({
    email,
    emailVerified: new Date(),
  }).returning({
    id: users.id,
    email: users.email,
    name: users.name,
  });

  if (!created) return null;
  return { id: created.id, email: created.email, name: created.name };
}
```

- [x] **Step 4: Wire Auth.js provider**

Modify `lib/auth.ts` to import `authorizeEmailCodeLogin` and add this provider before password credentials:

```ts
Credentials({
  id: "email-code",
  name: "Email Code",
  credentials: {
    email: { label: "邮箱", type: "email" },
    code: { label: "验证码", type: "text" },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.code) return null;
    return authorizeEmailCodeLogin({
      email: String(credentials.email),
      code: String(credentials.code),
    });
  },
}),
```

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/email-code-login.test.ts tests/unit/email-code.test.ts
```

Expected: both files pass.

## Task 2: Server Actions and Email Copy

**Files:**
- Modify: `tests/unit/email-code.test.ts`
- Create: `tests/unit/login-actions.test.ts`
- Modify: `lib/email-code.ts`
- Modify: `app/(app)/settings/actions.ts`
- Modify: `app/(auth)/login/actions.ts`

- [x] **Step 1: Add failing tests for login-code actions and email purpose**

In `tests/unit/login-actions.test.ts`, mock `@/lib/auth` and `@/lib/email-code`, import login actions, and assert:

```ts
await expect(sendLoginCode(formDataWith("email", "me@example.com")))
  .resolves.toEqual({ success: true });
expect(sendVerificationCode).toHaveBeenCalledWith("me@example.com", "login");

await loginWithEmailCode(formDataWith("email", "me@example.com", "code", "123456"));
expect(signIn).toHaveBeenCalledWith("email-code", {
  email: "me@example.com",
  code: "123456",
  redirectTo: "/dashboard",
});
```

Add invalid-input expectations:

```ts
await expect(sendLoginCode(formDataWith("email", "bad")))
  .resolves.toEqual({ success: false, error: "请输入有效邮箱" });
await expect(loginWithEmailCode(formDataWith("email", "me@example.com", "code", "12")))
  .rejects.toThrow("invalid-input");
```

In `tests/unit/email-code.test.ts`, add a mocked Resend send test that verifies login copy contains `登录 intro-builder` and password copy contains `设置或修改密码`.

- [x] **Step 2: Run action/helper tests and verify RED**

Run:

```bash
pnpm vitest run tests/unit/login-actions.test.ts tests/unit/email-code.test.ts
```

Expected: fails because the new actions and email purpose API do not exist.

- [x] **Step 3: Update `sendVerificationCode` purpose**

Modify `lib/email-code.ts`:

```ts
export type VerificationCodePurpose = "login" | "password";

export async function sendVerificationCode(
  email: string,
  purpose: VerificationCodePurpose = "password",
): Promise<void> {
  const code = generateCode();
  await saveVerificationCode(email, code);
  const resend = getResendClient();
  const isLogin = purpose === "login";

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: isLogin ? "intro-builder 登录验证码" : "intro-builder 验证码",
    html: `...`,
  });
}
```

Keep the existing lazy `AUTH_RESEND_KEY` behavior.

- [x] **Step 4: Update settings action**

Change `app/(app)/settings/actions.ts`:

```ts
await sendVerificationCode(session.user.email, "password");
```

- [x] **Step 5: Add login actions**

Modify `app/(auth)/login/actions.ts`:

```ts
import { sendVerificationCode } from "@/lib/email-code";

const LoginCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

export async function sendLoginCode(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const parsed = EmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { success: false, error: "请输入有效邮箱" };
  }
  try {
    await sendVerificationCode(parsed.data.email.trim().toLowerCase(), "login");
    return { success: true };
  } catch (error) {
    console.error("[sendLoginCode]", error);
    return { success: false, error: "验证码发送失败，请稍后重试" };
  }
}

export async function loginWithEmailCode(formData: FormData): Promise<void> {
  const parsed = LoginCodeSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  });
  if (!parsed.success) {
    throw new Error("invalid-input");
  }
  await signIn("email-code", {
    email: parsed.data.email.trim().toLowerCase(),
    code: parsed.data.code,
    redirectTo: "/dashboard",
  });
}
```

- [x] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/login-actions.test.ts tests/unit/email-code.test.ts
```

Expected: both files pass.

## Task 3: Login UI Tabs

**Files:**
- Create: `tests/unit/login-tabs.test.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/login/login-tabs.tsx`

- [x] **Step 1: Write failing UI tests**

Create `tests/unit/login-tabs.test.tsx` with Testing Library. Render `LoginTabs` with mocked async actions and assert:

```ts
expect(screen.getByRole("button", { name: "邮箱验证码" })).toHaveClass("bg-background");
expect(screen.getByText("发送验证码")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "魔法链接" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "密码登录" })).toBeInTheDocument();
```

Add a second test that submits an email in the code tab, waits for success copy `验证码已发送`, then sees the `6 位数字验证码` input and `登录 / 注册` button.

- [x] **Step 2: Run UI test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/login-tabs.test.tsx
```

Expected: fails because `LoginTabs` does not accept or render email-code actions.

- [x] **Step 3: Pass new actions from the page**

Modify `app/(auth)/login/page.tsx`:

```tsx
import { sendLoginLink, loginWithPassword, sendLoginCode, loginWithEmailCode } from "./actions";

<LoginTabs
  sendLoginCode={sendLoginCode}
  loginWithEmailCode={loginWithEmailCode}
  sendLoginLink={sendLoginLink}
  loginWithPassword={loginWithPassword}
/>
```

- [x] **Step 4: Add the email-code tab UI**

Modify `app/(auth)/login/login-tabs.tsx`:

```ts
type LoginTab = "code" | "magic" | "password";
const [tab, setTab] = useState<LoginTab>("code");
```

Extend props:

```ts
sendLoginCode: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
loginWithEmailCode: (formData: FormData) => Promise<void>;
```

Render tab buttons in this order:

```tsx
{(["code", "magic", "password"] as const).map(...)}
```

Render a code form with:

- Email input and `发送验证码` button in the first state.
- Locked email text, code input, `登录 / 注册` button, and `修改邮箱` action in the second state.
- Inline error text for invalid send/login responses.

- [x] **Step 5: Run UI test and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/login-tabs.test.tsx
```

Expected: passes.

## Task 4: Required Verification

**Files:**
- Modify this plan file checkbox statuses as tasks complete.

- [x] **Step 1: Install dependencies if needed and read Next.js 16 docs**

If `node_modules/next/dist/docs` is missing, run:

```bash
pnpm install --frozen-lockfile
```

Then read the relevant Next.js route/server-action docs under `node_modules/next/dist/docs/` before finalizing code.

- [x] **Step 2: Run focused auth/login tests**

Run:

```bash
pnpm vitest run tests/unit/email-code-login.test.ts tests/unit/email-code.test.ts tests/unit/login-actions.test.ts tests/unit/login-tabs.test.tsx
```

Expected: all pass.

- [x] **Step 3: Run full local gates**

Run:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Expected: all pass.

- [x] **Step 4: Manual smoke**

Run:

```bash
pnpm dev
```

Open `/login` and verify:

- `邮箱验证码` is selected by default.
- `魔法链接` and `密码登录` tabs still render.
- Sending a code transitions to the code-entry state.

Use a real Resend environment only if credentials are available; otherwise stop at UI smoke and report that email delivery was not manually exercised.

Result on 2026-06-09:

- `pnpm dev --hostname 127.0.0.1` started on `http://127.0.0.1:3000`.
- `curl -I http://127.0.0.1:3000/login` returned `HTTP/1.1 200 OK`.
- `curl http://127.0.0.1:3000/login` contained `邮箱验证码`, `魔法链接`, `密码登录`, and `发送验证码`.
- Auth.js logged `MissingSecret` because local auth env vars are not configured in this worktree.
- Real email delivery was not manually exercised because Resend credentials are not configured locally; the code-entry transition is covered by `tests/unit/login-tabs.test.tsx`.

## Self-Review

- Spec coverage: all design goals map to Task 1, Task 2, or Task 3.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation placeholders.
- Type consistency: `sendLoginCode`, `loginWithEmailCode`, `authorizeEmailCodeLogin`, and `email-code` provider names are consistent across tasks.
