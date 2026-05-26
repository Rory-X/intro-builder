import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { Bolt, MessageSquare, FileText } from "lucide-react";

export function EditorMockup() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pb-20">
      <ScrollReveal distance={40}>
        <div className="relative">
          {/* Floating tags */}
          <FloatingTag
            icon={<Bolt className="h-3.5 w-3.5 text-primary" />}
            label="实时同步预览"
            className="absolute -right-2 top-16 z-10 hidden lg:flex animate-float-bob"
          />
          <FloatingTag
            icon={<MessageSquare className="h-3.5 w-3.5 text-pink-500" />}
            label="导师批注 · 2 条新评论"
            className="absolute -left-2 bottom-24 z-10 hidden lg:flex animate-float-bob-alt"
          />
          <FloatingTag
            icon={<FileText className="h-3.5 w-3.5 text-emerald-500" />}
            label="A4 PDF · 已就绪"
            className="absolute bottom-48 right-6 z-10 hidden lg:flex animate-float-bob [animation-delay:1s]"
          />

          {/* Outer glow wrapper */}
          <div className="rounded-2xl bg-gradient-to-b from-background/60 to-background/20 p-3 border border-border/40 shadow-[0_30px_80px_-20px_rgba(99,102,241,0.2),0_60px_120px_-40px_rgba(236,72,153,0.1)]">
            {/* Browser chrome */}
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
              {/* Title bar */}
              <div className="flex items-center gap-4 border-b border-border/60 bg-muted/30 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-green-400" />
                </div>
                <div className="flex gap-2">
                  <span className="rounded-md border border-border bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground">
                    编辑
                  </span>
                  <span className="rounded-md px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    模板
                  </span>
                  <span className="rounded-md px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    协作
                  </span>
                </div>
                <div className="ml-auto flex gap-2">
                  <span className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    分享
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[11px] font-semibold text-background">
                    导出 PDF
                  </span>
                </div>
              </div>

              {/* Content body */}
              <div className="flex h-[420px] md:h-[520px]">
                {/* Left: Editor panel */}
                <div className="w-[42%] overflow-hidden border-r border-border/40 bg-muted/20 p-5">
                  {/* Section: Basics */}
                  <div className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    基础信息
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <MockField label="姓名" value="林小明" />
                    <MockField label="求职方向" value="全栈工程师" focused />
                  </div>
                  <div className="mb-5 grid grid-cols-2 gap-2">
                    <MockField label="电话" value="139 ···· 8826" />
                    <MockField label="邮箱" value="xiaoming@example.com" />
                  </div>

                  {/* Section: Experience */}
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    工作经历
                  </div>
                  <ExperienceCard
                    company="星辰科技有限公司"
                    role="全栈开发工程师 · 深圳"
                    date="2023.03 → 2024.06"
                  />
                  <ExperienceCard
                    company="云帆信息技术"
                    role="后端开发实习生 · 杭州"
                    date="2022.06 → 2022.12"
                  />
                </div>

                {/* Right: A4 Preview */}
                <div className="flex flex-1 items-start justify-center overflow-hidden bg-muted/40 p-6 dark:bg-muted/20">
                  <div className="w-full max-w-[420px] rounded bg-white p-6 shadow-md dark:shadow-black/20">
                    {/* Name */}
                    <div className="text-center text-lg font-extrabold tracking-wide text-gray-900">
                      林小明
                    </div>
                    <div className="mt-1 border-b border-gray-900 pb-3 text-center text-[10px] text-gray-500">
                      13988668826 · xiaoming@example.com · 深圳
                    </div>

                    {/* Summary */}
                    <A4Section title="个人总结" />
                    <p className="text-[10px] leading-relaxed text-gray-600">
                      3 年全栈开发经验，熟悉 React / Node.js / Go 技术栈，主导过多个 B 端 SaaS 产品从 0 到 1 落地，擅长系统设计与性能优化。
                    </p>

                    {/* Experience */}
                    <A4Section title="工作经历" />
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">星辰科技有限公司</span>
                      <span className="text-[9px] text-gray-400">2023.03 – 2024.06</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">全栈开发工程师 · 深圳</div>
                    <A4Bullet>负责内部 CRM 系统架构设计与开发，服务 200+ 销售人员日常使用。</A4Bullet>
                    <A4Bullet>设计并实现实时消息推送服务，QPS 峰值 5000+，99.9% 可用性。</A4Bullet>

                    <div className="mt-2 flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">云帆信息技术</span>
                      <span className="text-[9px] text-gray-400">2022.06 – 2022.12</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">后端开发实习生 · 杭州</div>
                    <A4Bullet>参与电商订单系统微服务拆分，接口响应时间降低 40%。</A4Bullet>

                    {/* Projects */}
                    <A4Section title="项目经历" />
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">TaskFlow 协作平台</span>
                      <span className="text-[9px] text-gray-400">2024.01 – 2024.05</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">核心开发 · React · Go · PostgreSQL</div>
                    <A4Bullet>面向中小团队的项目管理工具，支持看板、甘特图与自动化工作流。</A4Bullet>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}

function FloatingTag({
  icon,
  label,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3.5 py-2 text-xs font-semibold shadow-lg backdrop-blur-sm ${className ?? ""}`}
    >
      {icon}
      {label}
    </div>
  );
}

function MockField({
  label,
  value,
  focused,
}: {
  label: string;
  value: string;
  focused?: boolean;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">{label}</div>
      <div
        className={`rounded-md border px-2 py-1.5 text-[11px] text-foreground ${
          focused
            ? "border-primary bg-background shadow-[0_0_0_2px_rgba(99,102,241,0.12)]"
            : "border-border/60 bg-background"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ExperienceCard({
  company,
  role,
  date,
}: {
  company: string;
  role: string;
  date: string;
}) {
  return (
    <div className="mb-2 rounded-lg border border-border/60 bg-background p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">{company}</span>
        <span className="text-[9px] text-muted-foreground">{date}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{role}</div>
    </div>
  );
}

function A4Section({ title }: { title: string }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-1.5 border-b border-gray-200 pb-1 text-[11px] font-extrabold text-gray-900">
      <span className="h-1.5 w-1.5 rounded-[1px] bg-gray-900" />
      {title}
    </div>
  );
}

function A4Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mb-0.5 pl-2.5 text-[10px] leading-relaxed text-gray-600">
      <span className="absolute left-0.5 top-[6px] h-[3px] w-[3px] rounded-full bg-gray-500" />
      {children}
    </div>
  );
}
