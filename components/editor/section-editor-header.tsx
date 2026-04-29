"use client";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SECTION_META } from "@/lib/section-meta";

type Props = {
  sectionKey: string;
  itemCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel?: string;
};

export function SectionEditorHeader({ sectionKey, itemCount, isOpen, onToggle, onAdd, addLabel = "+ 新增" }: Props) {
  const meta = SECTION_META[sectionKey];
  if (!meta) return null;
  const Icon = meta.icon;

  return (
    <div className="flex items-center justify-between py-3">
      <button
        type="button"
        className="flex items-center gap-2.5 text-lg font-semibold transition-colors duration-200 hover:text-foreground"
        onClick={onToggle}
      >
        {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${meta.color.replace('text-', 'bg-').replace('-500', '-500/10')}`}>
          <Icon className={`h-4 w-4 ${meta.color}`} />
        </div>
        <span>{meta.label}</span>
        {itemCount > 0 && (
          <span className="ml-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {itemCount}
          </span>
        )}
      </button>
      <Button type="button" size="sm" variant="outline" onClick={onAdd} className="gap-1 text-xs">
        <Plus className="h-3 w-3" />
        {addLabel}
      </Button>
    </div>
  );
}
