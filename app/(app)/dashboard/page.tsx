import { eq, desc } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Edit, Copy, Trash2, FileText } from "lucide-react";
import { createResume, deleteResume, duplicateResume } from "./actions";
import { migrateContent } from "@/lib/migrate-content";
import { getTemplateMeta } from "@/lib/templates/registry";
import { TemplateRenderer } from "@/components/preview/template-renderer";
import { computeCompletenessScore } from "@/hooks/use-completeness-score";
import { ImportResumeButton } from "@/components/editor/import-resume-button";
import type { Metadata } from "next";
import { ResumeCardLink } from "./resume-card-link";
import { PendingSubmitButton } from "./pending-submit-button";

export const metadata: Metadata = { title: "我的简历" };

export default async function DashboardPage() {
  const userId = await requireUserId();
  const list = await db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:py-12">
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">
            我的简历
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {list.length > 0 ? `共 ${list.length} 份简历` : "开始创建你的第一份专业简历"}
          </p>
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
          {list.map((r) => {
            const content = migrateContent(r.content);
            const templateName = getTemplateMeta(r.templateId).name;
            const score = computeCompletenessScore(content).overall;
            return (
              <div key={r.id} className="group relative">
                {/* Preview card */}
                <ResumeCardLink href={`/resume/${r.id}/edit`}>
                  <div className="overflow-hidden rounded-xl border shadow-sm transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 [container-type:inline-size]"
                       style={{ aspectRatio: "210/297", backgroundColor: "#ffffff" }}>
                    <div className="pointer-events-none origin-top-left [transform:scale(calc(100cqw/820px))]" style={{ width: "820px" }}>
                      <TemplateRenderer
                        templateId={r.templateId}
                        content={content}
                        sectionOrder={content.sectionOrder}
                      />
                    </div>
                  </div>
                </ResumeCardLink>
                {/* Card footer */}
                <div className="mt-3 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.updatedAt.toLocaleDateString("zh-CN")}
                      <span className="mx-1 text-border">&middot;</span>
                      <span>{templateName}</span>
                      <span className="mx-1 text-border">&middot;</span>
                      <span className={score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-destructive"}>{score}%</span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all duration-200 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"><MoreVertical className="h-4 w-4" /></button>}
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
                        <form action={async () => { "use server"; await deleteResume(r.id); }} className="w-full">
                          <PendingSubmitButton
                            variant="inline-destructive"
                            idleIcon={<Trash2 className="h-3.5 w-3.5" />}
                            idleLabel="删除"
                            pendingLabel="删除中…"
                          />
                        </form>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
