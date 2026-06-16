import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  Highlighter,
  MessageSquare,
  Mic,
  Share2,
  UserRound,
  Users,
} from "lucide-react";

const COMMENT_ITEMS = [
  {
    section: "项目经历",
    time: "16:10",
    quote: "负责增长活动配置与数据看板",
    body: "这里可以补一个结果指标，比如活动配置效率提升多少。",
  },
  {
    section: "工作经历",
    time: "16:14",
    quote: "支持运营同学完成周报",
    body: "建议改成更主动的表达：搭建自动化周报模板。",
  },
];

export function CollaborationMockup() {
  return (
    <section id="collaboration" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <ScrollReveal className="max-w-3xl">
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
          <span className="h-px w-6 bg-primary" />
          协作审阅
        </div>
        <h2 className="text-3xl font-extrabold leading-[1.2] tracking-tight md:text-5xl">
          找人帮你改，
          <br />
          <span className="font-[var(--font-serif-display)] italic text-foreground/80">
            也能改得有秩序
          </span>
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          通过只读审阅链接邀请导师、同学或朋友。帮改模式适合让对方直接进入编辑器调整内容，批注模式适合围绕简历原文讨论。
        </p>
      </ScrollReveal>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <ScrollReveal delay={0.08}>
          <ReviewModeMockup />
        </ScrollReveal>
        <ScrollReveal delay={0.16}>
          <CommentModeMockup />
        </ScrollReveal>
      </div>
    </section>
  );
}

function ReviewModeMockup() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-slate-950 text-slate-100 shadow-xl shadow-slate-950/10">
      <MockupTopBar mode="帮改模式" tone="green" />
      <div className="border-b border-blue-500/40 bg-blue-500/10 px-4 py-2 text-xs text-blue-300">
        协作动态 [16:28] 对方修改了「基本信息」
      </div>
      <div className="grid grid-cols-1 md:h-[560px] md:grid-cols-[1.05fr_0.95fr]">
        <div className="overflow-hidden border-b border-white/10 bg-slate-900/70 p-4 md:border-b-0 md:border-r">
          <EditorSection title="基础信息" count="1" accent="cyan">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white text-2xl font-bold text-slate-900">
                陈
              </div>
              <div className="min-w-0 flex-1">
                <EditableField label="姓名" value="陈晓晨" strong />
                <div className="mt-2 inline-flex rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                  尺寸 100%
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <EditableField label="电话" value="13600009127" />
              <EditableField label="邮箱" value="chen@example.com" />
              <EditableField label="城市" value="上海" />
              <EditableField label="求职状态" value="随时到岗" />
            </div>
            <EditableField label="求职方向" value="产品运营实习生" />
            <EditableArea
              label="自我介绍"
              value="熟悉校园社群运营、活动复盘和基础数据分析，能把用户反馈整理成可执行的改版建议。"
            />
            <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-emerald-200">正在同步到右侧预览</span>
                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-200">
                  已保存
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                对方把「活动复盘」改成带指标的项目亮点，预览中的绿色高亮会显示本次帮改结果。
              </p>
            </div>
          </EditorSection>
        </div>

        <div className="flex items-start justify-center bg-slate-800 p-5">
          <MiniResume>
            <ResumeHeader />
            <MiniSection title="自我介绍" />
            <p className="text-[10px] leading-relaxed text-slate-700">
              熟悉校园社群运营、活动复盘和基础数据分析，能把用户反馈整理成可执行的改版建议。
            </p>
            <MiniSection title="项目经历" />
            <p className="text-[10px] leading-relaxed text-slate-700">
              增长活动配置台 / 产品运营实习生 / 2025.03 - 2025.06
            </p>
            <A4Bullet highlighted>
              搭建增长活动配置台与数据看板，支持 12 场活动复盘，配置耗时下降 35%。
            </A4Bullet>
            <A4Bullet>沉淀活动复盘模板，统一渠道、转化、留存三类指标口径。</A4Bullet>
            <MiniSection title="校园经历" />
            <A4Bullet>负责求职社群内容排期，每周整理岗位信息与面试复盘。</A4Bullet>
          </MiniResume>
        </div>
      </div>
    </div>
  );
}

