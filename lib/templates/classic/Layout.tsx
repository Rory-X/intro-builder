import type { ResumeContent } from "@/lib/resume-schema";
import { RichTextRenderer } from "@/components/preview/rich-text-renderer";

type Props = {
  content: ResumeContent;
  sectionOrder?: string[];
};

export function ClassicLayout({ content, sectionOrder }: Props) {
  const b = content.basics;
  const order = sectionOrder ?? content.sectionOrder ?? ["basics", "experience", "education", "projects", "skills"];

  const sections: Record<string, React.ReactNode> = {
    basics: b.summary ? <Section key="basics" title="自我介绍"><p>{b.summary}</p></Section> : null,
    experience: content.experience.length > 0 ? (
      <Section key="experience" title="工作经历">
        {content.experience.map((e, i) => (
          <div key={i} className="mb-2">
            <div className="flex justify-between font-semibold">
              <span>{e.company} — {e.title}</span>
              <span className="font-normal">{e.start} – {e.end}</span>
            </div>
            <RichTextRenderer content={e.content} className="prose prose-sm max-w-none" />
          </div>
        ))}
      </Section>
    ) : null,
    education: content.education.length > 0 ? (
      <Section key="education" title="教育背景">
        {content.education.map((e, i) => (
          <div key={i} className="mb-1">
            <div className="flex justify-between">
              <span><strong>{e.school}</strong> {e.degree} {e.major}{e.gpa ? ` · GPA ${e.gpa}` : ""}</span>
              <span>{e.start} – {e.end}</span>
            </div>
            <RichTextRenderer content={e.highlights} className="prose prose-sm max-w-none" />
          </div>
        ))}
      </Section>
    ) : null,
    projects: content.projects.length > 0 ? (
      <Section key="projects" title="项目经历">
        {content.projects.map((p, i) => (
          <div key={i} className="mb-2">
            <div className="font-semibold">{p.name} {p.stack.length > 0 && <span className="font-normal text-neutral-600">({p.stack.join(", ")})</span>}</div>
            <RichTextRenderer content={p.content} className="prose prose-sm max-w-none" />
          </div>
        ))}
      </Section>
    ) : null,
    skills: content.skills.length > 0 ? (
      <Section key="skills" title="技能">
        {content.skills.map((s, i) => (
          <div key={i}><strong>{s.category}:</strong> {s.items.join(", ")}</div>
        ))}
      </Section>
    ) : null,
  };

  return (
    <article className="mx-auto max-w-[800px] bg-white p-10 font-serif text-[13px] leading-relaxed text-black">
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold">{b.name}</h1>
        {b.title && <p className="text-base">{b.title}</p>}
        <p className="text-xs text-neutral-600">
          {[b.email, b.phone, b.location, b.website].filter(Boolean).join(" · ")}
        </p>
      </header>
      {order.map((key) => sections[key] ?? null)}
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="mb-1 border-b border-black pb-0.5 text-sm font-bold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}
