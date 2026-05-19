import { cn } from "@/lib/utils";

export type ResumeItemHeaderVariant = "classic" | "professional" | "modern";

type Props = {
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  dateRange?: string;
  variant?: ResumeItemHeaderVariant;
  className?: string;
};

export function ResumeItemHeader({
  primary,
  secondary,
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
            <span className="shrink-0 text-xs text-neutral-600 tabular-nums">{dateRange}</span>
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
          {dateRange && <span className="font-normal tabular-nums">{dateRange}</span>}
        </div>
        {secondary && <div className="text-neutral-600">{secondary}</div>}
      </div>
    );
  }

  return (
    <div className={cn("mb-1 break-inside-avoid", className)}>
      <div className="flex justify-between gap-4">
        <span className="font-semibold text-neutral-900">{primary}</span>
        {dateRange && (
          <span className="shrink-0 text-[0.92em] text-neutral-600 tabular-nums">{dateRange}</span>
        )}
      </div>
      {secondary && (
        <div className="text-[0.92em] text-neutral-600">{secondary}</div>
      )}
    </div>
  );
}
