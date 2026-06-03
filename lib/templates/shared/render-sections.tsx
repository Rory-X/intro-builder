import type { ResumeContent } from "@/lib/resume-schema";
import { DEFAULT_SECTION_ORDER } from "@/lib/resume-schema";
import { getSectionMeta } from "@/lib/section-meta";
import {
  ResumeItemHeader,
  type ResumeItemHeaderVariant,
} from "./resume-item-header";
import { ResumeRichText } from "./resume-rich-text";
import { ResumeSection, type ResumeSectionVariant } from "./resume-section";
import {
  CustomSectionShell,
  EducationSectionShell,
  ExperienceSectionShell,
  ProjectsSectionShell,
  SkillsSectionShell,
} from "./section-shell";
import { renderResumeEntry, wrapProfessionalEntry } from "./professional-wrap";
import { lookupLucideIcon } from "./lucide-icon-lookup";
import type { LucideIcon } from "lucide-react";

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
  /**
   * Item header 的 variant —— 控制条目内"公司/职位/项目名"等头部信息的排版。
   * 与 section title variant **独立维度**：可以 sectionTitleVariant=professional
   * 配合 itemHeaderVariant=classic（章节标题用专业风、条目用经典风）。
   * 不传时 fallback 到 section variant（如果 section variant 是 ItemHeader
   * 也支持的值），否则 fallback 到 professional —— card-wrapped 是 section-level
   * 视觉变体，不是 item header 级，所以 fallback 到 professional 是合理默认。
   */
  itemHeaderVariant?: ResumeItemHeaderVariant;
  /**
   * 模板级 section icon 声明（opt-in）。没声明则不显示图标。
   */
  sectionIcons?: Record<string, string>;
  sectionIconColors?: Record<string, string>;
};

/**
 * Section variant 是 4 元 union，但 ResumeItemHeader 只接受 3 元 —— card-wrapped
 * 是 section-level 视觉概念。这里把 section variant 收敛成合法的 item header
 * variant：card-wrapped → professional（视觉风格上接近），其他原样穿透。
 */
function narrowToItemHeaderVariant(
  v: ResumeSectionVariant,
): ResumeItemHeaderVariant {
  // card-wrapped + full-width-bar 是 section-level 视觉，item header 内部仍按 professional 渲染
  if (v === "card-wrapped" || v === "full-width-bar") return "professional";
  return v;
}

