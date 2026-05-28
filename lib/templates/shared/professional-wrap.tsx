import type { ResumeSectionVariant } from "./resume-section";
import { ProfessionalEntry } from "./professional-entry";

export function wrapProfessionalEntry(
  variant: ResumeSectionVariant,
  children: React.ReactNode,
  options?: { muted?: boolean; className?: string },
) {
  if (variant !== "professional") {
    return children;
  }
  return (
    <ProfessionalEntry muted={options?.muted} className={options?.className}>
      {children}
    </ProfessionalEntry>
  );
}

export function renderResumeEntry(
  variant: ResumeSectionVariant,
  key: React.Key,
  children: React.ReactNode,
  options?: { muted?: boolean },
) {
  if (variant === "professional") {
    return (
      <ProfessionalEntry key={key} muted={options?.muted}>
        {children}
      </ProfessionalEntry>
    );
  }
  return (
    <div
      key={key}
      data-pagination-item
      className="[&:not(:last-child)]:mb-[var(--item-gap)]"
    >
      {children}
    </div>
  );
}
