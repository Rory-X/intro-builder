"use client";

import { AlertTriangle, CircleDot } from "lucide-react";

import { cn } from "@/lib/utils";

export type ResumeHelperSuggestionView = {
  id: string;
  section: string;
  fieldPath: string;
  severity: "high" | "medium" | "low";
  title: string;
  rationale: string;
  actionLabel: string;
  example: string;
  riskFlags: Array<{ type: string; message: string }>;
};

export function ResumeHelperCard({
  suggestion,
}: {
  suggestion: ResumeHelperSuggestionView;
}) {
  return (
    <article className="rounded-xl border bg-background p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <CircleDot
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            suggestion.severity === "high"
              ? "text-rose-500"
              : suggestion.severity === "medium"
                ? "text-amber-500"
                : "text-emerald-500",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{suggestion.title}</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{suggestion.rationale}</p>
          {suggestion.example && (
            <p className="mt-2 rounded-lg bg-muted/60 px-2 py-1.5 text-xs leading-5 text-foreground">
              {suggestion.example}
            </p>
          )}
        </div>
      </div>
      {suggestion.riskFlags.length > 0 && (
        <div className="mt-2 space-y-1">
          {suggestion.riskFlags.map((flag) => (
            <p
              key={`${flag.type}:${flag.message}`}
              className="flex items-start gap-1.5 text-[11px] leading-4 text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{flag.message}</span>
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
