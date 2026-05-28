import { cn } from "@/lib/utils";

export type ResumeItemHeaderVariant = "classic" | "professional" | "modern";

type Props = {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  /** Shown right-aligned on the secondary row (e.g. location) */
  tertiary?: React.ReactNode;
  dateRange?: string;
  variant?: ResumeItemHeaderVariant;
  className?: string;
};

export function ResumeItemHeader({
  primary,
  secondary,
  tertiary,
  dateRange,
  variant = "professional",
  className,
}: Props) {
  if (variant === "modern") {
    return (
      <div className={cn("mb-1 break-inside-avoid", className)}>
        <div className="flex justify-between gap-3">
          <span className="font-semibold">{primary}</span>
          {dateRange && (
            <span
              className="shrink-0 text-xs tabular-nums"
              // var(--accent) 由 UploadedLayout 注入；built-in 模板不设走 fallback 保持原色
              style={{ color: "var(--accent, #525252)" }}
            >
              {dateRange}
            </span>
          )}
        </div>
        {secondary && <div className="text-xs text-neutral-600">{secondary}</div>}
      </div>
    );
  }

  if (variant === "classic") {
    return (
      <div className={cn("mb-0.5 break-inside-avoid", className)}>
        <div className="flex justify-between gap-3 font-semibold">
          <span>{primary}</span>
          {dateRange && (
            <span
              className="font-normal tabular-nums"
              style={{ color: "var(--accent, currentColor)" }}
            >
              {dateRange}
            </span>
          )}
        </div>
        {secondary && <div className="text-neutral-600">{secondary}</div>}
      </div>
    );
  }

  return (
    <div className={cn("mb-1.5 break-inside-avoid", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-bold leading-snug text-neutral-900">{primary}</span>
        {dateRange && (
          <span
            className="shrink-0 text-[0.9em] font-normal tabular-nums"
            style={{ color: "var(--accent, #525252)" }}
          >
            {dateRange}
          </span>
        )}
      </div>
      {(secondary || tertiary) && (
        <div className="mt-0.5 flex items-baseline justify-between gap-4 text-[0.92em] text-neutral-700">
          <span className="min-w-0">{secondary}</span>
          {tertiary && <span className="shrink-0 text-neutral-600">{tertiary}</span>}
        </div>
      )}
    </div>
  );
}
