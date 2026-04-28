import { sendLoginLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">登录 intro-builder</h1>
      <p className="text-sm text-muted-foreground">我们会给你的邮箱发送一个一次性登录链接。</p>
      <form action={sendLoginLink} className="flex flex-col gap-3">
        <Label htmlFor="email">邮箱</Label>
        <Input id="email" name="email" type="email" required placeholder="you@example.com" />
        <Button type="submit">发送登录链接</Button>
      </form>
    </main>
  );
}
