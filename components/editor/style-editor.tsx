"use client";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FONT_MAP, type FontKey } from "@/lib/font-map";
import { DEFAULT_STYLE_SETTINGS, type ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";

const FONT_KEYS: FontKey[] = ["sans", "serif", "mono"];
const FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16] as const;
const HEADING_LINE_HEIGHT_OPTIONS = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8] as const;
const BODY_LINE_HEIGHT_OPTIONS = [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0] as const;
const PAGE_PADDING_OPTIONS = [20, 25, 30, 35, 40, 45, 50, 55, 60] as const;

export function StyleEditor() {
  const { watch, setValue } = useFormContext<ResumeContent>();

  const ss = { ...DEFAULT_STYLE_SETTINGS, ...watch("styleSettings") };

  function set<K extends keyof typeof DEFAULT_STYLE_SETTINGS>(
    key: K,
    val: (typeof DEFAULT_STYLE_SETTINGS)[K],
  ) {
    setValue("styleSettings", { ...ss, [key]: val }, { shouldDirty: true });
  }

  function resetAll() {
    setValue("styleSettings", { ...DEFAULT_STYLE_SETTINGS }, { shouldDirty: true });
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" size="sm" variant="outline" className="gap-1.5" />
        }
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        排版
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] gap-4 p-4">
        <div>
          <h3 className="text-sm font-semibold">排版</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            调整字体、密度和页面尺度。
          </p>
        </div>

        <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-2">
            <Label>字体</Label>
            <div className="grid grid-cols-3 rounded-lg border bg-background p-1">
              {FONT_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted",
                    ss.fontFamily === key && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                  onClick={() => set("fontFamily", key)}
                >
                  {FONT_MAP[key].label}
                </button>
              ))}
            </div>
          </div>

          <ValueDropdownRow
            label="字号"
            value={ss.fontSize}
            unit="px"
            options={FONT_SIZE_OPTIONS}
            onChange={(v) => set("fontSize", v)}
          />

          <ValueDropdownRow
            label="标题行距"
            value={ss.headingLineHeight}
            options={HEADING_LINE_HEIGHT_OPTIONS}
            onChange={(v) => set("headingLineHeight", Math.round(v * 10) / 10)}
          />

          <ValueDropdownRow
            label="正文行距"
            value={ss.bodyLineHeight}
            options={BODY_LINE_HEIGHT_OPTIONS}
            onChange={(v) => set("bodyLineHeight", Math.round(v * 10) / 10)}
          />

          <ValueDropdownRow
            label="页边距"
            value={ss.pagePadding}
            unit="px"
            options={PAGE_PADDING_OPTIONS}
            onChange={(v) => set("pagePadding", v)}
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={resetAll}
          >
            <RotateCcw className="h-3 w-3" />
            恢复默认
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ValueDropdownRow({
  label,
  value,
  unit,
  options,
  onChange,
}: {
  label: string;
  value: number;
  unit?: string;
  options: readonly number[];
  onChange: (v: number) => void;
}) {
  const formattedValue = `${value}${unit ?? ""}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-w-20 justify-between gap-2 px-2.5 tabular-nums"
                aria-label={`${label}：${formattedValue}`}
              />
            }
          >
            {formattedValue}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-72 w-28 gap-0 overflow-y-auto p-1">
            {options.map((option) => {
              const formattedOption = `${option}${unit ?? ""}`;
              return (
                <button
                  key={option}
                  type="button"
                  aria-label={`${label}：${formattedOption}`}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-center text-sm tabular-nums transition-colors hover:bg-muted",
                    option === value && "bg-muted font-semibold text-primary",
                  )}
                  onClick={() => onChange(option)}
                >
                  {formattedOption}
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
