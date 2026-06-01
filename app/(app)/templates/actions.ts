"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { templateFavorites } from "@/db/schema";

/**
 * Dev bypass mirror of `requireUserId` for server actions. Real session takes
 * priority; dev bypass only kicks in locally with both env flags set. Mirrors
 * the helper in app/(app)/resume/[id]/edit/actions.ts — each action file keeps
 * its own copy so it can stay a private, throw-on-unauthorized boundary.
 */
async function actionUserId(): Promise<string> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;
  if (
    process.env.NODE_ENV === "development" &&
    process.env.AUTH_DEV_BYPASS === "1" &&
    process.env.AUTH_DEV_USER_ID
  ) {
    return process.env.AUTH_DEV_USER_ID;
  }
  throw new Error("unauthorized");
}

/**
 * Add or remove a template from the current user's favorites.
 *
 * `templateId` is stored as a plain string — it can be either a builtin id
 * (professional / classic / modern, which live only in registry.ts, NOT the
 * templates table) or an uploaded template's uuid. The favorites table
 * deliberately has no FK to templates, so both work; see db/schema.ts.
 *
 * insert uses onConflictDoNothing against the (userId, templateId) unique
 * index so a double-click can't 500 on a duplicate-key error.
 */
export async function toggleTemplateFavorite(
  templateId: string,
  favorite: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const userId = await actionUserId();
    if (favorite) {
      await db
        .insert(templateFavorites)
        .values({ userId, templateId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(templateFavorites)
        .where(
          and(
            eq(templateFavorites.userId, userId),
            eq(templateFavorites.templateId, templateId),
          ),
        );
    }
    revalidatePath("/templates");
    return { success: true };
  } catch (error) {
    console.error("[toggleTemplateFavorite] failed:", error);
    const message = error instanceof Error ? error.message : "未知错误";
    return { success: false, error: message };
  }
}

/**
 * Returns the templateIds the given user has favorited. Used by the templates
 * page (server component) to seed the client's initial favorite state.
 */
export async function getFavoriteTemplateIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ templateId: templateFavorites.templateId })
    .from(templateFavorites)
    .where(eq(templateFavorites.userId, userId));
  return rows.map((r) => r.templateId);
}
