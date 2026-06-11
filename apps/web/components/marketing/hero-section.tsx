"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileUp, LayoutGrid, Eye, Share2 } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
};

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pb-20 pt-32 md:pb-24 md:pt-40">
      {/* Background gradient mesh */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute -left-1/4 -top-1/4 h-[600px] w-[600px] rounded-full bg-gradient-to-br from-primary/25 to-violet-500/15 blur-[80px] animate-mesh-breathe" />
        <div className="absolute -bottom-1/4 -right-1/4 h-[500px] w-[500px] rounded-full bg-gradient-to-tl from-pink-500/15 to-primary/10 blur-[80px] animate-mesh-breathe [animation-delay:3s]" />
        <div className="absolute left-1/2 top-1/3 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-gradient-to-b from-emerald-500/8 to-transparent blur-[60px] animate-mesh-breathe [animation-delay:1.5s]" />
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
          style={{
            backgroundImage: `url('/grid.svg')`,
            backgroundSize: "60px 60px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 80%)",
          }}
        />
      </div>

      <div className="mx-auto max-w-5xl px-4 text-center">
        {/* Pill badge */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0 }}
          className="mb-8 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2 py-1 pl-4 text-sm backdrop-blur-sm"
        >
          <span className="text-muted-foreground">AI 智能解析 · 一键导入旧简历</span>
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-primary-foreground">
            NEW
          </span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          {...fadeUp}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="text-4xl font-extrabold leading-[1.15] tracking-tight md:text-6xl lg:text-7xl"
        >
          <span className="text-foreground">把简历</span><span className="font-[var(--font-display-cn)] bg-gradient-to-r from-primary via-violet-500 to-primary bg-clip-text text-transparent animate-gradient-shift">写得</span>
          <br />
          <span className="text-foreground">像</span><span className="relative inline-block text-foreground">一份产品<span className="absolute -bottom-1 left-0 right-0 h-3 -rotate-1 rounded bg-primary/15 -z-10" /></span><span className="text-foreground">一样精致</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg"
        >
          面向中文互联网求职者的在线简历工作台。结构化编辑、实时 A4 预览、一键导出像素级 PDF — 一站搞定从撰写到投递。
        </motion.p>

        {/* Core feature chips */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-2.5"
        >
          <FeatureChip icon={<LayoutGrid className="h-3.5 w-3.5" />} label="结构化编辑" />
          <FeatureChip icon={<Eye className="h-3.5 w-3.5" />} label="实时预览" />
          <FeatureChip icon={<Share2 className="h-3.5 w-3.5" />} label="PDF / 分享" />
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.6, delay: 0.55 }}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Link href="/login">
            <Button
              size="lg"
              className="group gap-2 rounded-full px-7 text-base font-semibold shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30"
            >
              免费创建简历
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <Link href="#features">
            <Button
              size="lg"
              variant="outline"
              className="gap-2 rounded-full px-7 text-base font-medium"
            >
              <FileUp className="h-4 w-4" />
              导入已有简历
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

function FeatureChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3.5 py-1.5 text-sm font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground">
      <span className="text-primary">{icon}</span>
      {label}
    </span>
  );
}
