"use client";
import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Camera, Loader2, User } from "lucide-react";
import { DEFAULT_STYLE_SETTINGS, type ResumeContent } from "@/lib/resume-schema";

const PHOTO_SCALE_OPTIONS = [
  { value: 0.75, label: "75%" },
  { value: 0.85, label: "85%" },
  { value: 1, label: "100%" },
  { value: 1.15, label: "115%" },
  { value: 1.25, label: "125%" },
];

export function PhotoUpload() {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const photo = watch("basics.photo");
  const ss = { ...DEFAULT_STYLE_SETTINGS, ...watch("styleSettings") };
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload-photo", { method: "PUT", body: form });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      setValue("basics.photo", url, { shouldDirty: true });
    } catch (err) {
      console.error("Photo upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  function setPhotoScale(scale: number) {
    setValue("styleSettings", { ...ss, photoScale: scale }, { shouldDirty: true });
  }

  const curIdx = Math.max(0, PHOTO_SCALE_OPTIONS.findIndex((o) => o.value === ss.photoScale));
  function stepScale(dir: number) {
    const next = Math.max(0, Math.min(PHOTO_SCALE_OPTIONS.length - 1, curIdx + dir));
    setPhotoScale(PHOTO_SCALE_OPTIONS[next].value);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-muted-foreground/20 bg-muted/50 transition-all duration-200 hover:border-primary hover:bg-primary/5"
        onClick={() => inputRef.current?.click()}
        title="点击上传头像"
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- User-uploaded blob URLs are also rendered by the PDF preview path.
          <img src={photo} alt="头像" className="h-full w-full object-cover" />
        ) : (
          <User className="h-8 w-8 text-muted-foreground/60" />
        )}
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/30 opacity-0 transition-opacity duration-200 hover:opacity-100">
          <Camera className="h-5 w-5 text-white" />
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      {photo ? (
        <div className="flex items-center gap-0.5 rounded-lg bg-card-2 p-0.5">
          <button type="button" onClick={() => stepScale(-1)} aria-label="缩小头像" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">−</button>
          <span className="min-w-[34px] text-center text-xs tabular-nums text-foreground">{PHOTO_SCALE_OPTIONS[curIdx].label}</span>
          <button type="button" onClick={() => stepScale(1)} aria-label="放大头像" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">+</button>
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground">上传头像</span>
      )}
    </div>
  );
}
