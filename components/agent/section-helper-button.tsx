"use client";

import { useId, useState } from "react";

import {
  GradientSparklesIcon,
  ResumeHelperPopoverContent,
  requestResumeHelper,
} from "@/components/agent/resume-diagnose-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { ResumeHelperRequest } from "@/lib/agent/client";

type Section = Extract<ResumeHelperRequest["target"], { kind: "section" }>["section"];
type HelperState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: import("@/lib/agent/client").ResumeHelperResponse["result"] }
  | { status: "error"; message: string };

export type SectionHelperButtonProps = {
  resumeId: string;
  section: Section;
  fieldPath: string | null;
  label: string;
  plainText: string;
  completeness: {
    overall: number;
    sections: Array<{ key: string; label: string; score: number; max: number }>;
  };
};

export function SectionHelperButton({
  resumeId,
  section,
  fieldPath,
  label,
  plainText,
  completeness,
}: SectionHelperButtonProps) {
  const [state, setState] = useState<HelperState>({ status: "idle" });
  const gradientId = `section-helper-gradient-${useId().replace(/:/g, "")}`;

  async function requestSectionSuggestions() {
    await requestResumeHelper({
      resumeId,
      path: "/api/agent/resume/helpers/section-next-steps",
      body: {
        resumeId,
        locale: "zh-CN",
        target: { kind: "section", section, fieldPath },
        context: {
          resumeTitle: "当前简历",
          completeness,
          sections: [{ key: section, label, plainText }],
        },
        intent: {
          mode: "next_steps",
          maxSuggestions: 3,
          strategy: section === "experience" || section === "projects" ? "star" : "plain",
        },
      },
      setState,
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 rounded-full px-2 text-xs"
            aria-label="AI 建议"
            disabled={state.status === "loading" || plainText.trim() === ""}
            onClick={() => void requestSectionSuggestions()}
          />
        }
      >
        <GradientSparklesIcon gradientId={gradientId} />
        <span className="bg-gradient-to-r from-sky-500 via-fuchsia-500 to-amber-400 bg-clip-text text-transparent">
          {state.status === "loading" ? "分析中" : "AI 建议"}
        </span>
      </PopoverTrigger>
      <ResumeHelperPopoverContent state={state} title={`${label}建议`} />
    </Popover>
  );
}
