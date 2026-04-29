import type { ResumeContent } from "@/lib/resume-schema";
import { RichTextRenderer } from "@/components/preview/rich-text-renderer";
import { SECTION_META } from "@/lib/section-meta";
import { Mail, Phone, MapPin, Globe } from "lucide-react";

type Props = {
  content: ResumeContent;
  sectionOrder?: string[];
};

export function ModernLayout({ content, sectionOrder }: Props) {
  const b = content.basics;
  const order = sectionOrder ?? content.sectionOrder ?? ["basics", "experience", "education", "projects", "skills"];
  const sidebarKeys = new Set(["skills", "education"]);

  return (
    <article className="mx-auto grid max-w-[820px] grid-cols-[220px_1fr] gap-6 bg-white p-8 text-[12.5px] leading-relaxed text-black">
      <aside className="space-y-4 border-r pr-4">
        {b.photo && (
          <img src={b.photo} alt={b.name} className="mx-auto h-24 w-24 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-xl font-bold">{b.name}</h1>
          <p className="text-sm text-neutral-600">{b.title}</p>
        </div>
        <div className="space-y-1 text-xs">
          {b.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-neutral-500" />{b.email}</div>}
          {b.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-neutral-500" />{b.phone}</div>}
          {b.location && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3 text-neutral-500" />{b.location}</div>}
          {b.website && <div className="flex items-center gap-1.5"><Globe className="h-3 w-3 text-neutral-500" />{b.website}</div>}
        </div>
        {order.filter((k) => sidebarKeys.has(k)).map((key) => {
          if (key === "skills" && content.skills.length > 0) {
            const meta = SECTION_META.skills;
            return (
              <div key="skills">
                <h2 className="mb-1 flex items-center gap-1 text-sm font-bold">
                  <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />技能
                </h2>
                {content.skills.map((s, i) => (
                  <div key={i} className="mb-1">
                    <div className="text-xs font-semibold">{s.category}</div>
                    <div className="text-xs text-neutral-700">{s.items.join(", ")}</div>
                  </div>
                ))}
              </div>
            );
          }
          if (key === "education" && content.education.length > 0) {
            const meta = SECTION_META.education;
            return (
              <div key="education">
                <h2 className="mb-1 flex items-center gap-1 text-sm font-bold">
                  <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />教育
                </h2>
                {content.education.map((e, i) => (
                  <div key={i} className="mb-1 text-xs">
                    <div className="font-semibold">{e.school}</div>
                    <div>{e.degree} {e.major}</div>
                    <div className="text-neutral-600">{e.start} – {e.end}</div>
                  </div>
                ))}
              </div>
            );
          }
          return null;
        })}
      </aside>
      <main className="space-y-4">
        {order.filter((k) => !sidebarKeys.has(k)).map((key) => {
          if (key === "basics" && b.summary) {
            return (
              <section key="basics">
                <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">自我介绍</h2>
                <p>{b.summary}</p>
              </section>
            );
          }
          if (key === "experience" && content.experience.length > 0) {
            const meta = SECTION_META.experience;
            return (
              <section key="experience">
                <h2 className="mb-1 flex items-center gap-1 border-b pb-0.5 text-sm font-bold">
                  <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />工作经历
                </h2>
                {content.experience.map((e, i) => (
                  <div key={i} className="mb-2">
                    <div className="flex justify-between">
                      <span className="font-semibold">{e.title} @ {e.company}</span>
                      <span className="text-xs text-neutral-600">{e.start} – {e.end}</span>
                    </div>
                    <RichTextRenderer content={e.content} className="prose prose-sm max-w-none" />
                  </div>
                ))}
              </section>
            );
          }
          if (key === "projects" && content.projects.length > 0) {
            const meta = SECTION_META.projects;
            return (
              <section key="projects">
                <h2 className="mb-1 flex items-center gap-1 border-b pb-0.5 text-sm font-bold">
                  <meta.icon className={`h-3.5 w-3.5 ${meta.color}`} />项目
                </h2>
                {content.projects.map((p, i) => (
                  <div key={i} className="mb-2">
                    <div className="font-semibold">{p.name}{p.stack.length > 0 && <span className="ml-2 font-normal text-neutral-600">{p.stack.join(" · ")}</span>}</div>
                    <RichTextRenderer content={p.content} className="prose prose-sm max-w-none" />
                  </div>
                ))}
              </section>
            );
          }
          return null;
        })}
      </main>
    </article>
  );
}
