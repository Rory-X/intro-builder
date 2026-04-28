export default function VerifyRequestPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">请检查邮箱</h1>
      <p className="text-sm text-muted-foreground">
        我们发了一封登录邮件过去，点里面的链接即可登录。如果几分钟没收到，请检查垃圾箱。
      </p>
    </main>
  );
}
