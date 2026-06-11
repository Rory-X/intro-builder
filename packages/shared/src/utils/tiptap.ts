import type { ResumeContent } from "../schemas/resume-schema";
import { DEFAULT_SECTION_ORDER, ResumeContent as ResumeContentSchema } from "../schemas/resume-schema";
import { bulletsToDoc, emptyDoc, stringToDoc } from "../types/tiptap";

/** Base font size (px) used to calculate em values */
const RICH_TEXT_BASE_PX = 13;

/**
 * Convert a px font-size string (e.g. "14px") to em relative to the base.
 * Returns undefined if the value equals the default (1em) so the mark can be removed.
 */
function pxToEm(pxValue: string): string | undefined {
  const match = pxValue.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) return undefined;
  const px = parseFloat(match[1]);
  const em = Math.round((px / RICH_TEXT_BASE_PX) * 100) / 100;
  if (em === 1) return undefined;
  return `${em}em`;
}

/**
 * Recursively migrate textStyle fontSize marks from px to em in TipTap JSON.
 */
function migrateFontSizeMarks(node: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(node.marks)) {
    node.marks = (node.marks as Record<string, unknown>[])
      .map((mark) => {
        if (mark.type !== "textStyle") return mark;
        const attrs = mark.attrs as Record<string, unknown> | undefined;
        if (!attrs || typeof attrs.fontSize !== "string") return mark;
        const fontSize = attrs.fontSize as string;
        if (fontSize.endsWith("em")) return mark;
        const emValue = pxToEm(fontSize);
        if (!emValue) {
          const restAttrs = Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "fontSize"),
          );
          if (Object.keys(restAttrs).length === 0) return null;
          return { ...mark, attrs: restAttrs };
        }
        return { ...mark, attrs: { ...attrs, fontSize: emValue } };
      })
      .filter(Boolean);
    if ((node.marks as unknown[]).length === 0) delete node.marks;
  }

  if (Array.isArray(node.content)) {
    node.content = (node.content as Record<string, unknown>[]).map(migrateFontSizeMarks);
  }

  return node;
}

/**
 * Migrate all TipTap JSON docs in the resume content from px to em font sizes.
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
 * Promote named preset modules out of legacy custom[] into top-level fields.
 */
const PROMOTED_SECTION_IDS = ["summary", "awards", "portfolio"] as const;

function promoteNamedSections(migrated: Record<string, unknown>): void {
  const custom = Array.isArray(migrated.custom)
    ? (migrated.custom as Record<string, unknown>[])
    : [];
  const remaining: Record<string, unknown>[] = [];
  for (const c of custom) {
    const cid = c.id as string;
    if ((PROMOTED_SECTION_IDS as readonly string[]).includes(cid)) {
      const existing = migrated[cid];
      const existingHasContent =
        existing &&
        typeof existing === "object" &&
        Array.isArray((existing as Record<string, unknown>).content) &&
        ((existing as Record<string, unknown>).content as unknown[]).length > 0;
      if (!existingHasContent && c.content && typeof c.content === "object") {
        migrated[cid] = c.content;
      }
    } else {
      remaining.push(c);
    }
  }
  migrated.custom = remaining;
}

/**
 * Transparently upgrade legacy content to current schema.
 */
export function migrateContent(raw: unknown): ResumeContent {
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const experience = Array.isArray(obj.experience)
    ? obj.experience.map((e: Record<string, unknown>) => {
        if (e.content && typeof e.content === "object") return e;
        const bullets = Array.isArray(e.bullets) ? (e.bullets as string[]) : [];
        const rest = { ...e };
        delete rest.bullets;
        return { ...rest, content: bulletsToDoc(bullets) };
      })
    : [];

  const projects = Array.isArray(obj.projects)
    ? obj.projects.map((p: Record<string, unknown>) => {
        if (p.content && typeof p.content === "object") return p;
        const bullets = Array.isArray(p.bullets) ? (p.bullets as string[]) : [];
        const rest = { ...p };
        delete rest.bullets;
        return { ...rest, content: bulletsToDoc(bullets) };
      })
    : [];

  const education = Array.isArray(obj.education)
    ? obj.education.map((e: Record<string, unknown>) => {
        if (e.highlights && typeof e.highlights === "object" && !Array.isArray(e.highlights)) return e;
        const highlights = Array.isArray(e.highlights) ? (e.highlights as string[]) : [];
        return { ...e, highlights: highlights.length > 0 ? bulletsToDoc(highlights) : emptyDoc() };
      })
    : [];

  const custom = Array.isArray(obj.custom)
    ? obj.custom.map((c: Record<string, unknown>, idx: number) => {
        if (c.id && typeof c.id === "string" && c.content && typeof c.content === "object") return c;
        const id = typeof c.id === "string" ? c.id : `custom_${idx}`;
        const title = typeof c.title === "string" ? c.title : "";
        const content = typeof c.content === "string" ? stringToDoc(c.content) : emptyDoc();
        return { id, title, content };
      })
    : [];

  let sectionOrder: string[];
  if (Array.isArray(obj.sectionOrder)) {
    sectionOrder = (obj.sectionOrder as string[]).filter(k => k !== "custom");
    for (const c of custom) {
      const cId = (c as Record<string, unknown>).id as string;
      if (cId && !sectionOrder.includes(cId)) {
        sectionOrder.push(cId);
      }
    }
  } else {
    sectionOrder = [...DEFAULT_SECTION_ORDER];
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

  migrateAllFontSizes(migrated);
  promoteNamedSections(migrated);
  sanitizeStyleSettings(migrated);

  return ResumeContentSchema.parse(migrated);
}
