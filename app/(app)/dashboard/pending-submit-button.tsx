"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  idleIcon: React.ReactNode;
  idleLabel: string;
  pendingLabel: string;
  /** Use `inline` when the button sits inside a dropdown menu item (no full Button styling). */
  variant?: "primary" | "lg-primary" | "inline" | "inline-destructive";
  className?: string;
};

/**
 * Submit button that listens to its enclosing `<form action={serverAction}>`
 * status via `useFormStatus`. We need this so dashboard actions (create /
 * duplicate / delete) show a spinner the instant the user clicks, rather
 * than appearing to hang while the server action round-trips.
 */
export function PendingSubmitButton({
  idleIcon,
  idleLabel,
  pendingLabel,
  variant = "primary",
  className,
}: Props) {
  const { pending } = useFormStatus();
  const icon = pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : idleIcon;
  const label = pending ? pendingLabel : idleLabel;

  if (variant === "primary" || variant === "lg-primary") {
    return (
      <Button
        type="submit"
        size={variant === "lg-primary" ? "lg" : "default"}
        disabled={pending}
        aria-busy={pending}
        className={cn(
          "gap-1.5 shadow-sm shadow-primary/20 disabled:cursor-wait disabled:opacity-80",
          variant === "lg-primary" && "gap-2",
          className,
        )}
      >
        {icon}
        {label}
      </Button>
    );
  }

  // Plain submit button (used inside dropdown menu items).
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "flex w-full items-center gap-2 disabled:cursor-wait disabled:opacity-70",
        variant === "inline-destructive" && "text-destructive",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
