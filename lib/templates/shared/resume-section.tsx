import { getSectionMeta } from "@/lib/section-meta";
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

  if (variant === "card-wrapped") {
    // 圆角白卡片包裹整段（spec §6.3 — 陈媛媛 Abbey 风的核心视觉单元）。
    // bg/radius/shadow 三个值通过 --card-* CSS 变量注入；fallback 给一组温和的
    // 默认值（白底 + 12px 圆角 + 浅灰阴影）—— 即使 Skill 没设这三个字段视觉
    // 也合理，符合"schema 字段可选 + 渲染端永远有值"的原则。
    return (
      <section
        data-pagination-section={sectionKey}
        data-section-variant="card-wrapped"
        className={cn("break-inside-avoid", className)}
        style={{
          marginTop: "var(--section-gap)",
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
        className={cn("break-inside-avoid", className)}
        style={{ marginTop: "var(--section-gap)" }}
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
        <div className="px-2" style={{ marginTop: "var(--item-gap)" }}>{children}</div>
      </section>
    );
  }

  if (variant === "professional") {
    return (
      <section
        data-pagination-section={sectionKey}
        className={cn("break-inside-avoid", className)}
        style={{ marginTop: "var(--section-gap)" }}
      >
        <div data-pagination-section-header>
          <ProfessionalSectionTitle title={title} icon={Icon ?? undefined} />
        </div>
        <div style={{ marginTop: "var(--item-gap)" }}>{children}</div>
      </section>
    );
  }

  if (variant === "modern") {
    // Modern Layout 用父级 `space-y-4` 控制 section 间距，本 variant 不再
    // 加 marginTop —— 否则会和 space-y 叠加成双倍。modern 不响应
    // styleSettings.sectionGap 是已知 trade-off，未来可能把 Layout.tsx
    // 的 space-y-4 改成 var(--section-gap) 让 modern 也加入算法压缩。
    return (
      <section
        data-pagination-section={sectionKey}
        className={cn("break-inside-avoid", className)}
      >
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
    <section
      data-pagination-section={sectionKey}
      className={cn("break-inside-avoid", className)}
      style={{ marginTop: "var(--section-gap)" }}
    >
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
