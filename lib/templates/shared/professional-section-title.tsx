import type { LucideIcon } from "lucide-react";

/** Slant on the black title tab (px). */
const TAB_SLANT_PX = 12;
/** Slant on the projection tail (px). */
const SHADOW_SLANT_PX = 8;
/** Width of the fading projection tail (px). */
const SHADOW_TAIL_PX = 8;
/** Horizontal offset as % of tab width — scales with short/long titles. */
const SHADOW_OFFSET_PCT = 18;
const SHADOW_SCALE = 0.88;

const TAB_CLIP = `polygon(0 0, calc(100% - ${TAB_SLANT_PX}px) 0, 100% 100%, 0 100%)`;
const TAIL_CLIP = `polygon(0 0, 100% 0, calc(100% - ${SHADOW_SLANT_PX}px) 100%, ${SHADOW_SLANT_PX}px 100%)`;
const SHADOW_TRANSFORM = `translateX(${SHADOW_OFFSET_PCT}%) scale(${SHADOW_SCALE})`;

type Props = {
  title: string;
  icon?: LucideIcon;
};

/** Black tab + soft offset projection + full-width underline (professional template). */
export function ProfessionalSectionTitle({ title, icon: Icon }: Props) {
  return (
    <div className="w-full border-b border-neutral-300 leading-none print:border-neutral-400">
      <div className="relative inline-flex max-w-full overflow-visible">
        {/* Projection sits beside the tab — must not be a child of clip-path */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 origin-bottom-left bg-neutral-500/35 print:bg-neutral-400/45"
          style={{
            clipPath: TAB_CLIP,
            transform: SHADOW_TRANSFORM,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute z-0 origin-bottom-left print:bg-gradient-to-r print:from-neutral-300/70 print:to-transparent"
          style={{
            top: "8%",
            bottom: "8%",
            left: `calc(100% - ${TAB_SLANT_PX}px)`,
            width: SHADOW_TAIL_PX,
            clipPath: TAIL_CLIP,
            transform: SHADOW_TRANSFORM,
            background:
              "linear-gradient(90deg, rgba(115,115,115,0.32) 0%, rgba(163,163,163,0.12) 55%, transparent 100%)",
          }}
        />
        <h2
          className="relative z-[1] m-0 inline-flex items-center gap-1.5 bg-neutral-900 py-1 pl-2.5 pr-3 text-[0.92em] font-bold leading-snug text-white print:bg-neutral-900"
          style={{ clipPath: TAB_CLIP }}
        >
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-white" />}
          <span className="whitespace-nowrap">{title}</span>
        </h2>
      </div>
    </div>
  );
}
