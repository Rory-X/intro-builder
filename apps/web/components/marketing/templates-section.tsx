"use client";

import { useState } from "react";
import Link from "next/link";
import type { AllTemplatesItem, TemplateCategory } from "@/lib/templates/registry";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { ClientTemplateRenderFromSerializable } from "@/lib/templates/render";
import type { ResumeContent } from "@/lib/resume-schema";
import { TemplateThumbnail } from "@/components/templates/template-thumbnail";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  academic: "学术",
  tech: "互联网",
  business: "商务",
  creative: "创意",
  general: "通用",
};

const CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: "tech", label: "互联网" },
  { id: "business", label: "商务" },
  { id: "creative", label: "创意" },
  { id: "academic", label: "学术" },
  { id: "general", label: "通用" },
];

interface TemplatesSectionProps {
  allTemplates: AllTemplatesItem[];
  resolvedTemplates: SerializableResolvedTemplate[];
  demoContent: ResumeContent;
}

export function TemplatesSection({ allTemplates, resolvedTemplates, demoContent }: TemplatesSectionProps) {
  const [activeTab, setActiveTab] = useState<TemplateCategory>("tech");

  const filteredTemplates = allTemplates.filter((t) => t.category === activeTab);

  // Find the matching resolved template for rendering
  function getResolved(id: string): SerializableResolvedTemplate | undefined {
    return resolvedTemplates.find((r) => r.id === id);
  }

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
        {filteredTemplates.map((item, i) => {
          const resolved = getResolved(item.id);
          return (
            <ScrollReveal key={item.id} delay={i * 0.08}>
              <div className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
                {resolved ? (
                  <TemplateThumbnail>
                    <ClientTemplateRenderFromSerializable
                      resolved={resolved}
                      content={demoContent}
                      sectionOrder={demoContent.sectionOrder}
                      styleSettings={demoContent.styleSettings}
                    />
                  </TemplateThumbnail>
                ) : (
                  <div className="flex aspect-[210/297] w-full items-center justify-center bg-muted/30">
                    <div className="text-center text-muted-foreground/50">
                      <div className="mx-auto mb-3 h-16 w-12 rounded border-2 border-dashed border-muted-foreground/20" />
                      <span className="text-xs font-medium">即将上线</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between p-4">
                  <span className="text-sm font-bold">{item.name}</span>
                  {item.category && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {CATEGORY_LABELS[item.category] ?? item.category}
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
