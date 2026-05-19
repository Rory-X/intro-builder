import type { ResumeContent } from "@/lib/resume-schema";
import { DEFAULT_SECTION_ORDER } from "@/lib/resume-schema";
import { ResumeItemHeader } from "./resume-item-header";
import { ResumeRichText } from "./resume-rich-text";
import { ResumeSection, type ResumeSectionVariant } from "./resume-section";

function formatDateRange(start: string, end: string) {
  if (!start && !end) return undefined;
  return `${start}${start && end ? " – " : ""}${end}`;
}

export function getSectionOrder(content: ResumeContent, sectionOrder?: string[]) {
  return sectionOrder ?? content.sectionOrder ?? [...DEFAULT_SECTION_ORDER];
}

export function buildResumeSections(
  content: ResumeContent,
  variant: ResumeSectionVariant,
  options?: { includeBasicsSummary?: boolean },
): Record<string, React.ReactNode> {
  const includeBasicsSummary = options?.includeBasicsSummary ?? true;

  return {
    basics:
      includeBasicsSummary && content.basics.summary ? (
        <ResumeSection key="basics" sectionKey="basics" title="自我介绍" variant={variant}>
          <p className="text-neutral-700">{content.basics.summary}</p>
        </ResumeSection>
      ) : null,
    experience:
      content.experience.length > 0 ? (
        <ResumeSection key="experience" sectionKey="experience" title="工作经历" variant={variant}>
          {content.experience.map((e, i) => {
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
                  dateRange={dateRange}
                />
              );
            return (
              <div key={i} className="mb-2.5 last:mb-0">
                {header}
                {e.location && variant === "professional" && (
                  <p className="mb-0.5 text-[0.9em] text-neutral-500">{e.location}</p>
                )}
                <ResumeRichText content={e.content} />
              </div>
            );
          })}
        </ResumeSection>
      ) : null,
    education:
      content.education.length > 0 ? (
        <ResumeSection key="education" sectionKey="education" title="教育背景" variant={variant}>
          {content.education.map((e, i) => (
            <div key={i} className="mb-2 last:mb-0">
              <ResumeItemHeader
                variant={variant}
                primary={
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
                }
                dateRange={formatDateRange(e.start, e.end)}
              />
              <ResumeRichText content={e.highlights} />
            </div>
          ))}
        </ResumeSection>
      ) : null,
    projects:
      content.projects.length > 0 ? (
        <ResumeSection key="projects" sectionKey="projects" title="项目经历" variant={variant}>
          {content.projects.map((p, i) => (
            <div key={i} className="mb-2.5 last:mb-0">
              <ResumeItemHeader
                variant={variant}
                primary={p.name}
                secondary={
                  p.stack.length > 0 ? (
                    <span className="font-normal text-neutral-600">{p.stack.join(" · ")}</span>
                  ) : undefined
                }
              />
              <ResumeRichText content={p.content} />
            </div>
          ))}
        </ResumeSection>
      ) : null,
    skills:
      content.skills.length > 0 ? (
        <ResumeSection key="skills" sectionKey="skills" title="技能" variant={variant}>
          {content.skills.map((s, i) => (
            <div key={i} className="mb-1 last:mb-0">
              <strong>{s.category}:</strong> {s.items.join("、")}
            </div>
          ))}
        </ResumeSection>
      ) : null,
    ...Object.fromEntries(
      (content.custom ?? []).map((cs) => [
        cs.id,
        cs.content?.content?.length > 0 ? (
          <ResumeSection key={cs.id} sectionKey={cs.id} title={cs.title} variant={variant}>
            <ResumeRichText content={cs.content} />
          </ResumeSection>
        ) : null,
      ]),
    ),
  };
}
