import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { requireUserId } from "@/lib/auth-helpers";
import { db } from "@/db";
import { resumes } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createResume, deleteResume } from "./actions";

export default async function DashboardPage() {
  const userId = await requireUserId();
  const list = await db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(desc(resumes.updatedAt));

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的简历</h1>
        <form action={createResume}><Button type="submit">新建简历</Button></form>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {list.map((r) => (
          <Card key={r.id}>
            <CardHeader><CardTitle className="truncate">{r.title}</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-between">
              <Link className="text-sm underline" href={`/resume/${r.id}/edit`}>编辑</Link>
              <form action={async () => { "use server"; await deleteResume(r.id); }}>
                <Button type="submit" variant="ghost" size="sm">删除</Button>
              </form>
            </CardContent>
          </Card>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">还没有简历，点右上角新建一份。</p>}
      </div>
    </main>
  );
}
