"use client";

import { useVoiceChat } from "@/hooks/use-voice-chat";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, PhoneIncoming, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  provider: unknown;
  enabled: boolean;
};

export function VoiceChatControls({ provider, enabled }: Props) {
  const voice = useVoiceChat({ provider, enabled });

  if (!enabled) return null;

  // --- Incoming call modal (callee) ---
  if (voice.status === "ringing-in") {
    return (
      <>
        {/* Inline indicator in toolbar */}
        <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 animate-pulse">
          <PhoneIncoming className="h-3.5 w-3.5" />
          来电…
        </span>
        {/* Full-screen modal */}
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-72 rounded-2xl bg-background p-6 shadow-2xl ring-1 ring-border">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                <PhoneIncoming className="h-8 w-8 text-green-600 animate-pulse" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium">{voice.callerName || "对方"}邀请语音通话</p>
                <p className="mt-1 text-sm text-muted-foreground">30 秒内不接听将自动取消</p>
              </div>
              <div className="flex gap-4">
                <Button
                  onClick={voice.rejectCall}
                  variant="destructive"
                  size="lg"
                  className="h-12 w-12 rounded-full p-0"
                  title="拒绝"
                >
                  <X className="h-5 w-5" />
                </Button>
                <Button
                  onClick={voice.acceptCall}
                  size="lg"
                  className="h-12 w-12 rounded-full bg-green-600 p-0 hover:bg-green-700"
                  title="接听"
                >
                  <Phone className="h-5 w-5 text-white" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // --- Outgoing call (ringing, waiting for answer) ---
  if (voice.status === "ringing-out") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
          等待接听…
        </span>
        <Button
          onClick={voice.endCall}
          variant="destructive"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
        >
          <PhoneOff className="h-3 w-3" />
          取消
        </Button>
      </div>
    );
  }

  // --- Connecting (WebRTC negotiating) ---
  if (voice.status === "connecting") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        正在连接…
      </div>
    );
  }

  // --- Connected (active call) ---
  if (voice.status === "connected") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          通话中
        </span>
        <Button
          onClick={voice.toggleMute}
          variant={voice.isMuted ? "secondary" : "ghost"}
          size="sm"
          className="h-7 w-7 p-0"
          title={voice.isMuted ? "取消静音" : "静音"}
        >
          {voice.isMuted ? <MicOff className="h-3.5 w-3.5 text-destructive" /> : <Mic className="h-3.5 w-3.5" />}
        </Button>
        <Button
          onClick={voice.endCall}
          variant="destructive"
          size="sm"
          className="h-7 w-7 p-0"
          title="挂断"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // --- Error ---
  if (voice.status === "error") {
    return (
      <Button
        onClick={voice.startCall}
        variant="outline"
        size="sm"
        className={cn("h-7 gap-1 px-2 text-xs text-destructive")}
        title="连接失败，点击重试"
      >
        <Phone className="h-3 w-3" />
        重试
      </Button>
    );
  }

  // --- Idle (default) ---
  return (
    <Button
      onClick={voice.startCall}
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      title="发起语音通话"
    >
      <Phone className="h-3 w-3" />
      语音
    </Button>
  );
}
