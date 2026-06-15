"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BookOpen,
  Brain,
  FileText,
  LayoutGrid,
  Sparkles,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

export function HeroSection() {
  return (
    <section className="relative overflow-hidden border-b border-border/40 pb-16 pt-28 md:pb-20 md:pt-36">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--muted)/0.38)_58%,hsl(var(--background))_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.045] dark:opacity-[0.08]"
          style={{
            backgroundImage: `url('/grid.svg')`,
            backgroundSize: "60px 60px",
            maskImage:
              "linear-gradient(180deg, transparent 0%, black 18%, black 72%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(180deg, transparent 0%, black 18%, black 72%, transparent 100%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-5xl px-4 text-center">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0 }}
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-background/80 px-3.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm"
        >
          <Sparkles className="h-3.5 w-3.5 text-cyan-500" />
          AI 诊断 · Agent 模式 · 求职文档站
        </motion.div>

        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-4xl font-extrabold leading-[1.14] tracking-tight md:text-6xl lg:text-7xl"
        >
          <span className="text-foreground">把简历</span>
          <span className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-500 bg-clip-text font-[var(--font-display-cn)] text-transparent">
            写得
          </span>
          <br />
          <span className="text-foreground">像</span>
          <span className="relative inline-block text-foreground">
            一份产品
            <span className="absolute -bottom-1 left-0 right-0 -z-10 h-3 -rotate-1 rounded bg-cyan-500/15" />
          </span>
          <span className="text-foreground">一样精致</span>
        </motion.h1>

        <motion.p
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg"
        >
          面向中文互联网求职者的在线简历工作台。结构化编辑、实时 A4 预览、求职文档建设与 AI 辅助优化，一站完成从撰写到投递。
        </motion.p>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
        >
          <FeatureChip icon={<LayoutGrid className="h-3.5 w-3.5" />} label="流畅编辑" />
          <FeatureChip icon={<Brain className="h-3.5 w-3.5" />} label="AI 诊断" />
          <FeatureChip icon={<BookOpen className="h-3.5 w-3.5" />} label="求职文档" />
          <FeatureChip icon={<FileText className="h-3.5 w-3.5" />} label="PDF / 分享" />
        </motion.div>

        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.55 }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link href="/login">
            <Button
              size="lg"
              className="group gap-2 rounded-full px-7 text-base font-semibold shadow-lg shadow-cyan-500/20 transition-all hover:shadow-xl hover:shadow-cyan-500/25"
            >
              免费创建简历
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <Link href="/docs">
            <Button
              size="lg"
              variant="outline"
              className="gap-2 rounded-full px-7 text-base font-medium"
            >
              <BookOpen className="h-4 w-4" />
              查看求职文档
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

function FeatureChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground">
      <span className="text-cyan-500">{icon}</span>
      {label}
    </span>
  );
}
