"use client";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { FONT_MAP, type FontKey } from "@/lib/font-map";
import { DEFAULT_STYLE_SETTINGS, type ResumeContent } from "@/lib/resume-schema";
import { Settings2, RotateCcw } from "lucide-react";
import { useState } from "react";

const FONT_KEYS: FontKey[] = ["sans", "serif", "mono"];

export function StyleEditor() {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const [isOpen, setIsOpen] = useState(false);

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
    <section className="rounded-xl border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex items-center gap-2.5 text-lg font-semibold">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Settings2 className="h-4 w-4 text-primary" />
          </div>
          排版设置
        </span>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="space-y-5 border-t px-5 pb-5 pt-4">
          {/* Font family */}
          <div className="space-y-2">
            <Label>字体</Label>
            <div className="flex gap-1.5">
              {FONT_KEYS.map((key) => (
                <Button
                  key={key}
                  type="button"
                  variant={ss.fontFamily === key ? "default" : "outline"}
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => set("fontFamily", key)}
                >
                  {FONT_MAP[key].label}
                </Button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <SliderRow
            label="字号"
            value={ss.fontSize}
            min={10}
            max={16}
            step={0.5}
            unit="px"
            onChange={(v) => set("fontSize", v)}
          />

          {/* Line height */}
          <SliderRow
            label="行距"
            value={ss.lineHeight}
            min={1.2}
            max={2.0}
            step={0.1}
            onChange={(v) => set("lineHeight", Math.round(v * 10) / 10)}
          />

          {/* Page padding */}
          <SliderRow
            label="页边距"
            value={ss.pagePadding}
            min={20}
            max={60}
            step={5}
            unit="px"
            onChange={(v) => set("pagePadding", v)}
          />

          {/* Reset */}
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
      )}
    </section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {value}{unit ?? ""}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v: number | readonly number[]) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}
