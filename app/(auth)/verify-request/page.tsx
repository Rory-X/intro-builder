import { Card, CardContent } from "@/components/ui/card";
import { Mail } from "lucide-react";

export default function VerifyRequestPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm text-center">
        <Card className="shadow-lg shadow-black/5">
          <CardContent className="flex flex-col items-center gap-4 pt-8 pb-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold">请检查邮箱</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              我们发了一封登录邮件过去，点里面的链接即可登录。
              <br />
              如果几分钟没收到，请检查垃圾箱。
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
