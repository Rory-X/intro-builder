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
    <div className="flex items-center justify-between py-2">
      <button
        type="button"
        className="flex items-center gap-2 text-lg font-semibold"
        onClick={onToggle}
      >
        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Icon className={`h-5 w-5 ${meta.color}`} />
        <span>{meta.label}</span>
        {itemCount > 0 && (
          <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {itemCount}
          </span>
        )}
      </button>
      <Button type="button" size="sm" variant="outline" onClick={onAdd}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );
}
