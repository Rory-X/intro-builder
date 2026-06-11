import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";

export type TemplateId = string;

export type TemplateLayoutProps = {
  content: ResumeContent;
  sectionOrder?: string[];
  styleSettings?: StyleSettings;
  /** Editor preview: show section shells when modules have no entries yet */
  showEmptyPlaceholders?: boolean;
};
