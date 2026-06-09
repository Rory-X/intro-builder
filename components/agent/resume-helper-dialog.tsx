"use client";

import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ResumeHelperCard, type ResumeHelperSuggestionView } from "@/components/agent/resume-helper-card";

type HelperState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: { summary: string; suggestions: ResumeHelperSuggestionView[] } }
  | { status: "error"; message: string };

type ResumeHelperDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  state: HelperState;
  maxWidth?: "xl" | "2xl";
};

export function ResumeHelperDialog({
  open,
  onOpenChange,
  title,
  state,
  maxWidth = "2xl",
}: ResumeHelperDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={maxWidth === "xl" ? "sm:max-w-xl" : "sm:max-w-2xl"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {state.status === "ready" && state.result.summary && (
            <DialogDescription>{state.result.summary}</DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {state.status === "loading" && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">正在分析…</span>
            </div>
          )}

          {state.status === "error" && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {state.message}
            </div>
          )}

          {state.status === "ready" && (
            <div className="space-y-3">
              {state.result.suggestions.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  暂无建议
                </p>
              ) : (
                state.result.suggestions.map((suggestion) => (
                  <ResumeHelperCard key={suggestion.id} suggestion={suggestion} />
                ))
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { HelperState };
