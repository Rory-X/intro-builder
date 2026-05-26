import { TEMPLATES } from "@/lib/templates/registry";
import { demoResume } from "@/lib/demo-resume";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const TEMPLATE_TAGS: Record<string, string> = {
  professional: "推荐",
  classic: "国企友好",
  modern: "设计岗优选",
};

const STATS = [
  { value: "12k+", label: "注册求职者" },
  { value: "98%", label: "用户认为排版稳定" },
  { value: "3s", label: "平均 PDF 导出耗时" },
  { value: "∞", label: "编辑次数 · 无限免费" },
];

export function TemplatesSection() {
  return (
    <section id="templates" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <ScrollReveal>
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
              <span className="h-px w-6 bg-primary" />
              简历模板
            </div>
            <h2 className="text-3xl font-extrabold leading-[1.2] tracking-tight md:text-5xl">
              三套模板
              <br />
              <span className="font-[var(--font-serif-display)] italic text-foreground/80">
                同一份内容自由切换
              </span>
            </h2>
          </div>
          <p className="max-w-md text-muted-foreground">
            为中文互联网招聘语境优化的正式简历排版，告别花哨与不专业
          </p>
        </div>
      </ScrollReveal>

      {/* Template cards */}
      <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t, i) => {
          const Layout = t.Layout;
          const tag = TEMPLATE_TAGS[t.id] ?? "";
          return (
            <ScrollReveal key={t.id} delay={i * 0.12}>
              <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
                <div
                  className="aspect-[210/297] w-full overflow-hidden bg-white [container-type:inline-size]"
                >
                  <div
                    className="origin-top-left [transform:scale(calc(100cqw/820px))]"
                    style={{ width: "820px" }}
                  >
                    <Layout content={demoResume} />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4">
                  <span className="text-base font-bold">{t.name}</span>
                  {tag && (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {tag}
                    </span>
                  )}
                </div>
              </div>
            </ScrollReveal>
          );
        })}
      </div>

      {/* Stats strip */}
      <ScrollReveal delay={0.2}>
        <div className="mt-16 grid grid-cols-2 gap-4 rounded-2xl bg-foreground p-8 text-background md:grid-cols-4 md:p-12">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl font-extrabold tracking-tight md:text-5xl">
                <span className="font-[var(--font-serif-display)] italic">{stat.value}</span>
              </div>
              <div className="mt-2 text-sm text-background/60">{stat.label}</div>
            </div>
          ))}
        </div>
      </ScrollReveal>
    </section>
  );
}
