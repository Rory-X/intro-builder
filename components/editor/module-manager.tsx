"use client";
import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { ChevronUp, ChevronDown, Trash2, Plus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { getSectionMeta } from "@/lib/section-meta";
import { MODULE_PRESETS, BUILTIN_SECTION_KEYS } from "@/lib/resume-schema";
import type { ResumeContent } from "@/lib/resume-schema";
import { emptyDoc } from "@/lib/tiptap-types";

type Props = {
  sectionOrder: string[];
  onOrderChange: (next: string[]) => void;
};

export function ModuleManager({ sectionOrder, onOrderChange }: Props) {
  const { getValues, setValue } = useFormContext<ResumeContent>();
  const [customTitle, setCustomTitle] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Sections excluding "basics" (always first, not manageable)
  const managedSections = sectionOrder.filter((k) => k !== "basics");

  // Available modules to add (not already in order)
  const availablePresets = MODULE_PRESETS.filter(
    (p) => !sectionOrder.includes(p.id)
  );

  function moveUp(key: string) {
    const idx = managedSections.indexOf(key);
    if (idx <= 0) return;
    const newManaged = [...managedSections];
    [newManaged[idx - 1], newManaged[idx]] = [newManaged[idx], newManaged[idx - 1]];
    onOrderChange(["basics", ...newManaged]);
  }

  function moveDown(key: string) {
    const idx = managedSections.indexOf(key);
    if (idx === -1 || idx >= managedSections.length - 1) return;
    const newManaged = [...managedSections];
    [newManaged[idx], newManaged[idx + 1]] = [newManaged[idx + 1], newManaged[idx]];
    onOrderChange(["basics", ...newManaged]);
  }

  function removeSection(key: string) {
    // Remove from order
    const newOrder = sectionOrder.filter((k) => k !== key);
    onOrderChange(newOrder);

    // If it's a custom section, remove its data
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

    // If it's a custom-type section (not built-in), add to custom array
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
    // Check if it's in custom sections
    const custom = getValues("custom") ?? [];
    const cs = custom.find((c) => c.id === key);
    if (cs) return cs.title || key;
    // Check presets
    const preset = MODULE_PRESETS.find((p) => p.id === key);
    if (preset) return preset.label;
    // Fallback to section-meta
    return getSectionMeta(key).label;
  }

  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}
      >
        <Layers className="h-3.5 w-3.5" />
        模块管理
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" side="bottom" sideOffset={8}>
        <div className="max-h-[70vh] overflow-y-auto">
          {/* Existing modules */}
          <div className="border-b p-3">
            <h3 className="mb-2 text-sm font-semibold">已有模块</h3>
            <div className="space-y-1">
              {managedSections.map((key, idx) => {
                const meta = getSectionMeta(key);
                const Icon = meta.icon;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                    <span className="flex-1 truncate text-sm">{getSectionLabel(key)}</span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => moveUp(key)}
                        disabled={idx === 0}
                        title="上移"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                        onClick={() => moveDown(key)}
                        disabled={idx === managedSections.length - 1}
                        title="下移"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                        onClick={() => removeSection(key)}
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {managedSections.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">暂无模块</p>
              )}
            </div>
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
