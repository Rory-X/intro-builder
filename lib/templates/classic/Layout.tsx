import type { ResumeContent } from "@/lib/resume-schema";
import { RichTextRenderer } from "@/components/preview/rich-text-renderer";
import { SECTION_META } from "@/lib/section-meta";
import { Mail, Phone, MapPin, Globe } from "lucide-react";

type Props = {
  content: ResumeContent;
  sectionOrder?: string[];
};

export function ClassicLayout({ content, sectionOrder }: Props) {
  const b = content.basics;
  const order = sectionOrder ?? content.sectionOrder ?? ["basics", "experience", "education", "projects", "skills"];

  const contactItems = [
    b.email && { icon: Mail, text: b.email },
    b.phone && { icon: Phone, text: b.phone },
    b.location && { icon: MapPin, text: b.location },
    b.website && { icon: Globe, text: b.website },
  ].filter(Boolean) as { icon: React.FC<{ className?: string }>; text: string }[];

  const sections: Record<string, React.ReactNode> = {
    basics: b.summary ? <Section key="basics" sectionKey="basics" title="自我介绍"><p>{b.summary}</p></Section> : null,
    experience: content.experience.length > 0 ? (
      <Section key="experience" sectionKey="experience" title="工作经历">
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
      <Section key="education" sectionKey="education" title="教育背景">
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
      <Section key="projects" sectionKey="projects" title="项目经历">
        {content.projects.map((p, i) => (
          <div key={i} className="mb-2">
            <div className="font-semibold">{p.name} {p.stack.length > 0 && <span className="font-normal text-neutral-600">({p.stack.join(", ")})</span>}</div>
            <RichTextRenderer content={p.content} className="prose prose-sm max-w-none" />
          </div>
        ))}
      </Section>
    ) : null,
    skills: content.skills.length > 0 ? (
      <Section key="skills" sectionKey="skills" title="技能">
        {content.skills.map((s, i) => (
          <div key={i}><strong>{s.category}:</strong> {s.items.join(", ")}</div>
        ))}
      </Section>
    ) : null,
  };

  return (
    <article className="mx-auto max-w-[800px] bg-white p-10 font-serif text-[13px] leading-relaxed text-black">
      <header className="mb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 text-center">
            <h1 className="text-2xl font-bold">{b.name}</h1>
            {b.title && <p className="text-base">{b.title}</p>}
          </div>
          {b.photo && (
            <img src={b.photo} alt={b.name} className="ml-4 h-20 w-20 rounded object-cover" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          {contactItems.map((item, i) => (
            <span key={i} className="flex items-center gap-1">
              <item.icon className="h-3 w-3" />
              {item.text}
            </span>
          ))}
        </div>
      </header>
      {order.map((key) => sections[key] ?? null)}
    </article>
  );
}

function Section({ sectionKey, title, children }: { sectionKey?: string; title: string; children: React.ReactNode }) {
  const meta = sectionKey ? SECTION_META[sectionKey] : null;
  const Icon = meta?.icon;
  return (
    <section className="mt-4">
      <h2 className="mb-1 flex items-center gap-1.5 border-b border-black pb-0.5 text-sm font-bold uppercase tracking-wide">
        {Icon && <Icon className={`h-4 w-4 ${meta?.color ?? ""}`} />}
        {title}
      </h2>
      {children}
    </section>
  );
}
