import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, LayoutGrid, Share2 } from "lucide-react";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";
import { demoResume } from "@/lib/demo-resume";

export default function Landing() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 py-16 text-center md:py-24">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl">
          为互联网求职者打造的简历工具
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground md:text-lg">
          结构化分区编辑 · 自动保存 · 一键导出 PDF · 公开分享链接
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/login"><Button size="lg">免费开始</Button></Link>
          <Link href="#templates"><Button size="lg" variant="outline">看模板</Button></Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            icon={<LayoutGrid className="h-6 w-6" />}
            title="结构化分区"
            desc="基础信息、工作、项目、教育、技能分别编辑，所见即所得。"
          />
          <FeatureCard
            icon={<FileText className="h-6 w-6" />}
            title="双模板"
            desc="经典 / 现代两套预设，一键切换，适配国内外简历偏好。"
          />
          <FeatureCard
            icon={<Share2 className="h-6 w-6" />}
            title="分享链接"
            desc="一键生成 /r/xxx 公开只读链接，投递时直接发 HR。"
          />
        </div>
      </section>

      {/* Templates preview */}
      <section id="templates" className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="mb-6 text-center text-2xl font-bold md:text-3xl">两套模板，任选一套</h2>
        <Tabs defaultValue="classic" className="w-full">
          <TabsList className="mx-auto mb-6 grid w-fit grid-cols-2">
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

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-12">
        <h2 className="mb-6 text-center text-2xl font-bold md:text-3xl">常见问题</h2>
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
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground md:flex-row">
          <span>intro-builder · v0.1.1</span>
          <div className="flex gap-4">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
            <Link href="/terms" className="hover:text-foreground">用户协议</Link>
          </div>
        </div>
      </footer>
    </>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="text-primary">{icon}</div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function TemplateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded border bg-slate-50 shadow-sm">
      <div className="origin-top-left scale-[0.55] md:scale-[0.72]" style={{ transformOrigin: "top left" }}>
        <div className="w-[820px]">{children}</div>
      </div>
    </div>
  );
}
