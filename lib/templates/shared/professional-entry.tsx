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
        "mb-2.5 break-inside-avoid last:mb-0",
        muted && "text-neutral-400",
        className,
      )}
    >
      {children}
    </div>
  );
}
