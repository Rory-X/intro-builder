"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { TEMPLATES } from "@/lib/templates/registry";
import type { AllTemplatesItem } from "@/lib/templates/registry";
import type { ResumeContent } from "@/lib/resume-schema";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const TEMPLATE_TAGS: Record<string, string> = {
  professional: "单栏 · 通用",
  classic: "衬线 · 国企友好",
  modern: "双栏 · 头像",
};

const CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "general", label: "简洁" },
  { id: "tech", label: "时间线" },
  { id: "business", label: "双栏" },
  { id: "creative", label: "创意" },
  { id: "academic", label: "学术" },
];

interface TemplatesSectionProps {
  allTemplates: AllTemplatesItem[];
  demoContent: ResumeContent;
}

export function TemplatesSection({ allTemplates, demoContent }: TemplatesSectionProps) {
  const [activeTab, setActiveTab] = useState("all");

  const filteredTemplates = activeTab === "all"
    ? allTemplates
    : allTemplates.filter((t) => t.category === activeTab);

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
        <Link href="/templates">
          <Button variant="outline" className="gap-2 rounded-full">
            查看完整模板库
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Template grid */}
      <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {filteredTemplates.map((item, i) => (
          <ScrollReveal key={item.id} delay={i * 0.08}>
            <TemplateCard item={item} demoContent={demoContent} />
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

function TemplateCard({ item, demoContent }: { item: AllTemplatesItem; demoContent: ResumeContent }) {
  // Built-in templates: render live preview using Layout component
  if (item.source === "builtin") {
    const builtinMeta = TEMPLATES.find((t) => t.id === item.id);
    if (builtinMeta) {
      const Layout = builtinMeta.Layout;
      const tag = TEMPLATE_TAGS[item.id] ?? item.tags?.[0] ?? "";
      return (
        <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
          <div className="aspect-[210/297] w-full overflow-hidden bg-white [container-type:inline-size]">
            <div
              className="origin-top-left [transform:scale(calc(100cqw/820px))]"
              style={{ width: "820px" }}
            >
              <Layout content={demoContent} />
            </div>
          </div>
          <div className="flex items-center justify-between p-4">
            <span className="text-sm font-bold">{item.name}</span>
            {tag && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tag}
              </span>
            )}
          </div>
        </div>
      );
    }
  }

  // Uploaded templates: show thumbnail or placeholder
  const tag = item.tags?.[0] ?? item.category ?? "";
  return (
    <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
      <div className="aspect-[210/297] w-full overflow-hidden bg-muted/30">
        {item.thumbnailUrl ? (
          <Image
            src={item.thumbnailUrl}
            alt={item.name}
            width={420}
            height={594}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <div className="text-center text-muted-foreground/50">
              <div className="mx-auto mb-3 h-16 w-12 rounded border-2 border-dashed border-muted-foreground/20" />
              <span className="text-xs font-medium">即将上线</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between p-4">
        <span className="text-sm font-bold">{item.name}</span>
        {tag && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {tag}
          </span>
        )}
      </div>
    </div>
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
