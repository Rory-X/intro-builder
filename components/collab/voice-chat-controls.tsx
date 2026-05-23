"use client";

import { Button } from "@/components/ui/button";
import { useVoiceChat, type VoiceChatStatus } from "@/hooks/use-voice-chat";
import { cn } from "@/lib/utils";

// ---------- Icons (inline SVG to avoid extra deps) ----------

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function PhoneOffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" />
      <path d="M14.91 3.07a19.79 19.79 0 0 1 3.07 8.67 2 2 0 0 1-1.72 2h-3" />
      <path d="M4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4", className)}
    >
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .78-.13 1.53-.36 2.23" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-4 animate-spin", className)}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ---------- Props ----------

type VoiceChatControlsProps = {
  /** YPartyKitProvider instance */
  provider: unknown;
  /** Whether voice chat is available (e.g. 2 users in room) */
  enabled: boolean;
  className?: string;
};

// ---------- Component ----------

export function VoiceChatControls({
  provider,
  enabled,
  className,
}: VoiceChatControlsProps) {
  const { status, isMuted, startCall, endCall, toggleMute } = useVoiceChat({
    provider,
    enabled,
  });

  if (!enabled) return null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {status === "idle" && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={startCall}
          title="发起语音通话"
        >
          <PhoneIcon />
        </Button>
      )}

      {status === "connecting" && (
        <Button variant="ghost" size="icon-sm" disabled title="正在连接…">
          <LoaderIcon />
        </Button>
      )}

      {status === "connected" && (
        <>
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            通话中
          </span>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleMute}
            title={isMuted ? "取消静音" : "静音"}
            className={cn(isMuted && "text-red-500")}
          >
            {isMuted ? <MicOffIcon /> : <MicIcon />}
          </Button>

          <Button
            variant="destructive"
            size="icon-sm"
            onClick={endCall}
            title="挂断"
          >
            <PhoneOffIcon />
          </Button>
        </>
      )}

      {status === "error" && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={startCall}
          title="连接失败，点击重试"
          className="text-red-500"
        >
          <PhoneIcon />
        </Button>
      )}
    </div>
  );
}

export type { VoiceChatControlsProps, VoiceChatStatus };
