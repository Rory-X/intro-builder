import type { ResumeContent } from "@/lib/resume-schema";

export function ModernLayout({ content }: { content: ResumeContent }) {
  const b = content.basics;
  return (
    <article className="mx-auto grid max-w-[820px] grid-cols-[220px_1fr] gap-6 bg-white p-8 text-[12.5px] leading-relaxed text-black">
      <aside className="space-y-4 border-r pr-4">
        <div>
          <h1 className="text-xl font-bold">{b.name}</h1>
          <p className="text-sm text-neutral-600">{b.title}</p>
        </div>
        <div className="space-y-0.5 text-xs">
          {b.email && <div>📧 {b.email}</div>}
          {b.phone && <div>📱 {b.phone}</div>}
          {b.location && <div>📍 {b.location}</div>}
          {b.website && <div>🔗 {b.website}</div>}
        </div>
        {content.skills.length > 0 && (
          <div>
            <h2 className="mb-1 text-sm font-bold">技能</h2>
            {content.skills.map((s, i) => (
              <div key={i} className="mb-1">
                <div className="text-xs font-semibold">{s.category}</div>
                <div className="text-xs text-neutral-700">{s.items.join(", ")}</div>
              </div>
            ))}
          </div>
        )}
        {content.education.length > 0 && (
          <div>
            <h2 className="mb-1 text-sm font-bold">教育</h2>
            {content.education.map((e, i) => (
              <div key={i} className="mb-1 text-xs">
                <div className="font-semibold">{e.school}</div>
                <div>{e.degree} {e.major}</div>
                <div className="text-neutral-600">{e.start} – {e.end}</div>
              </div>
            ))}
          </div>
        )}
      </aside>
      <main className="space-y-4">
        {b.summary && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">自我介绍</h2>
            <p>{b.summary}</p>
          </section>
        )}
        {content.experience.length > 0 && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">工作经历</h2>
            {content.experience.map((e, i) => (
              <div key={i} className="mb-2">
                <div className="flex justify-between">
                  <span className="font-semibold">{e.title} @ {e.company}</span>
                  <span className="text-xs text-neutral-600">{e.start} – {e.end}</span>
                </div>
                <ul className="list-disc pl-5">{e.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            ))}
          </section>
        )}
        {content.projects.length > 0 && (
          <section>
            <h2 className="mb-1 border-b pb-0.5 text-sm font-bold">项目</h2>
            {content.projects.map((p, i) => (
              <div key={i} className="mb-2">
                <div className="font-semibold">{p.name}{p.stack.length > 0 && <span className="ml-2 font-normal text-neutral-600">{p.stack.join(" · ")}</span>}</div>
                <ul className="list-disc pl-5">{p.bullets.map((x, j) => <li key={j}>{x}</li>)}</ul>
              </div>
            ))}
          </section>
        )}
      </main>
    </article>
  );
}
