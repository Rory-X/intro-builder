"use client";

import { forwardRef } from "react";
import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@/lib/resume-schema";
import type { TemplateId } from "@/lib/templates/registry";
import { PreviewPanel } from "./preview-panel";

type Props = {
  templateId: TemplateId;
  onPaginationChange?: (data: { pageBreaks: number[]; totalHeight: number }) => void;
};

/** Isolated preview; subscribes via FormProvider so editor fields are not re-rendered. */
export const LivePreview = forwardRef<HTMLDivElement, Props>(function LivePreview(
  { templateId, onPaginationChange },
  ref,
) {
  const content = useWatch() as ResumeContent;
  return <PreviewPanel ref={ref} content={content} templateId={templateId} onPaginationChange={onPaginationChange} />;
});
