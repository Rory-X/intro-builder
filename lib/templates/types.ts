import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";

export const TEMPLATE_IDS = ["professional", "classic", "modern"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const DEFAULT_TEMPLATE_ID: TemplateId = "professional";

export type TemplateLayoutProps = {
  content: ResumeContent;
  sectionOrder?: string[];
  styleSettings?: StyleSettings;
  /** Editor preview: show section shells when modules have no entries yet */
  showEmptyPlaceholders?: boolean;
};
