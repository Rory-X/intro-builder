import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { HeroSection } from "@/components/marketing/hero-section";
import { EditorMockup } from "@/components/marketing/editor-mockup";
import { BentoFeatures } from "@/components/marketing/bento-features";
import { TemplatesSection } from "@/components/marketing/templates-section";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const COMPANIES = ["字节跳动", "美团", "腾讯", "阿里巴巴", "小红书", "百度", "京东"];

export default function Landing() {
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
      <TemplatesSection />

      {/* CTA Section */}
      <section className="relative overflow-hidden py-24 md:py-32">
        {/* Background */}
        <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
          <div className="absolute left-1/4 top-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-br from-primary/15 to-violet-500/10 blur-[80px]" />
          <div className="absolute bottom-1/4 right-1/4 h-[350px] w-[350px] rounded-full bg-gradient-to-tl from-pink-500/10 to-primary/5 blur-[60px]" />
        </div>

        <ScrollReveal className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
            下一份 Offer，
            <br />
            <span className="font-[var(--font-serif-display)] italic bg-gradient-to-r from-primary via-violet-500 to-primary bg-clip-text text-transparent animate-gradient-shift">
              从一份精致简历开始。
            </span>
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-base text-muted-foreground md:text-lg">
            注册只需一封邮件 · 30 秒进入编辑器 · 永久免费使用核心功能
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login">
              <Button
                size="lg"
                className="group gap-2 rounded-full px-8 text-base font-semibold shadow-lg shadow-primary/25"
              >
                免费创建简历
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="#templates">
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-8 text-base"
              >
                查看公开样例
              </Button>
            </Link>
          </div>
        </ScrollReveal>
      </section>

      <MarketingFooter />
    </>
  );
}
