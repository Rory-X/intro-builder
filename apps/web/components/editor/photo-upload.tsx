"use client";
import { useRef, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Camera, Loader2, User } from "lucide-react";
import { DEFAULT_STYLE_SETTINGS, type ResumeContent } from "@intro-builder/shared/schemas";

const PHOTO_SCALE_OPTIONS = [
  { value: 0.75, label: "75%" },
  { value: 0.85, label: "85%" },
  { value: 1, label: "100%" },
  { value: 1.15, label: "115%" },
  { value: 1.25, label: "125%" },
];

type PhotoUploadProps = {
  showScaleControl?: boolean;
};

export function PhotoUpload({ showScaleControl = true }: PhotoUploadProps) {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const photo = watch("basics.photo");
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

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className="relative flex h-[64px] w-[64px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] border-[1.5px] border-dashed border-muted-foreground/25 bg-muted/50 transition-all duration-200 hover:border-primary hover:bg-primary/5"
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
        <div className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-black/30 opacity-0 transition-opacity duration-200 hover:opacity-100">
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
      {showScaleControl && photo ? (
        <PhotoScaleControl />
      ) : showScaleControl ? (
        <span className="text-[11px] text-muted-foreground">上传头像</span>
      ) : null}
    </div>
  );
}

export function PhotoScaleControl() {
  const { watch, setValue } = useFormContext<ResumeContent>();
  const ss = { ...DEFAULT_STYLE_SETTINGS, ...watch("styleSettings") };
  const curIdx = Math.max(0, PHOTO_SCALE_OPTIONS.findIndex((o) => o.value === ss.photoScale));
  const [showPicker, setShowPicker] = useState(false);

  function setPhotoScale(scale: number) {
    setValue("styleSettings", { ...ss, photoScale: scale }, { shouldDirty: true });
  }

  function stepScale(dir: number) {
    const next = Math.max(0, Math.min(PHOTO_SCALE_OPTIONS.length - 1, curIdx + dir));
    setPhotoScale(PHOTO_SCALE_OPTIONS[next].value);
  }

  return (
    <div className="relative inline-flex w-fit items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5">
      <span className="text-[10px] text-muted-foreground">尺寸</span>
      <button
        type="button"
        onClick={() => setShowPicker(!showPicker)}
        className="w-[36px] text-center text-[11px] tabular-nums font-medium text-foreground hover:text-primary"
      >
        {PHOTO_SCALE_OPTIONS[curIdx].label}
      </button>
      <div className="flex flex-col">
        <button type="button" onClick={() => stepScale(1)} aria-label="放大头像" className="flex h-2.5 w-2.5 items-center justify-center text-muted-foreground hover:text-foreground">
          <svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor"><path d="M3 0L6 4H0L3 0Z"/></svg>
        </button>
        <button type="button" onClick={() => stepScale(-1)} aria-label="缩小头像" className="flex h-2.5 w-2.5 items-center justify-center text-muted-foreground hover:text-foreground">
          <svg width="6" height="4" viewBox="0 0 6 4" fill="currentColor"><path d="M3 4L0 0H6L3 4Z"/></svg>
        </button>
      </div>
      {showPicker && (
        <div className="absolute top-full left-0 z-10 mt-1 flex w-full flex-col overflow-hidden rounded-md border bg-popover shadow-md">
          {PHOTO_SCALE_OPTIONS.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { setPhotoScale(opt.value); setShowPicker(false); }}
              className={`px-2 py-1 text-[11px] tabular-nums transition-colors hover:bg-accent ${i === curIdx ? "bg-accent font-medium" : ""}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
