import { getSectionMeta } from "@/lib/section-meta";
import { cn } from "@/lib/utils";
import { ProfessionalSectionTitle } from "./professional-section-title";

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
      <section className={cn("mt-3.5 break-inside-avoid", className)}>
        <ProfessionalSectionTitle title={title} icon={Icon ?? undefined} />
        <div className="mt-2">{children}</div>
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
