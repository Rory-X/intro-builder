import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero-section";
import { EditorMockup } from "@/components/marketing/editor-mockup";
import { BentoFeatures } from "@/components/marketing/bento-features";
import { CollaborationMockup } from "@/components/marketing/collaboration-mockup";
import { TemplatesSection } from "@/components/marketing/templates-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { listAllTemplatesAsync } from "@/lib/templates/registry-server";
import { listUploadedTemplates } from "@/lib/templates/uploaded/fetch";
import { uploadedTemplateToSerializable } from "@/lib/templates/render";
import { demoResume } from "@/lib/demo-resume";
import type { SerializableResolvedTemplate } from "@/lib/templates/render";
import { SEO_CONFIG } from "@/lib/seo-config";

export const metadata: Metadata = {
  title: SEO_CONFIG.pages.home.title,
  description: SEO_CONFIG.pages.home.description,
  keywords: SEO_CONFIG.pages.home.keywords,
  openGraph: {
    title: SEO_CONFIG.pages.home.title,
    description: SEO_CONFIG.pages.home.description,
    url: SEO_CONFIG.siteUrl,
    siteName: SEO_CONFIG.siteName,
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO_CONFIG.pages.home.title,
    description: SEO_CONFIG.pages.home.description,
  },
  alternates: {
    canonical: SEO_CONFIG.siteUrl,
  },
};

const COMPANIES = ["字节跳动", "美团", "腾讯", "阿里巴巴", "小红书", "百度", "京东"];

export default async function Landing() {
  const allTemplates = await listAllTemplatesAsync();
  const uploaded = await listUploadedTemplates();

  const resolvedList: SerializableResolvedTemplate[] = uploaded
    .filter((t) => t.html)
    .map((t) => uploadedTemplateToSerializable(t.id, t));

  return (
    <>
      <HeroSection />
      <EditorMockup />

      {/* Logo Ribbon */}
      <section className="border-y border-border/40 bg-muted/20 py-8">
        <div className="mx-auto max-w-5xl px-4">
          <p className="mb-5 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            深受来自这些公司的求职者信赖
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 opacity-50">
            {COMPANIES.map((c) => (
              <span
                key={c}
                className="text-lg font-bold tracking-tight text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </section>

      <BentoFeatures />
      <CollaborationMockup />
      <TemplatesSection allTemplates={allTemplates} resolvedTemplates={resolvedList} demoContent={demoResume} />

      {/* CTA Section */}
      <section className="border-y border-border/50 bg-muted/25 py-20 md:py-28">
        <ScrollReveal className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-3xl font-extrabold leading-[1.2] tracking-tight md:text-6xl lg:text-7xl">
            下一份 Offer
            <br />
            <span className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 bg-clip-text font-[var(--font-serif-display)] italic text-transparent">
              从一份精致简历开始
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
            顺滑编辑、AI 辅助、求职文档与 PDF 交付都在这里。注册只需一封邮件，30 秒进入工作台。
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login">
              <Button
                size="lg"
                className="group gap-2 rounded-full px-8 text-base font-semibold shadow-lg shadow-cyan-500/20"
              >
                免费创建简历
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/docs">
              <Button
                size="lg"
                variant="outline"
                className="gap-2 rounded-full px-8 text-base"
              >
                <BookOpen className="h-4 w-4" />
                查看求职文档
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </section>

      <MarketingFooter />
    </>
  );
}
