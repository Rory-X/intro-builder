"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  BookOpen,
  Brain,
  Eye,
  FileText,
  LayoutGrid,
  Link2,
  ArrowRight,
  Upload,
} from "lucide-react";

const FEATURES = [
  {
    id: "editor",
    title: "流畅编辑体验",
    desc: "结构化表单、富文本模块、拖拽排序和自动保存，让内容修改比调格式更顺手。",
    icon: LayoutGrid,
    span: "md:col-span-4",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    id: "preview",
    title: "实时预览与排版",
    desc: "键入即所见，A4 预览、密度调节和模板切换同步更新，导出前不用靠想象。",
    icon: Eye,
    span: "md:col-span-2",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "ai",
    title: "AI 诊断与 Agent 辅助",
    desc: "整份简历诊断、STAR 改写和局部润色都以建议卡呈现，确认后才写回内容。",
    icon: Brain,
    span: "md:col-span-2",
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  {
    id: "docs",
    title: "求职文档建设",
    desc: "文档站沉淀简历、投递、面试与职业规划内容，编辑工具之外也能补齐求职判断。",
    icon: BookOpen,
    span: "md:col-span-4",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "import",
    title: "智能解析导入",
    desc: "PDF / Word 简历导入后解析为结构化字段，旧简历可以直接进入编辑与优化流程。",
    icon: Upload,
    span: "md:col-span-3",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    id: "delivery",
    title: "模板、PDF 与分享",
    desc: "模板库、像素级 PDF 和公开只读链接一起覆盖投递交付，随时更新、随时关闭。",
    icon: FileText,
    span: "md:col-span-3",
    color: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
];

export function BentoFeatures() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 md:py-28">
      <ScrollReveal className="text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
          <span className="h-px w-6 bg-primary" />
          核心能力
        </div>
        <h2 className="text-3xl font-extrabold leading-[1.2] tracking-tight md:text-5xl">
          不只是简历模板
          <br />
          <span className="font-[var(--font-serif-display)] italic text-foreground/80">
            是从编辑到投递的工作台
          </span>
        </h2>
      </ScrollReveal>

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
        {FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <ScrollReveal
              key={feature.id}
              delay={i * 0.08}
              className={`${feature.span} col-span-1`}
            >
              <div className="group relative flex h-full min-h-[220px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/5">
                <div
                  className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg ${feature.color}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-bold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {feature.desc}
                </p>
                {/* Hover reveal arrow */}
                <div className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  了解更多
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
                {feature.id === "delivery" ? (
                  <Link2 className="pointer-events-none absolute bottom-5 right-5 h-12 w-12 text-muted-foreground/10" />
                ) : null}
              </div>
            </ScrollReveal>
          );
        })}
      </div>
    </section>
  );
}
