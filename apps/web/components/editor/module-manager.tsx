"use client";
import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { AnimatePresence, Reorder } from "motion/react";
import { GripVertical, Trash2, Plus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { getSectionMeta } from "@/lib/section-meta";
import { MODULE_PRESETS, BUILTIN_SECTION_KEYS } from "@intro-builder/shared/schemas";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { emptyDoc } from "@intro-builder/shared/types";
import { cn } from "@/lib/utils";

type Props = {
  sectionOrder: string[];
  onOrderChange: (next: string[]) => void;
};

function DraggableModuleItem({
  sectionKey,
  label,
  icon: Icon,
  iconColor,
  onRemove,
  onDragEndCommit,
}: {
  sectionKey: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  onRemove: () => void;
  onDragEndCommit: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <Reorder.Item
      value={sectionKey}
      onDragStart={() => setDragging(true)}
      style={{
        boxShadow: dragging ? "0 4px 12px rgba(0,0,0,0.12)" : "none",
        scale: dragging ? 1.02 : 1,
        position: "relative",
        zIndex: dragging ? 50 : "auto",
      }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      onDragEnd={() => {
        setDragging(false);
        onDragEndCommit();
      }}
      className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 cursor-grab active:cursor-grabbing"
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      <Icon className={`h-4 w-4 shrink-0 ${iconColor}`} />
      <span className="flex-1 truncate text-sm">{label}</span>
      <button
        type="button"
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
        onClick={onRemove}
        title="删除"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </Reorder.Item>
  );
}

export function ModuleManager({ sectionOrder, onOrderChange }: Props) {
  const { getValues, setValue } = useFormContext<ResumeContent>();
  const [open, setOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  const managedSections = sectionOrder.filter((k) => k !== "basics");
  const managedSectionsKey = managedSections.join("|");
  const [draftManagedSections, setDraftManagedSections] = useState({
    key: managedSectionsKey,
    value: managedSections,
  });
  const visibleManagedSections =
    draftManagedSections.key === managedSectionsKey
      ? draftManagedSections.value
      : managedSections;
  const draftManagedSectionsRef = useRef(managedSections);

  const availablePresets = MODULE_PRESETS.filter(
    (p) => !sectionOrder.includes(p.id)
  );

  function handleReorder(newManaged: string[]) {
    draftManagedSectionsRef.current = newManaged;
    setDraftManagedSections({ key: managedSectionsKey, value: newManaged });
  }

  function commitReorder() {
    const next = draftManagedSectionsRef.current;
    if (next.join("|") === managedSections.join("|")) return;
    onOrderChange(["basics", ...next]);
  }

  function removeSection(key: string) {
    const newOrder = sectionOrder.filter((k) => k !== key);
    onOrderChange(newOrder);

    if (!BUILTIN_SECTION_KEYS.has(key)) {
      const custom = getValues("custom") ?? [];
      setValue(
        "custom",
        custom.filter((c) => c.id !== key),
        { shouldDirty: true }
      );
    }
  }

  function addSection(presetId: string) {
    const newOrder = [...sectionOrder, presetId];
    onOrderChange(newOrder);

    if (!BUILTIN_SECTION_KEYS.has(presetId)) {
      const preset = MODULE_PRESETS.find((p) => p.id === presetId);
      const custom = getValues("custom") ?? [];
      custom.push({
        id: presetId,
        title: preset?.label ?? presetId,
        content: emptyDoc(),
      });
      setValue("custom", custom, { shouldDirty: true });
    }
  }

  function addCustomSection() {
    const title = customTitle.trim();
    if (!title) return;
    const id = `custom_${Date.now()}`;
    const newOrder = [...sectionOrder, id];
    onOrderChange(newOrder);

    const custom = getValues("custom") ?? [];
    custom.push({ id, title, content: emptyDoc() });
    setValue("custom", custom, { shouldDirty: true });

    setCustomTitle("");
    setShowCustomInput(false);
  }

  function getSectionLabel(key: string): string {
    const custom = getValues("custom") ?? [];
    const cs = custom.find((c) => c.id === key);
    if (cs) return cs.title || key;
    const preset = MODULE_PRESETS.find((p) => p.id === key);
    if (preset) return preset.label;
    return getSectionMeta(key).label;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "gap-1.5",
              open && "bg-primary/5 font-semibold text-primary hover:bg-primary/10 hover:text-primary aria-expanded:!bg-primary/5 aria-expanded:!text-primary dark:bg-primary/15 dark:hover:bg-primary/20 dark:aria-expanded:!bg-primary/15",
            )}
          />
        }
      >
        <Layers className="h-3.5 w-3.5" />
        模块管理
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" side="bottom" sideOffset={8}>
        <div className="max-h-[70vh] overflow-y-auto">
          {/* Existing modules */}
          <div className="border-b p-3">
            <h3 className="mb-2 text-sm font-semibold">已有模块</h3>
            <Reorder.Group
              axis="y"
              values={visibleManagedSections}
              onReorder={handleReorder}
              className="space-y-1"
            >
              <AnimatePresence>
                {visibleManagedSections.map((key) => {
                  const meta = getSectionMeta(key);
                  return (
                    <DraggableModuleItem
                      key={key}
                      sectionKey={key}
                      label={getSectionLabel(key)}
                      icon={meta.icon}
                      iconColor={meta.color}
                      onRemove={() => removeSection(key)}
                      onDragEndCommit={commitReorder}
                    />
                  );
                })}
              </AnimatePresence>
            </Reorder.Group>
            {visibleManagedSections.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">暂无模块</p>
            )}
          </div>

          {/* Add modules */}
          <div className="p-3">
            <h3 className="mb-2 text-sm font-semibold">添加模块</h3>
            <div className="space-y-1">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => addSection(preset.id)}
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{preset.label}</span>
                </button>
              ))}

              {/* Custom section */}
              {!showCustomInput ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => setShowCustomInput(true)}
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>自定义模块</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 pt-1">
                  <Input
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="模块名称"
                    className="h-7 text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addCustomSection();
                      if (e.key === "Escape") setShowCustomInput(false);
                    }}
                  />
                  <Button type="button" size="sm" className="h-7 px-2" onClick={addCustomSection}>
                    添加
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
