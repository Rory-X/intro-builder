"use client";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTION_META } from "@/lib/section-meta";
import { cn } from "@/lib/utils";
import { useSectionDragHandle } from "./section-wrapper";

type Props = {
  sectionKey: string;
  itemCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel?: string;
};

// 字面 class 映射(Tailwind 不能识别动态拼接的类名,必须写全)
const SECTION_COLOR: Record<string, { accent: string; iconBg: string; icon: string }> = {
  experience: { accent: "bg-blue-500", iconBg: "bg-blue-500/10", icon: "text-blue-500" },
  education: { accent: "bg-green-500", iconBg: "bg-green-500/10", icon: "text-green-500" },
  projects: { accent: "bg-purple-500", iconBg: "bg-purple-500/10", icon: "text-purple-500" },
  skills: { accent: "bg-orange-500", iconBg: "bg-orange-500/10", icon: "text-orange-500" },
  summary: { accent: "bg-cyan-500", iconBg: "bg-cyan-500/10", icon: "text-cyan-500" },
  awards: { accent: "bg-yellow-500", iconBg: "bg-yellow-500/10", icon: "text-yellow-500" },
  research: { accent: "bg-teal-500", iconBg: "bg-teal-500/10", icon: "text-teal-500" },
  portfolio: { accent: "bg-pink-500", iconBg: "bg-pink-500/10", icon: "text-pink-500" },
  custom: { accent: "bg-gray-500", iconBg: "bg-gray-500/10", icon: "text-gray-500" },
};

export function SectionEditorHeader({ sectionKey, itemCount, isOpen, onToggle, onAdd, addLabel = "新增" }: Props) {
  const meta = SECTION_META[sectionKey];
  const handleRef = useSectionDragHandle();
  if (!meta) return null;
  const Icon = meta.icon;
  const c = SECTION_COLOR[sectionKey] ?? SECTION_COLOR.custom;

  return (
    <div
      ref={handleRef ?? undefined}
      onClick={onToggle}
      className="flex cursor-grab select-none items-center gap-2.5 px-3.5 py-3 transition-colors hover:bg-muted/40 active:cursor-grabbing"
    >
      <span className={cn("h-5 w-[3px] shrink-0 rounded-full", c.accent)} />
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", c.iconBg)}>
        <Icon className={cn("h-4 w-4", c.icon)} />
      </span>
      <span className="text-[14.5px] font-semibold text-foreground">{meta.label}</span>
      {itemCount > 0 && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{itemCount}</span>
      )}
      <span className="ml-auto flex items-center gap-0.5">
        {addLabel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </Button>
        )}
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", !isOpen && "-rotate-90")} />
      </span>
    </div>
  );
}
