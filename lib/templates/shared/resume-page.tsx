import { FONT_MAP } from "@/lib/font-map";
import type { StyleSettings } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { mergeStyleSettings } from "./merge-style-settings";

type Props = {
  styleSettings?: StyleSettings;
  className?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
};

export function ResumePage({
  styleSettings,
  className,
  maxWidthClass = "max-w-[800px]",
  children,
}: Props) {
  const ss = mergeStyleSettings(styleSettings);

  return (
    <article
      className={cn(
        "mx-auto",
        maxWidthClass,
        className,
      )}
      style={{
        fontSize: `${ss.fontSize}px`,
        lineHeight: ss.lineHeight,
        padding: `${ss.pagePadding}px`,
        fontFamily: FONT_MAP[ss.fontFamily].css,
        backgroundColor: "#ffffff",
        color: "#000000",
      }}
    >
      {children}
    </article>
  );
}
