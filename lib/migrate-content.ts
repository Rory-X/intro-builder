import type { ResumeContent } from "./resume-schema";
import { DEFAULT_SECTION_ORDER, ResumeContent as ResumeContentSchema } from "./resume-schema";
import { bulletsToDoc, emptyDoc, stringToDoc } from "./tiptap-types";
import { RICH_TEXT_BASE_PX } from "./rich-text-prose";

/**
 * Convert a px font-size string (e.g. "14px") to em relative to the base.
 * Returns undefined if the value equals the default (1em) so the mark can be removed.
 */
function pxToEm(pxValue: string): string | undefined {
  const match = pxValue.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) return undefined; // not a px value, leave unchanged
  const px = parseFloat(match[1]);
  const em = Math.round((px / RICH_TEXT_BASE_PX) * 100) / 100;
  if (em === 1) return undefined; // default size → remove mark
  return `${em}em`;
}

/**
 * Recursively migrate textStyle fontSize marks from px to em in TipTap JSON.
 */
function migrateFontSizeMarks(node: Record<string, unknown>): Record<string, unknown> {
  // Process marks on text nodes
  if (Array.isArray(node.marks)) {
    node.marks = (node.marks as Record<string, unknown>[])
      .map((mark) => {
        if (mark.type !== "textStyle") return mark;
        const attrs = mark.attrs as Record<string, unknown> | undefined;
        if (!attrs || typeof attrs.fontSize !== "string") return mark;
        const fontSize = attrs.fontSize as string;
        // Already em? skip
        if (fontSize.endsWith("em")) return mark;
        // Convert px → em
        const emValue = pxToEm(fontSize);
        if (!emValue) {
          // Default size — remove fontSize attr; if no other attrs, remove the mark entirely
          const restAttrs = Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "fontSize"),
          );
          if (Object.keys(restAttrs).length === 0) return null; // remove mark
          return { ...mark, attrs: restAttrs };
        }
        return { ...mark, attrs: { ...attrs, fontSize: emValue } };
      })
      .filter(Boolean);
    // If marks array is empty after filtering, remove it
    if ((node.marks as unknown[]).length === 0) delete node.marks;
  }

  // Recurse into content
  if (Array.isArray(node.content)) {
    node.content = (node.content as Record<string, unknown>[]).map(migrateFontSizeMarks);
  }

  return node;
}

/**
 * Migrate all TipTap JSON docs in the resume content (experience.content,
 * projects.content, education.highlights, custom.content) from px to em font sizes.
 */
function migrateAllFontSizes(obj: Record<string, unknown>): void {
  const experience = obj.experience as Record<string, unknown>[] | undefined;
  if (Array.isArray(experience)) {
    for (const e of experience) {
      if (e.content && typeof e.content === "object") {
        migrateFontSizeMarks(e.content as Record<string, unknown>);
      }
    }
  }
  const projects = obj.projects as Record<string, unknown>[] | undefined;
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (p.content && typeof p.content === "object") {
        migrateFontSizeMarks(p.content as Record<string, unknown>);
      }
    }
  }
  const education = obj.education as Record<string, unknown>[] | undefined;
  if (Array.isArray(education)) {
    for (const e of education) {
      if (e.highlights && typeof e.highlights === "object") {
        migrateFontSizeMarks(e.highlights as Record<string, unknown>);
      }
    }
  }
  const custom = obj.custom as Record<string, unknown>[] | undefined;
  if (Array.isArray(custom)) {
    for (const c of custom) {
      if (c.content && typeof c.content === "object") {
        migrateFontSizeMarks(c.content as Record<string, unknown>);
      }
    }
  }
}

/**
 * Clamp legacy styleSettings numeric fields to current schema bounds.
 *
 * 为什么需要：smart-layout v2 把 schema MIN 从 10/1.2/20 压低到 8/1.05/8 +
 * 加了 sectionGap/itemGap。如果用户在新 schema 下点智能排版让 fontSize 压到
 * 8，autosave 写到 DB；之后 dev server hot reload 不完全或回滚部署，schema
 * 变回旧 min=10，下次 load 时 ZodError。clamp 兜底让 parse 永远不挂。
 *
 * 这里的 [min, max] 必须和 lib/resume-schema.ts 里 StyleSettings 的 min/max
 * 一致 —— 改 schema 时同步改这里。冗余但解耦：schema 不暴露 min/max 元数据。
 */
