import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";
import { ProfessionalLayout } from "@/lib/templates/professional/Layout";
import { resolveTemplateId, type TemplateId } from "@/lib/templates/registry";

type Props = TemplateLayoutProps & {
  templateId: TemplateId | string;
};

export function TemplateRenderer({ templateId, ...layoutProps }: Props) {
  const resolved = resolveTemplateId(templateId);

  switch (resolved) {
    case "classic":
      return <ClassicLayout {...layoutProps} />;
    case "modern":
      return <ModernLayout {...layoutProps} />;
    case "professional":
    default:
      return <ProfessionalLayout {...layoutProps} />;
  }
}
