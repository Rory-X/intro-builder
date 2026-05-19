import type { ResumeContent } from "@/lib/resume-schema";
import { DEFAULT_SECTION_ORDER } from "@/lib/resume-schema";
import { getSectionMeta } from "@/lib/section-meta";
import { ResumeItemHeader } from "./resume-item-header";
import { ResumeRichText } from "./resume-rich-text";
import { ResumeSection, type ResumeSectionVariant } from "./resume-section";
import {
  CustomSectionShell,
  EducationSectionShell,
  ExperienceSectionShell,
  ProjectsSectionShell,
  SkillsSectionShell,
  SummarySectionShell,
} from "./section-shell";
import { renderResumeEntry, wrapProfessionalEntry } from "./professional-wrap";

function formatDateRange(start: string, end: string) {
  if (!start && !end) return undefined;
  return `${start}${start && end ? " – " : ""}${end}`;
}

export function getSectionOrder(content: ResumeContent, sectionOrder?: string[]) {
  return sectionOrder ?? content.sectionOrder ?? [...DEFAULT_SECTION_ORDER];
}

export type BuildSectionsOptions = {
  includeBasicsSummary?: boolean;
  showEmptyPlaceholders?: boolean;
};

export function buildResumeSections(
  content: ResumeContent,
  variant: ResumeSectionVariant,
  options?: BuildSectionsOptions,
): Record<string, React.ReactNode> {
  const includeBasicsSummary = options?.includeBasicsSummary ?? true;
  const shells = options?.showEmptyPlaceholders ?? false;

  const experienceTitle = getSectionMeta("experience").label;
  const educationTitle = getSectionMeta("education").label;
  const projectsTitle = getSectionMeta("projects").label;
  const skillsTitle = getSectionMeta("skills").label;

  return {
    basics:
      includeBasicsSummary && (content.basics.summary || shells) ? (
        <ResumeSection key="basics" sectionKey="basics" title="自我介绍" variant={variant}>
          {content.basics.summary ? (
            wrapProfessionalEntry(
              variant,
              <p className="text-[0.92em] leading-relaxed text-neutral-700">{content.basics.summary}</p>,
            )
          ) : (
            <SummarySectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    experience:
      content.experience.length > 0 || shells ? (
        <ResumeSection
          key="experience"
          sectionKey="experience"
          title={experienceTitle}
          variant={variant}
        >
          {content.experience.length > 0 ? (
            content.experience.map((e, i) => {
              const dateRange = formatDateRange(e.start, e.end);
              const header =
                variant === "classic" ? (
                  <ResumeItemHeader
                    variant="classic"
                    primary={`${e.company} — ${e.title}`}
                    dateRange={dateRange}
                  />
                ) : variant === "modern" ? (
                  <ResumeItemHeader
                    variant="modern"
                    primary={`${e.title} @ ${e.company}`}
                    dateRange={dateRange}
                  />
                ) : (
                  <ResumeItemHeader
                    variant="professional"
                    primary={e.company}
                    secondary={e.title}
                    tertiary={e.location || undefined}
                    dateRange={dateRange}
                  />
                );
              return renderResumeEntry(
                variant,
                i,
                <>
                  {header}
                  <ResumeRichText content={e.content} />
                </>,
              );
            })
          ) : (
            <ExperienceSectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    education:
      content.education.length > 0 || shells ? (
        <ResumeSection
          key="education"
          sectionKey="education"
          title={educationTitle}
          variant={variant}
        >
          {content.education.length > 0 ? (
            content.education.map((e, i) =>
              renderResumeEntry(
                variant,
                i,
                <>
                  <ResumeItemHeader
                    variant={variant}
                    primary={
                      variant === "professional" ? (
                        <>
                          {e.school}
                          {(e.degree || e.major) && (
                            <span className="font-normal">
                              {" "}
                              {[e.degree, e.major].filter(Boolean).join(" ")}
                            </span>
                          )}
                          {e.gpa ? ` · GPA ${e.gpa}` : ""}
                        </>
                      ) : (
                        <>
                          <strong>{e.school}</strong>
                          {(e.degree || e.major) && (
                            <span className="font-normal">
                              {" "}
                              {[e.degree, e.major].filter(Boolean).join(" ")}
                            </span>
                          )}
                          {e.gpa ? ` · GPA ${e.gpa}` : ""}
                        </>
                      )
                    }
                    dateRange={formatDateRange(e.start, e.end)}
                  />
                  <ResumeRichText content={e.highlights} />
                </>,
              ),
            )
          ) : (
            <EducationSectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    projects:
      content.projects.length > 0 || shells ? (
        <ResumeSection
          key="projects"
          sectionKey="projects"
          title={projectsTitle}
          variant={variant}
        >
          {content.projects.length > 0 ? (
            content.projects.map((p, i) =>
              renderResumeEntry(
                variant,
                i,
                <>
                  <ResumeItemHeader
                    variant={variant}
                    primary={p.name}
                    secondary={
                      p.stack.length > 0 ? p.stack.join(" · ") : undefined
                    }
                  />
                  <ResumeRichText content={p.content} />
                </>,
              ),
            )
          ) : (
            <ProjectsSectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    skills:
      content.skills.length > 0 || shells ? (
        <ResumeSection key="skills" sectionKey="skills" title={skillsTitle} variant={variant}>
          {variant === "professional" ? (
            renderResumeEntry(
              variant,
              "skills-block",
              content.skills.length > 0 ? (
                <div className="space-y-1">
                  {content.skills.map((s, i) => (
                    <p key={i} className="text-[0.92em] leading-relaxed text-neutral-800">
                      <span className="font-semibold">{s.category}：</span>
                      {s.items.join("、")}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[0.92em] leading-relaxed">
                    <span className="font-semibold">编程语言：</span>
                    JavaScript、TypeScript、Python
                  </p>
                  <p className="text-[0.92em] leading-relaxed">
                    <span className="font-semibold">框架 / 工具：</span>
                    React、Next.js、Git
                  </p>
                </div>
              ),
              { muted: shells && content.skills.length === 0 },
            )
          ) : content.skills.length > 0 ? (
            content.skills.map((s, i) =>
              renderResumeEntry(
                variant,
                i,
                <>
                  <strong>{s.category}:</strong> {s.items.join("、")}
                </>,
              ),
            )
          ) : (
            <SkillsSectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    ...Object.fromEntries(
      (content.custom ?? []).map((cs) => {
        const hasContent = (cs.content?.content?.length ?? 0) > 0;
        if (!hasContent && !shells) return [cs.id, null];
        return [
          cs.id,
          <ResumeSection key={cs.id} sectionKey={cs.id} title={cs.title} variant={variant}>
            {hasContent
              ? renderResumeEntry(variant, cs.id, <ResumeRichText content={cs.content} />)
              : (
                <CustomSectionShell title={cs.title} variant={variant} />
              )}
          </ResumeSection>,
        ];
      }),
    ),
  };
}
