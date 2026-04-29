import type { ResumeContent } from "./resume-schema";
import { DEFAULT_SECTION_ORDER, ResumeContent as ResumeContentSchema } from "./resume-schema";
import { bulletsToDoc, emptyDoc, stringToDoc } from "./tiptap-types";

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
        const { bullets: _bullets, ...rest } = e;
        return { ...rest, content: bulletsToDoc(bullets) };
      })
    : [];

  // Migrate projects
  const projects = Array.isArray(obj.projects)
    ? obj.projects.map((p: Record<string, unknown>) => {
        if (p.content && typeof p.content === "object") return p; // already v2
        const bullets = Array.isArray(p.bullets) ? (p.bullets as string[]) : [];
        const { bullets: _bullets, ...rest } = p;
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

  return ResumeContentSchema.parse(migrated);
}