export function buildResumeSections(
  content: ResumeContent,
  variant: ResumeSectionVariant,
  options?: BuildSectionsOptions,
): Record<string, React.ReactNode> {
  const includeBasicsSummary = options?.includeBasicsSummary ?? true;
  const shells = options?.showEmptyPlaceholders ?? false;
  const itemHeaderVariant: ResumeItemHeaderVariant =
    options?.itemHeaderVariant ?? narrowToItemHeaderVariant(variant);
  const overrideIcon = (key: string): LucideIcon | undefined => {
    const name = options?.sectionIcons?.[key];
    if (!name) return undefined;
    return lookupLucideIcon(name) ?? undefined;
  };
  const overrideIconColor = (key: string): string | undefined => {
    return options?.sectionIconColors?.[key];
  };

  const experienceTitle = getSectionMeta("experience").label;
  const educationTitle = getSectionMeta("education").label;
  const projectsTitle = getSectionMeta("projects").label;
  const skillsTitle = getSectionMeta("skills").label;

  return {
    basics:
      includeBasicsSummary && content.basics.summary ? (
        <ResumeSection
          key="basics"
          sectionKey="basics"
          title="自我介绍"
          variant={variant}
          iconOverride={overrideIcon("basics")}
          iconColor={overrideIconColor("basics")}
        >
          {wrapProfessionalEntry(
            variant,
            <p className="text-[0.92em] leading-relaxed text-neutral-700">{content.basics.summary}</p>,
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
          iconOverride={overrideIcon("experience")}
          iconColor={overrideIconColor("experience")}
        >
          {content.experience.length > 0 ? (
            content.experience.map((e, i) => {
              const dateRange = formatDateRange(e.start, e.end);
              const header =
                itemHeaderVariant === "classic" ? (
                  <ResumeItemHeader
                    variant="classic"
                    primary={`${e.company} — ${e.title}`}
                    dateRange={dateRange}
                  />
                ) : itemHeaderVariant === "modern" ? (
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
          iconOverride={overrideIcon("education")}
          iconColor={overrideIconColor("education")}
        >
          {content.education.length > 0 ? (
            content.education.map((e, i) =>
              renderResumeEntry(
                variant,
                i,
                itemHeaderVariant === "professional" ? (
                  <div data-testid="professional-education-entry">
                    <div className="flex items-baseline justify-between gap-4">
                      <div data-testid="education-school" className="font-bold leading-snug text-neutral-900">
                        {e.school}
                      </div>
                      {formatDateRange(e.start, e.end) && (
                        <div
                          data-testid="education-date"
                          className="shrink-0 text-[0.9em] font-normal tabular-nums text-neutral-600"
                        >
                          {formatDateRange(e.start, e.end)}
                        </div>
                      )}
                    </div>
                    <div
                      data-testid="education-meta"
                      className="mt-0.5 text-[0.92em] leading-relaxed text-neutral-700"
                    >
                      {[e.degree, e.major, e.location, e.gpa ? `GPA ${e.gpa}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <ResumeRichText content={e.highlights} />
                  </div>
                ) : (
                  <>
                    <ResumeItemHeader
                      variant={itemHeaderVariant}
                      primary={
                        <>
                          <strong>{e.school}</strong>
                          {(e.degree || e.major || e.location) && (
                            <span className="font-normal">
                              {" "}
                              {[e.degree, e.major, e.location].filter(Boolean).join(" ")}
                            </span>
                          )}
                          {e.gpa ? ` · GPA ${e.gpa}` : ""}
                        </>
                      }
                      dateRange={formatDateRange(e.start, e.end)}
                    />
                    <ResumeRichText content={e.highlights} />
                  </>
                ),
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
          iconOverride={overrideIcon("projects")}
          iconColor={overrideIconColor("projects")}
        >
          {content.projects.length > 0 ? (
            content.projects.map((p, i) =>
              renderResumeEntry(
                variant,
                i,
                itemHeaderVariant === "professional" ? (
                  <div data-testid="professional-project-entry">
                    <div data-testid="project-main-row" className="flex items-start justify-between gap-4">
                      <div data-testid="project-left" className="min-w-0 flex-1">
                        <div data-testid="project-name" className="font-bold leading-snug text-neutral-900">
                          {p.name}
                        </div>
                        {(p.role || p.stack.length > 0) && (
                          <div
                            data-testid="project-meta"
                            className="mt-0.5 text-[0.92em] leading-relaxed text-neutral-700"
                          >
                            {[p.role, p.stack.length > 0 ? p.stack.join(" · ") : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      {(p.location || formatDateRange(p.start, p.end)) && (
                        <div
                          data-testid="project-right"
                          className="w-[9rem] shrink-0 text-right text-[0.9em] font-normal text-neutral-600"
                        >
                          {formatDateRange(p.start, p.end) && (
                            <div data-testid="project-date" className="tabular-nums">
                              {formatDateRange(p.start, p.end)}
                            </div>
                          )}
                          {p.location && (
                            <div data-testid="project-location" className="mt-0.5">
                              {p.location}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <ResumeRichText content={p.content} />
                  </div>
                ) : (
                  <>
                    <ResumeItemHeader
                      variant={itemHeaderVariant}
                      primary={p.name}
                      secondary={
                        [p.role, p.location, p.stack.length > 0 ? p.stack.join(" · ") : ""]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      dateRange={formatDateRange(p.start, p.end)}
                    />
                    <ResumeRichText content={p.content} />
                  </>
                ),
              ),
            )
          ) : (
            <ProjectsSectionShell variant={variant} />
          )}
        </ResumeSection>
      ) : null,
    skills:
      (content.skills?.content?.length ?? 0) > 0 || shells ? (
        <ResumeSection
          key="skills"
          sectionKey="skills"
          title={skillsTitle}
          variant={variant}
          iconOverride={overrideIcon("skills")}
          iconColor={overrideIconColor("skills")}
        >
          {(content.skills?.content?.length ?? 0) > 0
            ? renderResumeEntry(variant, "skills", <ResumeRichText content={content.skills} />)
            : <SkillsSectionShell variant={variant} />}
        </ResumeSection>
      ) : null,
    ...Object.fromEntries(
      (content.custom ?? []).map((cs) => {
        const hasContent = (cs.content?.content?.length ?? 0) > 0;
        if (!hasContent && !shells) return [cs.id, null];
        return [
          cs.id,
          <ResumeSection
            key={cs.id}
            sectionKey={cs.id}
            title={cs.title}
            variant={variant}
            iconOverride={overrideIcon(cs.id)}
            iconColor={overrideIconColor(cs.id)}
          >
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
