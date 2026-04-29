import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, LayoutGrid, Share2, ArrowRight, Sparkles, Shield, Zap } from "lucide-react";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";
import { demoResume } from "@/lib/demo-resume";

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <section className="relative mx-auto max-w-5xl px-4 py-20 text-center md:py-32">
        {/* Subtle background glow */}
        <div className="pointer-events-none absolute inset-0 -z-10 mx-auto max-w-lg opacity-30 blur-3xl" aria-hidden>
          <div className="aspect-square w-full rounded-full bg-primary/40" />
        </div>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          <span>免费使用，无需信用卡</span>
        </div>

        <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
          <span className="bg-gradient-to-r from-foreground via-foreground/90 to-foreground/70 bg-clip-text text-transparent">
            为互联网求职者打造的
          </span>
          <br />
          <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            专业简历工具
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          结构化分区编辑 · 实时预览 · 自动保存 · 一键导出 PDF · 公开分享链接
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login">
            <Button size="lg" className="group gap-2 px-6 shadow-md shadow-primary/20 transition-all duration-200 hover:shadow-lg hover:shadow-primary/30">
              免费开始
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <Link href="#templates">
            <Button size="lg" variant="outline" className="px-6">
              查看模板
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold md:text-3xl">为什么选择 intro-builder</h2>
          <p className="mt-2 text-muted-foreground">专注简历内容，让排版不再烦人</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            icon={<LayoutGrid className="h-5 w-5" />}
            title="结构化分区"
            desc="基础信息、工作、项目、教育、技能分别编辑，所见即所得，拖拽排序。"
            color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          />
          <FeatureCard
            icon={<FileText className="h-5 w-5" />}
            title="双模板切换"
            desc="经典 / 现代两套预设，一键切换，适配国内外简历偏好，内容不丢失。"
            color="bg-purple-500/10 text-purple-600 dark:text-purple-400"
          />
          <FeatureCard
            icon={<Share2 className="h-5 w-5" />}
            title="分享链接"
            desc="一键生成公开只读链接，投递时直接发 HR，随时可关闭。"
            color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
        </div>

        {/* Secondary features */}
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
              <Zap className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">自动保存</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">编辑 2 秒后自动保存，再也不怕内容丢失</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10">
              <Shield className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">数据安全</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">数据仅你可见，未分享则完全私密</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
              <FileText className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">PDF 导出</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">内置思源黑体，A4 规范 PDF 一键下载</p>
            </div>
          </div>
        </div>
      </section>

      {/* Templates preview */}
      <section id="templates" className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold md:text-3xl">两套模板，任选一套</h2>
          <p className="mt-2 text-muted-foreground">同一份内容，不同的展示风格</p>
        </div>
        <Tabs defaultValue="classic" className="w-full">
          <TabsList className="mx-auto mb-8 grid w-fit grid-cols-2 gap-1">
            <TabsTrigger value="classic">经典</TabsTrigger>
            <TabsTrigger value="modern">现代</TabsTrigger>
          </TabsList>
          <TabsContent value="classic">
            <TemplateFrame><ClassicLayout content={demoResume} /></TemplateFrame>
          </TabsContent>
          <TabsContent value="modern">
            <TemplateFrame><ModernLayout content={demoResume} /></TemplateFrame>
          </TabsContent>
        </Tabs>
      </section>

      {/* CTA Banner */}
      <section className="mx-auto max-w-5xl px-4 py-8">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-8 py-12 text-center text-primary-foreground shadow-lg shadow-primary/20">
          <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <h2 className="relative text-2xl font-bold md:text-3xl">准备好做你的专属简历了吗？</h2>
          <p className="relative mt-3 text-primary-foreground/80">注册只需一封邮件，30 秒开始编辑</p>
          <Link href="/login" className="relative mt-6 inline-block">
            <Button size="lg" variant="secondary" className="gap-2 px-8 font-semibold shadow-md">
              立即开始
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold md:text-3xl">常见问题</h2>
        </div>
        <Accordion className="w-full">
          <AccordionItem value="q1">
            <AccordionTrigger>数据安全吗？</AccordionTrigger>
            <AccordionContent>
              简历内容存储在 Neon Postgres（欧盟/美国托管），仅你自己可以访问，除非你开启了公开分享。
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="q2">
            <AccordionTrigger>真的免费吗？</AccordionTrigger>
            <AccordionContent>
              当前 100% 免费，没有付费墙。未来若加付费模板，已有的经典/现代模板会继续免费。
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="q3">
            <AccordionTrigger>能随时换模板吗？</AccordionTrigger>
            <AccordionContent>
              可以。同一份简历内容可在任意模板间切换，内容不会丢。
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="q4">
            <AccordionTrigger>PDF 支持中文吗？</AccordionTrigger>
            <AccordionContent>
              支持。内置思源黑体子集，导出 A4 规范 PDF，可直接用于投递。
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/30 py-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">ib</span>
            <span>intro-builder &middot; v0.2.2</span>
          </div>
          <div className="flex gap-6">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="transition-colors duration-200 hover:text-foreground">GitHub</a>
            <Link href="/terms" className="transition-colors duration-200 hover:text-foreground">用户协议</Link>
          </div>
        </div>
      </footer>
    </>
  );
}

function FeatureCard({ icon, title, desc, color }: { icon: React.ReactNode; title: string; desc: string; color: string }) {
  return (
    <Card className="group cursor-default transition-all duration-200 hover:shadow-md hover:shadow-primary/5">
      <CardContent className="space-y-3 pt-6">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
          {icon}
        </div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function TemplateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-xl border bg-white shadow-lg shadow-black/5 [container-type:inline-size] dark:bg-neutral-900" style={{ aspectRatio: "210/297" }}>
      <div className="origin-top-left [transform:scale(calc(100cqw/820px))]" style={{ width: "820px" }}>
        {children}
      </div>
    </div>
  );
}
