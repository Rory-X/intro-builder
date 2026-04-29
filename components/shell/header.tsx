import Link from "next/link";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/(app)/actions/logout";
import { Brand } from "./brand";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export async function Header() {
  const session = await auth();
  const email = session?.user?.email ?? null;
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
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu email={email} signOutAction={signOutAction} />
        </div>
      </div>
    </header>
  );
}