function sanitizeStyleSettings(obj: Record<string, unknown>): void {
  const ss = obj.styleSettings;
  if (!ss || typeof ss !== "object") return;
  const settings = ss as Record<string, unknown>;
  const clamps: Array<[string, number, number]> = [
    ["fontSize", 8, 16],
    ["lineHeight", 1.05, 2.0],
    ["pagePadding", 8, 60],
    ["sectionGap", 4, 24],
    ["itemGap", 2, 16],
  ];
  for (const [key, min, max] of clamps) {
    const val = settings[key];
    if (typeof val === "number") {
      settings[key] = Math.max(min, Math.min(max, val));
    }
  }
}

/**
 * Transparently upgrade legacy content to current schema.
 * Handles: v1 bullets→TipTapJSON, old custom string→TipTapJSON, missing fields.
 * Pure function — no side effects.
 */
export function migrateContent(raw: unknown): ResumeContent {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  // Migrate experience
  const experience = Array.isArray(obj.experience)
    ? obj.experience.map((e: Record<string, unknown>) => {
        if (e.content && typeof e.content === "object") return e; // already v2
        const bullets = Array.isArray(e.bullets) ? (e.bullets as string[]) : [];
        const rest = { ...e };
        delete rest.bullets;
        return { ...rest, content: bulletsToDoc(bullets) };
      })
    : [];

  // Migrate projects
  const projects = Array.isArray(obj.projects)
    ? obj.projects.map((p: Record<string, unknown>) => {
        if (p.content && typeof p.content === "object") return p; // already v2
        const bullets = Array.isArray(p.bullets) ? (p.bullets as string[]) : [];
        const rest = { ...p };
        delete rest.bullets;
        return { ...rest, content: bulletsToDoc(bullets) };
      })
    : [];

  // Migrate education highlights
  const education = Array.isArray(obj.education)
    ? obj.education.map((e: Record<string, unknown>) => {
        if (e.highlights && typeof e.highlights === "object" && !Array.isArray(e.highlights)) return e; // already v2 TipTapJSON
        const highlights = Array.isArray(e.highlights) ? (e.highlights as string[]) : [];
        return { ...e, highlights: highlights.length > 0 ? bulletsToDoc(highlights) : emptyDoc() };
      })
    : [];

  // Migrate custom sections: old format was {title, content: string}, new is {id, title, content: TipTapJSON}
  const custom = Array.isArray(obj.custom)
    ? obj.custom.map((c: Record<string, unknown>, idx: number) => {
        // Already new format (has id and content is object)
        if (c.id && typeof c.id === "string" && c.content && typeof c.content === "object") return c;
        // Old format: {title: string, content: string}
        const id = typeof c.id === "string" ? c.id : `custom_${idx}`;
        const title = typeof c.title === "string" ? c.title : "";
        const content = typeof c.content === "string" ? stringToDoc(c.content) : emptyDoc();
        return { id, title, content };
      })
    : [];

  // Add sectionOrder if missing; also clean up old "custom" entry
  let sectionOrder: string[];
  if (Array.isArray(obj.sectionOrder)) {
    // Remove the old catch-all "custom" key if present, replace with actual custom section IDs
    sectionOrder = (obj.sectionOrder as string[]).filter(k => k !== "custom");
    // Add custom section IDs that aren't already in order
    for (const c of custom) {
      const cId = (c as Record<string, unknown>).id as string;
      if (cId && !sectionOrder.includes(cId)) {
        sectionOrder.push(cId);
      }
    }
  } else {
    sectionOrder = [...DEFAULT_SECTION_ORDER];
    // Add any custom section IDs
    for (const c of custom) {
      const cId = (c as Record<string, unknown>).id as string;
      if (cId) sectionOrder.push(cId);
    }
  }

  const migrated = {
    ...obj,
    experience,
    projects,
    education,
    custom,
    sectionOrder,
  };

  // Migrate any px font sizes in rich text to em (relative) units
  migrateAllFontSizes(migrated);

  // Clamp legacy styleSettings numeric fields to current schema bounds
  sanitizeStyleSettings(migrated);

  return ResumeContentSchema.parse(migrated);
}
