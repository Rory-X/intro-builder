import type { ResumeContent } from "../schemas/resume-schema";
import { DEFAULT_SECTION_ORDER, ResumeContent as ResumeContentSchema } from "../schemas/resume-schema";
import { bulletsToDoc, emptyDoc, stringToDoc } from "../types/tiptap";
import { migrateAllFontSizes } from "./rich-text";

const PROMOTED_SECTION_IDS = ["summary", "awards", "portfolio"] as const;

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
