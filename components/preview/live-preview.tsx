"use client";

import { forwardRef } from "react";
import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@/lib/resume-schema";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { PreviewPanel } from "./preview-panel";

type Props = {
  resolvedTemplate: SerializableResolvedTemplate;
};

/** Isolated preview; subscribes via FormProvider so editor fields are not re-rendered. */
export const LivePreview = forwardRef<HTMLDivElement, Props>(function LivePreview(
  { resolvedTemplate },
  ref,
) {
  const content = useWatch() as ResumeContent;
  return <PreviewPanel ref={ref} content={content} resolvedTemplate={resolvedTemplate} />;
});
