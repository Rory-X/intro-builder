"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import {
  LayoutGrid,
  Eye,
  Upload,
  FileText,
  Users,
  Link2,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    id: "structured",
    title: "结构化编辑",
    desc: "用模块思维写简历，告别格式焦虑。分区编辑、拖拽排序，内容与样式完全解耦。",
    icon: LayoutGrid,
    span: "md:col-span-4",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  {
    id: "preview",
    title: "实时 A4 预览",
    desc: "键入即所见，按 A4 真实尺寸排版。所有改动同步反映在预览区。",
    icon: Eye,
    span: "md:col-span-2",
    color: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "import",
    title: "智能解析导入",
    desc: "支持 PDF / Word / 图片导入，OCR + AI 自动解析为结构化字段，5 秒完成迁移。",
    icon: Upload,
    span: "md:col-span-2",
    color: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  },
  {
    id: "pdf",
    title: "像素级 PDF 导出",
    desc: "内置思源黑体，告别字体丢失与格式错乱。A4 规范 PDF 一键下载，导出与预览完全一致。",
    icon: FileText,
    span: "md:col-span-4",
    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "collab",
    title: "多人协同批注",
    desc: "链接邀请导师或同伴，高亮批注、实时沟通，简历越改越好。",
    icon: Users,
    span: "md:col-span-3",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    id: "share",
    title: "一键公开分享",
    desc: "生成只读链接，投递时直接发 HR，随时可关闭。",
    icon: Link2,
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
        <h2 className="text-3xl font-extrabold tracking-tight md:text-5xl">
          不只是简历模板，
          <br />
          <span className="font-[var(--font-serif-display)] italic text-foreground/80">
            是一个完整的工作台。
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
              <div className="group relative flex h-full min-h-[220px] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5">
                <div
                  className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${feature.color}`}
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
              </div>
            </ScrollReveal>
          );
        })}
      </div>
    </section>
  );
}
