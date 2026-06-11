"use client";

import { useMemo } from "react";
import { useWatch } from "react-hook-form";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { computeCompletenessScore } from "@/lib/completeness-score";

// Re-export the pure function and types for backward compatibility
export { computeCompletenessScore } from "@/lib/completeness-score";
export type { CompletenessResult, SectionScore } from "@/lib/completeness-score";

/**
 * React hook that subscribes to form data via useWatch()
 * and computes completeness score in real-time.
 */
export function useCompletenessScore() {
  const content = useWatch() as ResumeContent;
  return useMemo(() => computeCompletenessScore(content), [content]);
}
