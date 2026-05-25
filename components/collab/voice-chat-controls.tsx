"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useVoiceChat, type VoiceError } from "@/hooks/use-voice-chat";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, PhoneIncoming, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

type Props = {
  provider: unknown;
  enabled: boolean;
};

const ERROR_MESSAGES: Record<NonNullable<VoiceError>, { title: string; desc: string }> = {
  "mic-denied": { title: "麦克风权限被拒", desc: "请在浏览器设置中允许麦克风访问" },
  "timeout": { title: "连接超时", desc: "网络环境可能不支持，建议使用微信语音" },
  "network": { title: "网络连接失败", desc: "当前网络不支持P2P通话，建议使用微信语音" },
  "peer-rejected": { title: "对方已拒绝", desc: "" },
  "peer-timeout": { title: "对方未接听", desc: "" },
  "disconnected": { title: "通话已断开", desc: "" },
};

export function VoiceChatControls({ provider, enabled }: Props) {
  const voice = useVoiceChat({ provider, enabled });
  const prevStatusRef = useRef(voice.status);
  const prevErrorRef = useRef(voice.errorType);

  // Show toast on status transitions
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevError = prevErrorRef.current;
    prevStatusRef.current = voice.status;
    prevErrorRef.current = voice.errorType;

    // Show toast when entering error state
    if (voice.status === "error" && voice.errorType && voice.errorType !== prevError) {
      const msg = ERROR_MESSAGES[voice.errorType];
      if (msg.desc) {
        toast.error(msg.title, { description: msg.desc });
      } else {
        toast.info(msg.title);
      }
    }

    // Show toast when call ends unexpectedly from connected
    if (prevStatus === "connected" && voice.status === "idle") {
      toast.info("通话已结束");
    }
  }, [voice.status, voice.errorType]);

  if (!enabled) return null;

  // --- Incoming call notification (callee) — top-right toast style, non-blocking ---
  if (voice.status === "ringing-in") {
    const notification = (
      <div className="fixed top-4 right-4 z-[9999] w-72 rounded-2xl bg-background p-4 shadow-2xl ring-1 ring-border animate-in slide-in-from-top-2 fade-in duration-300">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
            <PhoneIncoming className="h-5 w-5 text-green-600 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{voice.callerName || "对方"}邀请语音通话</p>
            <p className="text-xs text-muted-foreground">30 秒内不接听将自动取消</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2 justify-end">
          <Button
            onClick={voice.rejectCall}
            variant="outline"
            size="sm"
            className="h-8 gap-1 px-3 text-xs text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            拒绝
          </Button>
          <Button
            onClick={voice.acceptCall}
            size="sm"
            className="h-8 gap-1 px-3 text-xs bg-green-600 hover:bg-green-700 text-white"
          >
            <Phone className="h-3.5 w-3.5" />
            接听
          </Button>
        </div>
      </div>
    );

    return (
      <>
        <span className="flex items-center gap-1.5 text-xs font-medium text-green-600 animate-pulse">
          <PhoneIncoming className="h-3.5 w-3.5" />
          来电…
        </span>
        {typeof document !== "undefined" && createPortal(notification, document.body)}
      </>
    );
  }

  // --- Outgoing call ---
  if (voice.status === "ringing-out") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
          等待接听…
        </span>
        <Button onClick={voice.endCall} variant="destructive" size="sm" className="h-7 gap-1 px-2 text-xs">
          <PhoneOff className="h-3 w-3" />
          取消
        </Button>
      </div>
    );
  }

  // --- Connecting ---
  if (voice.status === "connecting") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        正在连接…
        <Button onClick={voice.endCall} variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]">
          取消
        </Button>
      </div>
    );
  }

  // --- Connected ---
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
        <Button onClick={voice.endCall} variant="destructive" size="sm" className="h-7 w-7 p-0" title="挂断">
          <PhoneOff className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // --- Error with details ---
  if (voice.status === "error") {
    const errInfo = voice.errorType ? ERROR_MESSAGES[voice.errorType] : null;
    const isNetworkError = voice.errorType === "timeout" || voice.errorType === "network";

    return (
      <div className="flex items-center gap-1.5">
        {isNetworkError ? (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-orange-500" />
            {errInfo?.title || "连接失败"}
          </span>
        ) : null}
        <Button
          onClick={voice.startCall}
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          title={errInfo?.desc || "点击重试"}
        >
          <Phone className="h-3 w-3" />
          重试
        </Button>
      </div>
    );
  }

  // --- Idle ---
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
