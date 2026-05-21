"use client";
import { useState } from "react";
import Link from "next/link";
import { LogOut, Menu } from "lucide-react";
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
  name: string | null;
  signOutAction: () => Promise<void>;
};

function initial(email: string, name: string | null) {
  if (name) return name.charAt(0).toUpperCase();
  return email.charAt(0).toUpperCase();
}

export function UserMenu({ email, name, signOutAction }: Props) {
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
      <div className="hidden items-center gap-3 md:flex">
        <Link href="/dashboard">
          <Button variant="outline" size="sm">我的简历</Button>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(props) => (
              <button {...props} className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="用户菜单">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initial(email, name)}</AvatarFallback>
                </Avatar>
              </button>
            )}
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
              {name && <span className="text-sm font-medium">{name}</span>}
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { void signOutAction(); }}
              className="cursor-pointer gap-2"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* mobile: sheet */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={(props) => (
              <button {...props} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="打开菜单">
                <Menu className="h-5 w-5" />
              </button>
            )}
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
              <button
                type="button"
                onClick={() => { void signOutAction(); }}
                className="w-full rounded px-2 py-2 text-left hover:bg-accent"
              >
                退出登录
              </button>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
