# Email Code Login Design

## Status

Approved direction from product discussion on 2026-06-09: add email verification-code login as the first and default login tab. Keep the existing magic-link and password login options.

## Problem

intro-builder currently supports Resend magic-link login and password login. Magic links work, but they force users to switch context into email and click a link. Chinese internet products commonly use short numeric email or phone verification codes as the fastest login path.

The login page should let a user enter an email, receive a 6-digit code, and log in by typing that code. If the email does not belong to an existing user, the same successful verification should create the user and start a session. The user should not need to choose a separate registration flow.

## Goals

- Add `邮箱验证码` as the first login tab and make it the default selected tab.
- Keep `魔法链接` as a secondary login tab.
- Keep `密码登录` as a secondary login tab.
- Let existing users log in with email plus a valid verification code.
- Let new users register and log in with email plus a valid verification code.
- Reuse Auth.js session creation and callbacks instead of hand-writing session cookies.
- Reuse the existing `verificationToken` table and one-time-code helpers.
- Keep user-facing copy in Chinese.

## Non-Goals

- Do not add phone-number login.
- Do not remove magic-link login.
- Do not remove password login.
- Do not add password setup during registration.
- Do not add rate limiting in this slice beyond replacing any previous code for the same email.
- Do not change database schema.

## Decision

Use a dedicated Auth.js Credentials provider for email-code login.

The provider receives `email` and `code`, verifies and consumes the code, looks up the user by email, creates a user when none exists, sets `emailVerified` for newly verified users, and returns the user object to Auth.js. Auth.js then issues the same JWT session used by existing credentials login.

This keeps all login methods behind Auth.js and avoids a custom session path.

## Options Considered

| Option | Shape | Pros | Cons | Decision |
| --- | --- | --- | --- | --- |
| A. Auth.js email-code credentials provider | Server action sends code; Credentials provider verifies code, creates user if missing, and returns user | Reuses existing Auth.js session flow; no schema change; easy to test | Needs provider branching inside `lib/auth.ts` | Choose |
| B. Custom server-action session creation | Server action verifies code and writes session cookies directly | Could be very direct | Splits session behavior from Auth.js callbacks and adapters | Reject |
| C. Magic-link-only UX | Keep Resend provider and present it as verification-code login | Minimal code | Does not satisfy typing a verification code | Reject |

## User Experience

The login page tab order is:

1. `邮箱验证码`
2. `魔法链接`
3. `密码登录`

`邮箱验证码` is selected by default.

The email-code tab has two states:

1. Email state: user enters email and clicks `发送验证码`.
2. Code state: user sees the locked email address, enters a 6-digit code, and clicks `登录 / 注册`.

The code state includes a small action to edit the email address. Invalid input or a bad code shows an inline Chinese error. A successful login redirects to `/dashboard`.

For privacy, the UI must not reveal whether an email is already registered. New-account and existing-account success look the same to the user.

## Server Behavior

`sendLoginCode(formData)`:

- Parses `email` with Zod.
- Sends a verification code email for login.
- Returns a structured result instead of throwing for user-correctable errors.

`loginWithEmailCode(formData)`:

- Parses `email` and a 6-digit `code` with Zod.
- Calls `signIn("email-code", { email, code, redirectTo: "/dashboard" })`.
- Lets Auth.js redirect on success.
- Lets the client show `验证码无效或已过期` on failed credentials.

The new Auth.js provider:

- Normalizes email by trimming and lowercasing before lookup/storage.
- Calls `verifyCode(email, code)`.
- Returns `null` when the code is invalid or expired.
- Finds an existing user by email and returns it.
- Creates a user with `email` and `emailVerified: new Date()` when no user exists.

## Email Code Helper Behavior

`lib/email-code.ts` remains the shared helper for settings password verification and login verification. It should support purpose-specific email copy so password setup does not send login wording and login does not send password-setting wording.

The existing code storage remains one-time and 5 minutes:

- Saving a new code deletes older codes for that email.
- Verification deletes a valid code after use.
- Expired verification deletes the expired code and fails.

## Testing

Add tests before implementation for:

- Email-code provider logs in an existing user when the code is valid.
- Email-code provider creates and logs in a new user when the code is valid.
- Email-code provider rejects invalid or expired codes.
- Login UI defaults to the `邮箱验证码` tab.
- Login UI keeps `魔法链接` and `密码登录` tabs available.

Keep the existing email-code import test because build-time import must not require `AUTH_RESEND_KEY`.

## Verification

Before claiming completion:

```bash
pnpm test
pnpm tsc --noEmit
pnpm lint
pnpm build
```

Manual smoke for this slice:

- Start `pnpm dev`.
- Open `/login`.
- Confirm `邮箱验证码` is the first selected tab.
- Request a code for an unregistered email and log in with the code.
- Log out, request a code for the same email, and log in again.
- Confirm `魔法链接` and `密码登录` tabs still render.
