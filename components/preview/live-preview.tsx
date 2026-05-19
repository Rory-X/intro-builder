"use client";

import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { PreviewPanel } from "./preview-panel";

type Props = {
  templateId: TemplateId;
};

/** Isolated preview; subscribes via FormProvider so editor fields are not re-rendered. */
export function LivePreview({ templateId }: Props) {
  const content = useWatch() as ResumeContent;
  return <PreviewPanel content={content} templateId={templateId} />;
}
