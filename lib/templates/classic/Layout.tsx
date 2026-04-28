import type { ResumeContent } from "@/lib/resume-schema";

export function ClassicLayout({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <article className="mx-auto max-w-[800px] bg-white p-10 font-serif text-[13px] leading-relaxed text-black">
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold">{b.name}</h1>
        {b.title && <p className="text-base">{b.title}</p>}
        <p className="text-xs text-neutral-600">
          {[b.email, b.phone, b.location, b.website].filter(Boolean).join(" · ")}
        </p>
      </header>
      {b.summary && <Section title="自我介绍"><p>{b.summary}</p></Section>}
      {content.experience.length > 0 && (
        <Section title="工作经历">
          {content.experience.map((e, i) => (
            <div key={i} className="mb-2">
              <div className="flex justify-between font-semibold">
                <span>{e.company} — {e.title}</span>
                <span className="font-normal">{e.start} – {e.end}</span>
              </div>
              <ul className="list-disc pl-5">
                {e.bullets.map((bl, j) => <li key={j}>{bl}</li>)}
              </ul>
            </div>
          ))}
        </Section>
      )}
      {content.education.length > 0 && (
        <Section title="教育背景">
          {content.education.map((e, i) => (
            <div key={i} className="mb-1 flex justify-between">
              <span><strong>{e.school}</strong> {e.degree} {e.major}{e.gpa ? ` · GPA ${e.gpa}` : ""}</span>
              <span>{e.start} – {e.end}</span>
            </div>
          ))}
        </Section>
      )}
      {content.projects.length > 0 && (
        <Section title="项目经历">
          {content.projects.map((p, i) => (
            <div key={i} className="mb-2">
              <div className="font-semibold">{p.name} {p.stack.length > 0 && <span className="font-normal text-neutral-600">({p.stack.join(", ")})</span>}</div>
              <ul className="list-disc pl-5">{p.bullets.map((bl, j) => <li key={j}>{bl}</li>)}</ul>
            </div>
          ))}
        </Section>
      )}
      {content.skills.length > 0 && (
        <Section title="技能">
          {content.skills.map((s, i) => (
            <div key={i}><strong>{s.category}:</strong> {s.items.join(", ")}</div>
          ))}
        </Section>
      )}
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
