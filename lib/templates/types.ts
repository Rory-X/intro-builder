import type { ResumeContent, StyleSettings } from "@/lib/resume-schema";

export const BUILTIN_TEMPLATE_IDS = ["professional", "classic", "modern"] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];

/** Either a built-in id or a DB-uploaded template id. Runtime validates DB existence. */
export type TemplateId = string;

export const DEFAULT_TEMPLATE_ID: BuiltinTemplateId = "professional";

export type TemplateLayoutProps = {
  content: ResumeContent;
  sectionOrder?: string[];
  styleSettings?: StyleSettings;
  /** Editor preview: show section shells when modules have no entries yet */
  showEmptyPlaceholders?: boolean;
};

/** Backward-compat alias for code that previously imported TEMPLATE_IDS — points to the built-in ids only. */
export const TEMPLATE_IDS = BUILTIN_TEMPLATE_IDS;
