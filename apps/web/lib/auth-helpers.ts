import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Dev escape hatch: when running locally with `AUTH_DEV_BYPASS=1` *and* a
 * concrete `AUTH_DEV_USER_ID` provided, skip the magic-link round-trip
 * and pretend we're logged in as that user. The id must exist in the
 * `users` table.
 *
 * **Critical**: real session takes priority. If a user is actually logged
 * in (their real account), we return their real id — dev bypass MUST NOT
 * override a real session, otherwise real users see dev-user's data and
 * their own data appears to vanish.
 *
 * Production (NODE_ENV !== "development") never enters the bypass branch.
 */
function devBypassUserId(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  if (process.env.AUTH_DEV_BYPASS !== "1") return null;
  const id = process.env.AUTH_DEV_USER_ID;
  return id && id.trim() ? id : null;
}

export async function requireUserId(): Promise<string> {
  // Real session first — never override an actual logged-in user.
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  // No session: dev bypass kicks in only if explicitly enabled.
  const devId = devBypassUserId();
  if (devId) return devId;
  redirect("/login");
}

/**
 * Non-redirecting userId lookup for API routes (no DB hit). Returns the
 * id from a real session if there is one; otherwise the dev-bypass id if
 * enabled; otherwise null. Use this in route handlers (`/api/*`) where a
 * 401 is the right response and a redirect would break the client. UI
 * surfaces that need email/name should use {@link currentUser} instead.
 */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  return devBypassUserId();
}

/**
 * Non-redirecting current-user lookup for UI surfaces (header, links) that
 * need to show a different state when logged in but should NOT redirect.
 * Returns null when neither a real session nor dev bypass yields a user.
 *
 * In dev bypass mode, NextAuth's `auth()` returns null because there's no
 * real session — without this helper, the header would render the
 * logged-out variant (showing the 登录 button + hiding the 模板库 link)
 * even though page-level `requireUserId()` happily lets the user in. The
 * resulting "logged-in pages with logged-out chrome" UI is confusing
 * during local dev. Falling back to a DB lookup keeps the chrome honest
 * about who's authenticated.
 */
export async function currentUser(): Promise<{
  id: string;
  email: string | null;
  name: string | null;
} | null> {
  const session = await auth();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    };
  }
  const devId = devBypassUserId();
  if (!devId) return null;
  // Real session beat us to it above; this path only runs when bypass is
  // the only signal. Hit the DB once to surface the actual dev account's
  // email/name in chrome — nicer than synthetic placeholders that hide
  // which dev account is loaded.
  const row = await db.query.users.findFirst({ where: eq(users.id, devId) });
  if (!row) return { id: devId, email: null, name: null };
  return { id: row.id, email: row.email ?? null, name: row.name ?? null };
}
