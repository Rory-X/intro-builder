"use client";

import { useState } from "react";
import Link from "next/link";
import { TEMPLATES } from "@/lib/templates/registry";
import { demoResume } from "@/lib/demo-resume";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const TEMPLATE_TAGS: Record<string, string> = {
  professional: "单栏 · 通用",
  classic: "衬线 · 国企友好",
  modern: "双栏 · 头像",
};

/** Placeholder templates that don't exist yet — shown as static mockups */
const UPCOMING_TEMPLATES = [
  { id: "timeline", name: "时间线", tag: "视觉 · 单栏" },
  { id: "academic", name: "学术", tag: "衬线 · 英文" },
  { id: "creative", name: "创意", tag: "设计岗" },
  { id: "minimal", name: "极简", tag: "居中 · 留白" },
  { id: "compact", name: "紧凑双栏", tag: "高密度" },
];

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "simple", label: "简洁" },
  { id: "timeline", label: "时间线" },
  { id: "two-col", label: "双栏" },
  { id: "creative", label: "创意" },
  { id: "academic", label: "学术" },
];

export function TemplatesSection() {
  const [activeTab, setActiveTab] = useState("all");

  return (
    <section id="templates" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <ScrollReveal>
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
          <span className="h-px w-6 bg-primary" />
          模板库
        </div>
        <h2 className="text-3xl font-extrabold leading-[1.2] tracking-tight md:text-5xl">
          精挑模板库，
          <br />
          <span className="font-[var(--font-serif-display)] italic text-foreground/80">
            一键试穿你的内容
          </span>
        </h2>
      </ScrollReveal>

      {/* Category tabs + CTA */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveTab(cat.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === cat.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <Link href="/login">
          <Button variant="outline" className="gap-2 rounded-full">
            查看完整模板库
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Template grid */}
      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Real templates */}
        {TEMPLATES.map((t, i) => {
          const Layout = t.Layout;
          const tag = TEMPLATE_TAGS[t.id] ?? "";
          return (
            <ScrollReveal key={t.id} delay={i * 0.1}>
              <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
                <div className="aspect-[210/297] w-full overflow-hidden bg-white [container-type:inline-size]">
                  <div
                    className="origin-top-left [transform:scale(calc(100cqw/820px))]"
                    style={{ width: "820px" }}
                  >
                    <Layout content={demoResume} />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4">
                  <span className="text-sm font-bold">{t.name}</span>
                  {tag && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tag}
                    </span>
                  )}
                </div>
              </div>
            </ScrollReveal>
          );
        })}

        {/* Upcoming / placeholder templates */}
        {UPCOMING_TEMPLATES.map((t, i) => (
          <ScrollReveal key={t.id} delay={(TEMPLATES.length + i) * 0.1}>
            <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
              <div className="flex aspect-[210/297] w-full items-center justify-center bg-muted/30">
                <div className="text-center text-muted-foreground/50">
                  <div className="mx-auto mb-3 h-16 w-12 rounded border-2 border-dashed border-muted-foreground/20" />
                  <span className="text-xs font-medium">即将上线</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-4">
                <span className="text-sm font-bold">{t.name}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t.tag}
                </span>
              </div>
            </div>
          </ScrollReveal>
        ))}
      </div>

      {/* Stats strip */}
      <ScrollReveal delay={0.2}>
        <div className="mt-16 grid grid-cols-2 gap-4 rounded-2xl bg-foreground p-8 text-background md:grid-cols-4 md:p-12">
          <StatItem value="12k+" label="注册求职者" />
          <StatItem value="98%" label="用户认为排版稳定" />
          <StatItem value="3s" label="平均 PDF 导出耗时" />
          <StatItem value="∞" label="编辑次数 · 无限免费" />
        </div>
      </ScrollReveal>
    </section>
  );
}

function StatItem({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-extrabold tracking-tight md:text-5xl">
        <span className="font-[var(--font-serif-display)] italic">{value}</span>
      </div>
      <div className="mt-2 text-sm text-background/60">{label}</div>
    </div>
  );
}