function CommentModeMockup() {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-slate-950 text-slate-100 shadow-xl shadow-slate-950/10">
      <MockupTopBar mode="批注模式" tone="blue" />
      <div className="grid min-h-[560px] grid-cols-1 md:grid-cols-[0.85fr_1.15fr]">
        <div className="border-b border-white/10 bg-slate-950 p-4 md:border-b-0 md:border-r">
          <div className="mb-4 flex items-center gap-2 text-xs text-slate-400">
            <MessageSquare className="h-3.5 w-3.5" />
            共 2 条批注
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
              2 待处理
            </span>
          </div>
          <div className="space-y-3">
            {COMMENT_ITEMS.map((item) => (
              <div
                key={item.time}
                className="rounded-lg border border-orange-500/50 bg-orange-500/5 p-3"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{item.section}</span>
                  <span>{item.time}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">「{item.quote}」</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">{item.body}</p>
                <p className="mt-2 text-[11px] text-slate-500">— Mia</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800 p-5">
          <MiniResume>
            <ResumeHeader />
            <MiniSection title="项目经历" />
            <p className="text-[10px] leading-relaxed text-slate-700">
              增长活动配置台 / 产品运营实习生 / 2025.03 - 2025.06
            </p>
            <A4Bullet>
              <Mark>负责增长活动配置与数据看板</Mark>，支持运营团队完成活动上线。
            </A4Bullet>
            <A4Bullet>
              设计周报模板并同步数据口径，<Mark>帮助同学完成复盘</Mark>。
            </A4Bullet>
            <MiniSection title="工作经历" />
            <A4Bullet>参与用户访谈 18 场，整理需求标签并推动 3 个低成本改版。</A4Bullet>
          </MiniResume>
        </div>
      </div>
    </div>
  );
}

function MockupTopBar({
  mode,
  tone,
}: {
  mode: string;
  tone: "blue" | "green";
}) {
  const toneClass =
    tone === "blue"
      ? "border-blue-400/40 bg-blue-500/10 text-blue-300"
      : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300";

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-slate-950 px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">产品运营实习生 - 陈晓晨</div>
        <div className="mt-0.5 text-[11px] text-slate-500">共享审阅链接 · 2 人在线</div>
      </div>
      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
        {mode}
      </span>
      <div className="ml-auto hidden items-center gap-2 text-xs text-slate-400 sm:flex">
        <span className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1">
          <Mic className="h-3.5 w-3.5" />
          语音
        </span>
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white">
          M
        </span>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pink-500 text-[10px] text-white">
          C
        </span>
        <span>2 人在线</span>
        <Share2 className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

function EditorSection({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: string;
  accent: "cyan" | "violet";
  children: React.ReactNode;
}) {
  const accentClass =
    accent === "cyan"
      ? "border-cyan-500/70 text-cyan-300"
      : "border-violet-500/70 text-violet-300";

  return (
    <div className={`rounded-lg border ${accentClass} bg-slate-950/35 p-3`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-800 text-current">
          <UserRound className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-slate-100">{title}</span>
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{count}</span>
      </div>
      {children}
    </div>
  );
}

function EditableField({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <label className="block text-[11px] text-slate-400">
      {label}
      <span
        className={`mt-1 block truncate rounded-md border border-white/15 bg-slate-800 px-2.5 py-2 text-slate-100 ${
          strong ? "text-base font-semibold" : "text-xs"
        }`}
      >
        {value}
      </span>
    </label>
  );
}

function EditableArea({ label, value }: { label: string; value: string }) {
  return (
    <label className="mt-2 block text-[11px] text-slate-400">
      {label}
      <span className="mt-1 block min-h-[56px] rounded-md border border-white/15 bg-slate-800 px-2.5 py-2 text-xs leading-relaxed text-slate-100">
        {value}
      </span>
    </label>
  );
}

function MiniResume({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-[470px] max-w-[340px] rounded bg-white p-5 text-slate-900 shadow-lg">
      {children}
    </div>
  );
}

function ResumeHeader() {
  return (
    <div className="border-b border-slate-900 pb-3 text-center">
      <div className="text-lg font-extrabold tracking-wide">陈晓晨</div>
      <div className="mt-1 text-[10px] text-slate-500">
        产品运营实习生 · 上海 · chen@example.com
      </div>
      <div className="mt-2 flex justify-center gap-1 text-[9px] text-slate-400">
        <span className="inline-flex items-center gap-1">
          <Users className="h-2.5 w-2.5" />
          校园社群增长
        </span>
        <span className="inline-flex items-center gap-1">
          <UserRound className="h-2.5 w-2.5" />
          可远程协作
        </span>
      </div>
    </div>
  );
}

function MiniSection({ title }: { title: string }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-1.5 border-b border-slate-200 pb-1 text-[11px] font-extrabold">
      <span className="h-1.5 w-1.5 rounded-[1px] bg-blue-500" />
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
      className={`relative mb-1 pl-2.5 text-[10px] leading-relaxed ${
        highlighted ? "rounded-sm bg-emerald-50 py-1 pr-1 text-slate-800" : "text-slate-700"
      }`}
    >
      <span className="absolute left-0.5 top-[6px] h-[3px] w-[3px] rounded-full bg-slate-500" />
      {children}
    </div>
  );
}

function Mark({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-amber-200/80 px-0.5">
      <Highlighter className="mr-0.5 inline h-3 w-3 text-amber-700" />
      {children}
    </span>
  );
}
