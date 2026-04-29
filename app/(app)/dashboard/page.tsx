import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreVertical, Edit, Copy, Trash2 } from "lucide-react";
import { createResume, deleteResume, duplicateResume } from "./actions";
import { migrateContent } from "@/lib/migrate-content";
import { ClassicLayout } from "@/lib/templates/classic/Layout";
import { ModernLayout } from "@/lib/templates/modern/Layout";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "我的简历" };

export default async function DashboardPage() {
  const userId = await requireUserId();
  const list = await db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold md:text-2xl">
          我的简历 <span className="text-muted-foreground">({list.length})</span>
        </h1>
        <form action={createResume}>
          <Button type="submit">
            <Plus className="mr-1 h-4 w-4" />新建简历
          </Button>
        </form>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-16 text-center">
          <p className="mb-4 text-muted-foreground">你还没有简历</p>
          <form action={createResume}>
            <Button type="submit" size="lg">
              <Plus className="mr-1 h-4 w-4" />创建第一份简历
            </Button>
          </form>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((r) => {
            const content = migrateContent(r.content);
            const Layout = r.templateId === "modern" ? ModernLayout : ClassicLayout;
            return (
              <div key={r.id} className="group relative">
                {/* Preview card */}
                <Link href={`/resume/${r.id}/edit`} className="block">
                  <div className="overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md dark:border-neutral-700"
                       style={{ aspectRatio: "210/297" }}>
                    <div className="pointer-events-none origin-top-left scale-[0.25]" style={{ width: "820px" }}>
                      <Layout content={content} sectionOrder={content.sectionOrder} />
                    </div>
                  </div>
                </Link>
                {/* Card footer */}
                <div className="mt-2 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.updatedAt.toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"><MoreVertical className="h-4 w-4" /></button>}
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Link href={`/resume/${r.id}/edit`} className="flex w-full items-center gap-2">
                          <Edit className="h-3.5 w-3.5" />编辑
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <form action={async () => { "use server"; await duplicateResume(r.id); }} className="w-full">
                          <button type="submit" className="flex w-full items-center gap-2">
                            <Copy className="h-3.5 w-3.5" />复制
                          </button>
                        </form>
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <form action={async () => { "use server"; await deleteResume(r.id); }} className="w-full">
                          <button type="submit" className="flex w-full items-center gap-2 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />删除
                          </button>
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
