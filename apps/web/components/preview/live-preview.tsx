"use client";

import { forwardRef } from "react";
import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { PreviewPanel } from "./preview-panel";

type Props = {
  resolvedTemplate: SerializableResolvedTemplate;
  onPaginationChange?: (data: { pageBreaks: number[]; totalHeight: number }) => void;
};

/** Isolated preview; subscribes via FormProvider so editor fields are not re-rendered. */
export const LivePreview = forwardRef<HTMLDivElement, Props>(function LivePreview(
  { resolvedTemplate, onPaginationChange },
  ref,
) {
  const content = useWatch() as ResumeContent;
  return <PreviewPanel ref={ref} content={content} resolvedTemplate={resolvedTemplate} onPaginationChange={onPaginationChange} />;
});
