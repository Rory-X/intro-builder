import { getSectionMeta } from "@/lib/section-meta";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ProfessionalSectionTitle } from "./professional-section-title";

export type ResumeSectionVariant = "classic" | "professional" | "modern";

type Props = {
  title: string;
  sectionKey?: string;
  variant: ResumeSectionVariant;
  /**
   * 可选 icon 覆盖。模板（如 Skill 产出的 uploaded template）通过
   * `LayoutConfig.sectionIcons` 指定 lucide 图标时传进来，优先于
   * `getSectionMeta(sectionKey).icon` 默认。不传 fallback 到默认行为。
   */
  iconOverride?: LucideIcon;
  children: React.ReactNode;
  className?: string;
};

export function ResumeSection({
  title,
  sectionKey,
  variant,
  iconOverride,
  children,
  className,
}: Props) {
  const meta = sectionKey ? getSectionMeta(sectionKey) : null;
  const Icon = iconOverride ?? meta?.icon;

  if (variant === "professional") {
    return (
      <section data-pagination-section={sectionKey} className={cn("mt-3.5 break-inside-avoid", className)}>
        <div data-pagination-section-header>
          <ProfessionalSectionTitle title={title} icon={Icon ?? undefined} />
        </div>
        <div className="mt-2">{children}</div>
      </section>
    );
  }

  if (variant === "modern") {
    return (
      <section data-pagination-section={sectionKey} className={cn("break-inside-avoid", className)}>
        <div data-pagination-section-header>
          <h2 className="mb-1 flex items-center gap-1 border-b border-neutral-300 pb-0.5 text-sm font-bold">
            {Icon && <Icon className={cn("h-[1em] w-[1em]", meta?.color)} />}
            {title}
          </h2>
        </div>
        {children}
      </section>
    );
  }

  return (
    <section data-pagination-section={sectionKey} className={cn("mt-4 break-inside-avoid", className)}>
      <div data-pagination-section-header>
        <h2 className="mb-1 flex items-center gap-1.5 border-b border-black pb-0.5 text-sm font-bold uppercase tracking-wide">
          {Icon && <Icon className={cn("h-[1em] w-[1em]", meta?.color)} />}
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
