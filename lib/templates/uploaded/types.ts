import type { ResumeHeaderVariant } from "@/lib/templates/shared/resume-header";
import type { ResumeSectionVariant } from "@/lib/templates/shared/resume-section";

export type DecorationConfig = {
  bgImageUrl: string;
  placement: {
    position: "absolute";
    top: string;
    right: string;
    width: string;
    height: string;
    zIndex: number;
    opacity: number;
  };
  pageBgColor?: string;
};

export type LayoutConfig = {
  headerVariant: ResumeHeaderVariant;
  sectionTitleVariant: ResumeSectionVariant;
  itemHeaderVariant: "professional" | "classic" | "modern";
  theme: {
    primaryColor: string;
    accentColor?: string;
    cardBg?: string;
    cardRadius?: string;
    cardShadow?: string;
    fontFamily?: string;
  };
  sectionIcons: Record<string, string>;
};

export type UploadedTemplate = {
  id: string;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  decoration: DecorationConfig | null;
  layout: LayoutConfig;
};
