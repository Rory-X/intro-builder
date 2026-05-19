import type { TemplateLayoutProps } from "@/lib/templates/types";
import { ResumeHeader } from "@/lib/templates/shared/resume-header";
import { ResumePage } from "@/lib/templates/shared/resume-page";
import { ResumeRichText } from "@/lib/templates/shared/resume-rich-text";
import { ResumeSection } from "@/lib/templates/shared/resume-section";
import { ResumeItemHeader } from "@/lib/templates/shared/resume-item-header";
import { getSectionOrder } from "@/lib/templates/shared/render-sections";

const SIDEBAR_KEYS = new Set(["skills", "education"]);

export function ModernLayout({ content, sectionOrder, styleSettings }: TemplateLayoutProps) {
  const b = content.basics;
  const order = getSectionOrder(content, sectionOrder);

  return (
    <ResumePage
      styleSettings={styleSettings}
      maxWidthClass="max-w-[840px]"
      className="grid grid-cols-[240px_1fr] gap-6"
    >
      <aside className="space-y-4 border-r border-neutral-200 pr-4">
        <ResumeHeader basics={b} variant="modern-sidebar" />
        {order
          .filter((k) => SIDEBAR_KEYS.has(k))
          .map((key) => {
            if (key === "skills" && content.skills.length > 0) {
              return (
                <ResumeSection key="skills" sectionKey="skills" title="技能" variant="modern">
                  {content.skills.map((s, i) => (
                    <div key={i} className="mb-1.5 last:mb-0">
                      <div className="text-xs font-semibold">{s.category}</div>
                      <div className="text-xs leading-relaxed text-neutral-700">
                        {s.items.join("、")}
                      </div>
                    </div>
                  ))}
                </ResumeSection>
              );
            }
            if (key === "education" && content.education.length > 0) {
              return (
                <ResumeSection key="education" sectionKey="education" title="教育" variant="modern">
                  {content.education.map((e, i) => (
                    <div key={i} className="mb-2 text-xs last:mb-0">
                      <div className="font-semibold">{e.school}</div>
                      <div>
                        {e.degree} {e.major}
                      </div>
                      <div className="text-neutral-600">
                        {e.start} – {e.end}
                      </div>
                    </div>
                  ))}
                </ResumeSection>
              );
            }
            return null;
          })}
      </aside>
      <main className="space-y-4">
        {order
          .filter((k) => !SIDEBAR_KEYS.has(k))
          .map((key) => {
            if (key === "basics" && b.summary) {
              return (
                <ResumeSection key="basics" sectionKey="basics" title="自我介绍" variant="modern">
                  <p>{b.summary}</p>
                </ResumeSection>
              );
            }
            if (key === "experience" && content.experience.length > 0) {
              return (
                <ResumeSection
                  key="experience"
                  sectionKey="experience"
                  title="工作经历"
                  variant="modern"
                >
                  {content.experience.map((e, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <ResumeItemHeader
                        variant="modern"
                        primary={`${e.title} @ ${e.company}`}
                        dateRange={
                          e.start || e.end ? `${e.start} – ${e.end}` : undefined
                        }
                      />
                      <ResumeRichText content={e.content} />
                    </div>
                  ))}
                </ResumeSection>
              );
            }
            if (key === "projects" && content.projects.length > 0) {
              return (
                <ResumeSection
                  key="projects"
                  sectionKey="projects"
                  title="项目"
                  variant="modern"
                >
                  {content.projects.map((p, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <ResumeItemHeader
                        variant="modern"
                        primary={p.name}
                        secondary={
                          p.stack.length > 0 ? p.stack.join(" · ") : undefined
                        }
                      />
                      <ResumeRichText content={p.content} />
                    </div>
                  ))}
                </ResumeSection>
              );
            }
            const customSection = (content.custom ?? []).find((cs) => cs.id === key);
            if (customSection && customSection.content?.content?.length > 0) {
              return (
                <ResumeSection
                  key={key}
                  sectionKey={key}
                  title={customSection.title}
                  variant="modern"
                >
                  <ResumeRichText content={customSection.content} />
                </ResumeSection>
              );
            }
            return null;
          })}
      </main>
    </ResumePage>
  );
}
