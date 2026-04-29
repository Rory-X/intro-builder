import type { ResumeContent } from "./resume-schema";
import { DEFAULT_SECTION_ORDER, ResumeContent as ResumeContentSchema } from "./resume-schema";
import { bulletsToDoc, emptyDoc } from "./tiptap-types";

/**
 * Transparently upgrade v1 (bullets: string[]) content to v2 (content: TipTapJSON).
 * If already v2, returns parsed v2. Pure function — no side effects.
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

  // Add sectionOrder if missing
  const sectionOrder = Array.isArray(obj.sectionOrder)
    ? obj.sectionOrder
    : [...DEFAULT_SECTION_ORDER];

  const migrated = {
    ...obj,
    experience,
    projects,
    education,
    sectionOrder,
  };

  return ResumeContentSchema.parse(migrated);
}
