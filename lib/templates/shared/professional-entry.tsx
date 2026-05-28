import { cn } from "@/lib/utils";

type Props = {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
};

/** Professional template entry spacing wrapper (no background). */
export function ProfessionalEntry({ children, className, muted = false }: Props) {
  return (
    <div
      data-pagination-item
      className={cn(
        // 最后一个 entry 不要底部间距 —— 用 :not(:last-child) selector 而不是
        // inline style，否则最后一个 entry 会和下一个 section 距离过大。
        "break-inside-avoid [&:not(:last-child)]:mb-[var(--item-gap)]",
        muted && "text-neutral-400",
        className,
      )}
    >
      {children}
    </div>
  );
}
