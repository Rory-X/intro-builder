"use client";

import { cn } from "@/lib/utils";
import { useCompletenessScore, type SectionScore } from "@/hooks/use-completeness-score";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

/** SVG ring progress indicator */
function ScoreRing({ score, size = 20 }: { score: number; size?: number }) {
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score));
  const dashOffset = circumference * (1 - progress / 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      aria-hidden="true"
    >
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-foreground/10"
      />
      {/* Progress ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className={cn(
          "transition-[stroke-dashoffset] duration-300",
          score < 40
            ? "text-destructive"
            : score < 70
              ? "text-amber-500 dark:text-amber-400"
              : "text-emerald-500 dark:text-emerald-400",
        )}
      />
    </svg>
  );
}

/** Section progress bar in the popover detail panel */
function SectionRow({ section }: { section: SectionScore }) {
  const pct = Math.round((section.score / section.max) * 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {section.label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            pct < 40
              ? "bg-destructive"
              : pct < 70
                ? "bg-amber-500 dark:bg-amber-400"
                : "bg-emerald-500 dark:bg-emerald-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {section.score}/{section.max}
      </span>
    </div>
  );
}

/**
 * Compact completeness score indicator for the editor toolbar.
 * Shows an SVG ring + percentage. Clicking reveals a popover with per-section breakdown.
 */
export function CompletenessScore() {
  const { overall, sections } = useCompletenessScore();

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`简历完成度 ${overall}%`}
        className={cn(
          "inline-flex cursor-default items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
          "hover:bg-accent",
          overall < 40
            ? "text-destructive"
            : overall < 70
              ? "text-amber-600 dark:text-amber-400"
              : "text-emerald-600 dark:text-emerald-400",
        )}
      >
        <ScoreRing score={overall} />
        <span className="tabular-nums">{overall}%</span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-56">
        <PopoverHeader>
          <PopoverTitle>简历完成度</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-2">
          {sections.map((section) => (
            <SectionRow key={section.key} section={section} />
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          补充更多信息可以提升评分
        </p>
      </PopoverContent>
    </Popover>
  );
}
