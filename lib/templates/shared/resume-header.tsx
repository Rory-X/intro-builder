import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { buildContactItems } from "./contact-items";

export type ResumeHeaderVariant = "classic" | "professional" | "modern-sidebar";

type Props = {
  basics: ResumeContent["basics"];
  variant: ResumeHeaderVariant;
  className?: string;
};

export function ResumeHeader({ basics, variant, className }: Props) {
  const contactItems = buildContactItems(basics);

  if (variant === "modern-sidebar") {
    return (
      <header className={cn("space-y-3", className)}>
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
              <item.icon className="h-3 w-3 shrink-0 text-neutral-500" />
              <span className="break-all">{item.text}</span>
            </div>
          ))}
        </div>
      </header>
    );
  }

  if (variant === "professional") {
    return (
      <header className={cn("mb-4 break-inside-avoid border-b border-neutral-200 pb-3", className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[1.65em] font-bold leading-tight text-neutral-900">{basics.name}</h1>
            {basics.title && (
              <p className="mt-0.5 text-[1.05em] text-neutral-600">{basics.title}</p>
            )}
          </div>
          {basics.photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={basics.photo}
              alt={basics.name}
              className="h-[4.5rem] w-[3.25rem] shrink-0 rounded object-cover"
            />
          )}
        </div>
        {contactItems.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.85em] text-neutral-600">
            {contactItems.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-neutral-300" aria-hidden>|</span>}
                <item.icon className="h-3 w-3 shrink-0" />
                <span className="break-all">{item.text}</span>
              </span>
            ))}
          </div>
        )}
        {basics.summary && (
          <p className="mt-2 text-[0.95em] leading-relaxed text-neutral-700">{basics.summary}</p>
        )}
      </header>
    );
  }

  return (
    <header className={cn("mb-4 break-inside-avoid", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 text-center">
          <h1 className="text-2xl font-bold">{basics.name}</h1>
          {basics.title && <p className="text-base text-neutral-700">{basics.title}</p>}
        </div>
        {basics.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={basics.photo}
            alt={basics.name}
            className="ml-4 h-20 w-20 shrink-0 rounded object-cover"
          />
        )}
      </div>
      {contactItems.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          {contactItems.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <item.icon className="h-3 w-3" />
              {item.text}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
