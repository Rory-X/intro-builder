import { eq, desc } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Edit, Copy, FolderOpen, Share2, Clock, FileText, Layers, BookOpen, CircleHelp } from "lucide-react";
import { createResume, deleteResume, duplicateResume } from "./actions";
import { migrateContent } from "@/lib/migrate-content";
import { getTemplateMeta } from "@/lib/templates/registry";
import { TemplateRenderer } from "@/components/preview/template-renderer";
import { computeCompletenessScore } from "@/lib/completeness-score";
import { ImportResumeButton } from "@/components/editor/import-resume-button";
import { DeleteResumeButton } from "@/components/editor/delete-resume-button";
import type { Metadata } from "next";
import { ResumeCardLink } from "./resume-card-link";
import { PendingSubmitButton } from "./pending-submit-button";

export const metadata: Metadata = { title: "工作台" };

export default async function DashboardPage() {
  const userId = await requireUserId();
  const session = await auth();
  const userName = session?.user?.name ?? session?.user?.email?.split("@")[0] ?? "你";

  const list = await db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));

  const sharedCount = list.filter((r) => r.isPublic && r.slug).length;
  const scores = list.map((r) => computeCompletenessScore(migrateContent(r.content)).overall);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const lowScoreCount = scores.filter((s) => s < 70).length;

  // Greeting based on time of day
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border/60 bg-card p-4 lg:block sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
        {/* Workspace nav */}
        <div className="mb-6">
          <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            工作台
          </div>
          <nav className="flex flex-col gap-0.5">
            <SideItem icon={<FolderOpen className="h-4 w-4" />} label="我的简历" count={list.length} active />
            <SideItem icon={<Share2 className="h-4 w-4" />} label="已分享" count={sharedCount} />
            <SideItem icon={<Clock className="h-4 w-4" />} label="最近导出" />
          </nav>
        </div>

        {/* Resources nav */}
        <div className="mb-6">
          <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            资源
          </div>
          <nav className="flex flex-col gap-0.5">
            <SideItem icon={<Layers className="h-4 w-4" />} label="模板库" />
            <SideItem icon={<BookOpen className="h-4 w-4" />} label="简历指南" />
            <SideItem icon={<CircleHelp className="h-4 w-4" />} label="帮助中心" />
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10">
        {/* Page header */}
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
            所有数据已自动同步
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            {greeting}，{userName} —
            <br />
            <span className="font-[var(--font-serif-display)] italic text-muted-foreground">
              让我们继续打磨你的简历。
            </span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {list.length > 0
              ? `最近一次编辑于 ${formatRelativeTime(list[0].updatedAt)} · 你已创建 ${list.length} 份简历`
              : "开始创建你的第一份专业简历"}
          </p>
        </div>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="简历总数" value={String(list.length)} icon={<FolderOpen className="h-4 w-4" />} />
          <StatCard label="公开链接" value={String(sharedCount)} icon={<Share2 className="h-4 w-4 text-pink-500" />} />
          <StatCard label="已导出 PDF" value="—" icon={<FileText className="h-4 w-4 text-emerald-500" />} />
          <StatCard
            label="平均完成度"
            value={`${avgScore}%`}
            icon={<span className="text-amber-500">●</span>}
            delta={lowScoreCount > 0 ? `${lowScoreCount} 份待完善` : undefined}
          />
        </div>

        {/* Action bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <span className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background">
              全部 · {list.length}
            </span>
            <span className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer">
              已分享
            </span>
            <span className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer">
              草稿
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ImportResumeButton />
            <form action={createResume}>
              <PendingSubmitButton
                idleIcon={<Plus className="h-4 w-4" />}
                idleLabel="新建简历"
                pendingLabel="创建中…"
              />
            </form>
          </div>
        </div>

        {/* Resume grid */}
        {list.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-primary/20 bg-primary/[0.02] p-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <FileText className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">还没有简历</h2>
            <p className="mb-6 mt-1 max-w-xs text-sm text-muted-foreground">
              创建你的第一份简历，结构化编辑、实时预览、一键导出 PDF
            </p>
            <form action={createResume}>
              <PendingSubmitButton
                variant="lg-primary"
                idleIcon={<Plus className="h-4 w-4" />}
                idleLabel="创建第一份简历"
                pendingLabel="创建中…"
              />
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* Existing resume cards */}
            {list.map((r) => {
              const content = migrateContent(r.content);
              const templateName = getTemplateMeta(r.templateId).name;
              const score = computeCompletenessScore(content).overall;
              const isShared = !!(r.isPublic && r.slug);
              return (
                <div key={r.id} className="group relative">
                  <div className="overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5">
                    {/* Preview thumbnail */}
                    <ResumeCardLink href={`/resume/${r.id}/edit`}>
                      <div className="relative m-3 mb-0 overflow-hidden rounded-xl border border-border/60 [container-type:inline-size]"
                           style={{ aspectRatio: "210/297", backgroundColor: "#ffffff" }}>
                        <div className="pointer-events-none origin-top-left [transform:scale(calc(100cqw/820px))]" style={{ width: "820px" }}>
                          <TemplateRenderer
                            templateId={r.templateId}
                            content={content}
                            sectionOrder={content.sectionOrder}
                          />
                        </div>
                        {/* Status badge */}
                        {isShared && (
                          <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-sm">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            已分享
                          </span>
                        )}
                      </div>
                    </ResumeCardLink>

                    {/* Card footer */}
                    <div className="p-4">
                      <div className="flex items-center justify-between">
                        <p className="truncate text-sm font-semibold">{r.title}</p>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all hover:bg-accent group-hover:opacity-100"><MoreVertical className="h-4 w-4" /></button>}
                          />
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem>
                              <ResumeCardLink href={`/resume/${r.id}/edit`} className="flex w-full items-center gap-2">
                                <Edit className="h-3.5 w-3.5" />编辑
                              </ResumeCardLink>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <form action={async () => { "use server"; await duplicateResume(r.id); }} className="w-full">
                                <PendingSubmitButton
                                  variant="inline"
                                  idleIcon={<Copy className="h-3.5 w-3.5" />}
                                  idleLabel="复制"
                                  pendingLabel="复制中…"
                                />
                              </form>
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <DeleteResumeButton
                                resumeTitle={r.title}
                                deleteAction={async () => { "use server"; await deleteResume(r.id); }}
                              />
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          {templateName}
                        </span>
                        <span>{r.updatedAt.toLocaleDateString("zh-CN")}</span>
                        <span className={`ml-auto font-bold ${score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-destructive"}`}>
                          {score}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/* ─── Helper Components ─── */

function SideItem({
  icon,
  label,
  count,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium cursor-pointer transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      {icon}
      {label}
      {count != null && (
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
          active ? "bg-background/15 text-background/80" : "bg-muted text-muted-foreground"
        }`}>
          {count}
        </span>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  delta,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  delta?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-extrabold tracking-tight">{value}</div>
      {delta && (
        <div className="mt-1 text-xs font-medium text-amber-500">{delta}</div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}
