import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { buildContactItems } from "./contact-items";
import { ProfessionalHeader } from "./professional-header";

export type ResumeHeaderVariant = "classic" | "professional" | "modern-sidebar";

type Props = {
  basics: ResumeContent["basics"];
  variant: ResumeHeaderVariant;
  className?: string;
  showEmptyPlaceholders?: boolean;
};

export function ResumeHeader({ basics, variant, className }: Props) {
  const contactItems = buildContactItems(basics);

  if (variant === "modern-sidebar") {
    return (
      <header data-pagination-header className={cn("space-y-3", className)}>
        {basics.photo && (
          // eslint-disable-next-line @next/next/no-img-element -- Puppeteer PDF uses plain img
          <img
            src={basics.photo}
            alt={basics.name}
            className="mx-auto h-24 w-24 rounded-full object-cover"
          />
        )}
        <div>
          <h1 className="text-xl font-bold">{basics.name}</h1>
          {basics.title && <p className="text-sm text-neutral-600">{basics.title}</p>}
        </div>
        <div className="space-y-1 text-xs">
          {contactItems.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <item.icon className="h-[0.9em] w-[0.9em] shrink-0 text-neutral-500" />
              <span className="break-all">{item.text}</span>
            </div>
          ))}
        </div>
      </header>
    );
  }

  if (variant === "professional") {
    return (
      <header data-pagination-header className={cn("mb-3 break-inside-avoid pb-2", className)}>
        <ProfessionalHeader basics={basics} />
      </header>
    );
  }

  return (
    <header data-pagination-header className={cn("mb-4 break-inside-avoid", className)}>
      {basics.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={basics.photo}
          alt={basics.name}
          className="absolute rounded object-cover"
          style={{ width: "5rem", height: "5rem", top: "40px", right: "40px" }}
        />
      )}
      <div className={cn("text-center", basics.photo && "pr-[5.5rem]")}>
        <h1 className="text-2xl font-bold">{basics.name}</h1>
        {basics.title && <p className="text-base text-neutral-700">{basics.title}</p>}
      </div>
      {contactItems.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          {contactItems.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <item.icon className="h-[0.9em] w-[0.9em]" />
              {item.text}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
