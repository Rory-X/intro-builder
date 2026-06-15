import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  Bot,
  CheckCircle2,
  FileText,
  MessageSquare,
  Sparkles,
  WandSparkles,
} from "lucide-react";

export function EditorMockup() {
  return (
    <section className="relative mx-auto max-w-6xl px-4 pb-20">
      <ScrollReveal distance={40}>
        <div className="relative">
          {/* Floating tags */}
          <FloatingTag
            icon={<Bot className="h-3.5 w-3.5 text-primary" />}
            label="Agent 模式 · 正在诊断"
            className="absolute -right-2 top-16 z-10 hidden lg:flex animate-float-bob"
          />
          <FloatingTag
            icon={<Sparkles className="h-3.5 w-3.5 text-pink-500" />}
            label="右侧预览实时更新"
            className="absolute -left-2 bottom-24 z-10 hidden lg:flex animate-float-bob-alt"
          />
          <FloatingTag
            icon={<FileText className="h-3.5 w-3.5 text-emerald-500" />}
            label="A4 PDF · 已就绪"
            className="absolute bottom-48 right-6 z-10 hidden lg:flex animate-float-bob [animation-delay:1s]"
          />

          {/* Outer glow wrapper */}
          <div className="rounded-xl sm:rounded-2xl bg-gradient-to-b from-background/60 to-background/20 p-1.5 sm:p-3 border border-border/40 shadow-[0_30px_80px_-20px_rgba(99,102,241,0.2),0_60px_120px_-40px_rgba(236,72,153,0.1)]">
            {/* Browser chrome */}
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
              {/* Title bar */}
              <div className="flex items-center gap-2 sm:gap-4 border-b border-border/60 bg-muted/30 px-3 sm:px-4 py-2.5 sm:py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full bg-green-400" />
                </div>
                <div className="flex gap-1.5 sm:gap-2">
                  <span className="rounded-md px-2 sm:px-2.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-muted-foreground">
                    编辑
                  </span>
                  <span className="rounded-md border border-border bg-background px-2 sm:px-2.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-foreground">
                    Agent 模式
                  </span>
                  <span className="hidden sm:inline-block rounded-md px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    模板
                  </span>
                </div>
                <div className="ml-auto flex gap-1.5 sm:gap-2">
                  <span className="hidden sm:flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    分享
                  </span>
                  <span className="flex items-center gap-1 rounded-md bg-foreground px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold text-background">
                    导出 PDF
                  </span>
                </div>
              </div>

              {/* Content body */}
              <div className="grid min-h-[620px] md:h-[540px] md:min-h-0 md:grid-cols-[0.46fr_0.54fr]">
                {/* Left: Agent mode panel */}
                <div className="overflow-hidden border-b border-border/40 bg-muted/20 p-4 sm:p-5 md:border-b-0 md:border-r">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        Agent 模式
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        正在围绕「产品运营实习生」优化这份简历
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      在线
                    </span>
                  </div>

                  <div className="mb-3 rounded-lg border border-border/60 bg-background p-3">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                      <MessageSquare className="h-3.5 w-3.5 text-cyan-500" />
                      我想投递内容运营岗位，帮我看看项目经历哪里弱。
                    </div>
                    <div className="rounded-md bg-cyan-500/10 p-2.5 text-[11px] leading-relaxed text-foreground">
                      建议把「参与活动运营」改成带目标、动作和结果的表达。右侧预览会同步展示改写后的版本。
                    </div>
                  </div>

                  <div className="mb-3 grid gap-2">
                    <AgentSuggestion
                      title="诊断结果"
                      description="项目经历有动作，但缺少可量化业务结果。"
                      meta="影响：匹配度 +18%"
                    />
                    <AgentSuggestion
                      title="建议改写"
                      description="把活动执行改成「围绕拉新目标设计内容节奏」。"
                      meta="可直接应用到预览"
                      highlighted
                    />
                    <AgentSuggestion
                      title="求职文档引用"
                      description="内容运营 JD 常看内容策划、数据复盘与跨团队协作。"
                      meta="来自岗位准备清单"
                    />
                  </div>

                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-foreground">
                      <WandSparkles className="h-3.5 w-3.5 text-primary" />
                      一键应用到右侧预览
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Agent 先给出诊断，再把可接受的改写写回简历内容，保留你的最终确认权。
                    </p>
                  </div>
                </div>

                {/* Right: A4 Preview */}
                <div className="flex flex-1 items-start justify-center overflow-hidden bg-muted/40 p-4 sm:p-6 dark:bg-muted/20">
                  <div className="w-full max-w-[420px] rounded bg-white p-4 sm:p-6 shadow-md dark:shadow-black/20">
                    <div className="mb-3 flex items-center justify-between border-b border-cyan-100 pb-2 text-[9px] font-semibold text-cyan-600">
                      <span>实时 A4 预览</span>
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Agent 改写已应用
                      </span>
                    </div>
                    {/* Name */}
                    <div className="text-center text-lg font-extrabold tracking-wide text-gray-900">
                      陈晓晨
                    </div>
                    <div className="mt-1 border-b border-gray-900 pb-3 text-center text-[10px] text-gray-500">
                      13600009127 · chen@example.com · 上海
                    </div>

                    {/* Summary */}
                    <A4Section title="个人总结" />
                    <p className="text-[10px] leading-relaxed text-gray-600">
                      面向互联网内容运营岗位，具备校园增长、内容策划与数据复盘经验，能将用户洞察转化为可执行的活动方案。
                    </p>

                    {/* Experience */}
                    <A4Section title="项目经历" />
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">校园内容增长项目</span>
                      <span className="text-[9px] text-gray-400">2025.03 – 2025.06</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">项目负责人 · 内容策划 / 数据复盘</div>
                    <A4Bullet highlighted>围绕新用户拉新目标设计 4 周内容节奏，拆分选题、渠道与发布时间。</A4Bullet>
                    <A4Bullet>协同设计同学产出 12 组海报与短文案，活动页访问量提升 46%。</A4Bullet>

                    <div className="mt-2 flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">社区用户访谈复盘</span>
                      <span className="text-[9px] text-gray-400">2024.11 – 2025.01</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">调研执行 · 访谈提纲 / 结论沉淀</div>
                    <A4Bullet>完成 18 位目标用户访谈，归纳 5 类高频求职内容需求。</A4Bullet>

                    {/* Projects */}
                    <A4Section title="实习经历" />
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-bold text-gray-900">青木科技</span>
                      <span className="text-[9px] text-gray-400">2024.07 – 2024.10</span>
                    </div>
                    <div className="mb-1 text-[9px] text-gray-400">产品运营实习生</div>
                    <A4Bullet>维护社群内容日历，跟踪报名、转化与留存数据，输出周报建议。</A4Bullet>
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

function AgentSuggestion({
  title,
  description,
  meta,
  highlighted,
}: {
  title: string;
  description: string;
  meta: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        highlighted
          ? "border-cyan-500/30 bg-cyan-500/10"
          : "border-border/60 bg-background"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-foreground">{title}</span>
        <span className="shrink-0 text-[9px] font-medium text-muted-foreground">{meta}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
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

function A4Bullet({
  children,
  highlighted,
}: {
  children: React.ReactNode;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`relative mb-0.5 pl-2.5 text-[10px] leading-relaxed ${
        highlighted ? "rounded-sm bg-cyan-50 py-0.5 pr-1 text-gray-800" : "text-gray-600"
      }`}
    >
      <span className="absolute left-0.5 top-[7px] h-[3px] w-[3px] rounded-full bg-gray-500" />
      {children}
    </div>
  );
}
