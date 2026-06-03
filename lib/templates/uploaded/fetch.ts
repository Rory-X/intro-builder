import { db } from "@/db";
import { templates } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { UploadedTemplate } from "./types";
import type { UploadedTemplate as UploadedTemplateType } from "./types";

/**
 * Defensive: if the DB doesn't have the `templates` table yet (migration
 * hasn't run, or we're booting against a partially-provisioned env), we
 * silently return an empty result instead of crashing the dashboard /
 * editor. Other operational errors still warn but don't bubble up — the
 * app keeps working with built-in templates only. Run the migration to
 * unlock uploaded templates.
 */
function isMissingTableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /relation .*templates.* does not exist|no such table/i.test(msg);
}

/**
 * Neon HTTP fetch from China to ap-southeast-1 occasionally hits ECONNRESET
 * / TLS handshake reset / "fetch failed". These are transport-level hiccups,
 * not real DB failures — retrying with brief backoff usually succeeds. Without
 * retry every flaky page load drops uploaded templates to [] and the picker
 * silently shows only built-ins.
 */
function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg =
    err instanceof Error && (err as Error & { cause?: { code?: string; message?: string } }).cause
      ? `${(err as Error & { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${
          (err as Error & { cause?: { code?: string; message?: string } }).cause?.message ?? ""
        }`
      : "";
  return /fetch failed|ECONNRESET|socket disconnected|network socket|TLS|handshake/i.test(
    msg + " " + causeMsg,
  );
}

async function withTransientRetry<T>(label: string, fn: () => Promise<T>, max = 3): Promise<T> {
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === max || !isTransientNetworkError(err)) throw err;
      const delay = 200 * 2 ** (i - 1);
      console.warn(`[templates] ${label} attempt ${i}/${max} hit transient — retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export async function fetchUploadedTemplate(
  id: string,
  opts: { includeDrafts?: boolean } = {},
): Promise<UploadedTemplateType | null> {
  // 默认只返回 published —— 编辑器 / dashboard 不应看到 draft。dev-preview
  // 路由通过 includeDrafts:true 旁路这条规则，让 skill 在入库前看到
  // status='draft' 的待审模板。这是 dev-only 入口，没有外部触发面。
  const statusFilter = opts.includeDrafts
    ? undefined
    : eq(templates.status, "published");
  const where = statusFilter
    ? and(eq(templates.id, id), statusFilter)
    : eq(templates.id, id);
  try {
    const rows = await withTransientRetry("fetchUploadedTemplate", () =>
      db.select().from(templates).where(where).limit(1),
    );
    if (rows.length === 0) return null;
    return parseTemplateRow(rows[0]);
  } catch (err) {
    if (isMissingTableError(err)) return null;
    console.warn("[templates] fetchUploadedTemplate failed:", err);
    return null;
  }
}

export async function listUploadedTemplates(): Promise<UploadedTemplateType[]> {
  try {
    const rows = await withTransientRetry("listUploadedTemplates", () =>
      db
        .select()
        .from(templates)
        .where(eq(templates.status, "published"))
        .orderBy(templates.createdAt),
    );
    // 单条坏行不击穿整页：每行独立 safeParse，失败 skip + warn，不 throw。
    return rows
      .map(parseTemplateRow)
      .filter((t): t is UploadedTemplateType => t !== null);
  } catch (err) {
    if (isMissingTableError(err)) return [];
    console.warn("[templates] listUploadedTemplates failed:", err);
    return [];
  }
}

/**
 * Trust boundary: jsonb 是任意 JSON，TS 类型只是"标注信任"，runtime 完全
 * 不校验。Skill / seed 写端虽然 validate 过形状，但 (a) 历史数据可能在
 * schema 演进前就入库，(b) 直接 SQL UPDATE 绕过 Skill。这里用 Zod
 * `safeParse` 兜底——校验失败时记 warn 并跳过该行，让 UploadedLayout
 * 永远不会拿到 corrupt 数据导致整页 React error。
 *
 * 暴露 export 是为了让单测能直接调，无需 mock 整个 Drizzle。
 */
export function parseTemplateRow(
  row: typeof templates.$inferSelect,
): UploadedTemplateType | null {
  const candidate = {
    id: row.id,
    name: row.name,
    description: row.description,
    thumbnailUrl: row.thumbnailUrl,
    decoration: row.decoration,
    layout: row.layout,
    // v2 统一路径：优先读新字段 html/css，fallback 旧字段 customHtml/customCss
    customHtml: row.html ?? row.customHtml,
    customCss: row.css ?? row.customCss,
    category: row.category,
    features: row.features,
  };
  const result = UploadedTemplate.safeParse(candidate);
  if (!result.success) {
    console.warn(
      `[templates] parseTemplateRow rejected id=${row.id}:`,
      result.error.flatten(),
    );
    return null;
  }
  // Attach templateLayout for sidebar sections (v2 unified path)
  const parsed = result.data as UploadedTemplateType & { templateLayout?: unknown };
  parsed.templateLayout = row.templateLayout;
  return parsed;
}
