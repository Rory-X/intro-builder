import { getSectionMeta } from "@/lib/section-meta";
import { cn } from "@/lib/utils";

export type ResumeSectionVariant = "classic" | "professional" | "modern";

type Props = {
  title: string;
  sectionKey?: string;
  variant: ResumeSectionVariant;
  children: React.ReactNode;
  className?: string;
};

export function ResumeSection({ title, sectionKey, variant, children, className }: Props) {
  const meta = sectionKey ? getSectionMeta(sectionKey) : null;
  const Icon = meta?.icon;

  if (variant === "professional") {
    return (
      <section className={cn("mt-3 break-inside-avoid", className)}>
        <h2 className="mb-2 flex items-center gap-2 text-[0.95em] font-bold tracking-wide text-neutral-900">
          <span className="h-px min-w-[1rem] flex-1 bg-neutral-300" aria-hidden />
          <span className="shrink-0 px-1">{title}</span>
          <span className="h-px min-w-[1rem] flex-1 bg-neutral-300" aria-hidden />
        </h2>
        {children}
      </section>
    );
  }

  if (variant === "modern") {
    return (
      <section className={cn("break-inside-avoid", className)}>
        <h2 className="mb-1 flex items-center gap-1 border-b border-neutral-300 pb-0.5 text-sm font-bold">
          {Icon && <Icon className={cn("h-3.5 w-3.5", meta?.color)} />}
          {title}
        </h2>
        {children}
      </section>
    );
  }

  return (
    <section className={cn("mt-4 break-inside-avoid", className)}>
      <h2 className="mb-1 flex items-center gap-1.5 border-b border-black pb-0.5 text-sm font-bold uppercase tracking-wide">
        {Icon && <Icon className={cn("h-4 w-4", meta?.color)} />}
        {title}
      </h2>
      {children}
    </section>
  );
}
