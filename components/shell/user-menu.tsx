"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

type Props = {
  email: string | null;
  signOutAction: () => Promise<void>;
};

function initial(email: string) {
  return email.charAt(0).toUpperCase();
}

export function UserMenu({ email, signOutAction }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!email) {
    return (
      <>
        <Link href="/login" className="hidden md:inline">
          <Button variant="default" size="sm">登录</Button>
        </Link>
        <div className="md:hidden">
          <Link href="/login">
            <Button variant="default" size="sm">登录</Button>
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {/* desktop: dropdown */}
      <div className="hidden items-center gap-4 md:flex">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          我的简历
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex items-center" aria-label="用户菜单">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initial(email)}</AvatarFallback>
                </Avatar>
              </button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/dashboard">我的简历</Link>} />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              render={
                <form action={signOutAction} className="w-full">
                  <button type="submit" className="w-full text-left">退出登录</button>
                </form>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* mobile: sheet */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="打开菜单">
                <Menu className="h-5 w-5" />
              </Button>
            }
          />
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle className="truncate text-base">{email}</SheetTitle>
            </SheetHeader>
            <nav className="mt-4 flex flex-col gap-2 text-sm">
              <Link
                href="/dashboard"
                onClick={() => setSheetOpen(false)}
                className="rounded px-2 py-2 hover:bg-accent"
              >
                我的简历
              </Link>
              <form action={signOutAction}>
                <button type="submit" className="w-full rounded px-2 py-2 text-left hover:bg-accent">
                  退出登录
                </button>
              </form>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
