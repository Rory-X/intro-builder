import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ProfessionalSectionTitle } from "./professional-section-title";

export type ResumeSectionVariant =
  | "classic"
  | "professional"
  | "modern"
  | "card-wrapped"
  | "full-width-bar";

type Props = {
  title: string;
  sectionKey?: string;
  variant: ResumeSectionVariant;
  iconOverride?: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  className?: string;
};

export function ResumeSection({
  title,
  sectionKey,
  variant,
  iconOverride,
  iconColor,
  children,
  className,
}: Props) {
  const Icon = iconOverride;

  if (variant === "card-wrapped") {
    // 圆角白卡片包裹整段（spec §6.3 — 陈媛媛 Abbey 风的核心视觉单元）。
    // bg/radius/shadow 三个值通过 --card-* CSS 变量注入；fallback 给一组温和的
    // 默认值（白底 + 12px 圆角 + 浅灰阴影）—— 即使 Skill 没设这三个字段视觉
    // 也合理，符合"schema 字段可选 + 渲染端永远有值"的原则。
    return (
      <section
        data-pagination-section={sectionKey}
        data-section-variant="card-wrapped"
        className={cn("mt-3 break-inside-avoid", className)}
        style={{
          backgroundColor: "var(--card-bg, #ffffff)",
          borderRadius: "var(--card-radius, 12px)",
          boxShadow: "var(--card-shadow, 0 1px 3px rgba(15, 23, 42, 0.06))",
          padding: "1rem 1.25rem",
        }}
      >
        <div data-pagination-section-header>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            {Icon && (
              <Icon
                className="h-[1em] w-[1em] shrink-0"
                style={{ color: "var(--primary)" }}
              />
            )}
            {title}
          </h2>
        </div>
        {children}
      </section>
    );
  }

  if (variant === "full-width-bar") {
    // 全宽浅色 bar + 左竖条 + 主色字（陈媛媛红 banner 风的 section title）。
    // 复用 --card-bg 作为 bar 底色（fallback 浅粉），--primary 作为竖条 + 字色。
    return (
      <section
        data-pagination-section={sectionKey}
        data-section-variant="full-width-bar"
        className={cn("mt-4 break-inside-avoid", className)}
      >
        <div data-pagination-section-header>
          <div
            className="flex items-center gap-2.5 px-4 py-2.5"
            style={{
              backgroundColor: "var(--card-bg, #FBE6E6)",
              borderLeft: "4px solid var(--primary, #C9314A)",
              borderRadius: "0 4px 4px 0",
            }}
          >
            {Icon && (
              <Icon
                className="h-[1em] w-[1em] shrink-0"
                style={{ color: "var(--primary)" }}
              />
            )}
            <h2
              className="m-0 text-[14px] font-bold"
              style={{ color: "var(--primary)" }}
            >
              {title}
            </h2>
          </div>
        </div>
        <div className="mt-3 px-2">{children}</div>
      </section>
    );
  }

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
            {Icon && <Icon className="h-[1em] w-[1em]" style={iconColor ? { color: iconColor } : undefined} />}
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
          {Icon && <Icon className="h-[1em] w-[1em]" style={iconColor ? { color: iconColor } : undefined} />}
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
