import Link from "next/link";
import { currentUser } from "@/lib/auth-helpers";
import { signOutAction } from "@/app/(app)/actions/logout";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export async function Header() {
  // currentUser 比 auth() 多一步 dev bypass DB 回退，让本地登录后的 chrome
  // （模板库 link、UserMenu 头像）真的显示登录态，否则会出现"页面已登录但
  // header 仍显示登录按钮"的撕裂体验。生产环境 currentUser 与 auth() 行为
  // 完全一致（dev bypass 在 NODE_ENV!==development 短路返回 null）。
  const user = await currentUser();
  const email = user?.email ?? null;
  const name = user?.name ?? null;
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Brand />
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link href="/#features" className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground">
              特性
            </Link>
            <Link href="/#templates" className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground">
              模板
            </Link>
            {user && (
              <Link href="/templates" className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground">
                模板库
              </Link>
            )}
            <Link href="/docs" className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground">
              求职指南
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu email={email} name={name} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}
