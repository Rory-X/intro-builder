import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">intro-builder</h1>
      <p className="text-lg text-muted-foreground">
        面向互联网求职者的在线简历排版工具。登录即开始，自动保存，一键导出 PDF。
      </p>
      <Link href="/login">
        <Button size="lg">免费开始</Button>
      </Link>
    </main>
  );
}
