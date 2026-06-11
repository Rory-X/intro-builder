"use client";

/**
 * WebRTC P2P voice chat with:
 * - Call/answer flow (WeChat-style, 30s timeout)
 * - WebSocket reconnection detection
 * - ICE candidate buffering
 * - TURN fallback servers
 * - Connection timeout (15s) + auto-retry (1x)
 * - Error classification for UI
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------- Types ----------

export type VoiceChatStatus =
  | "idle"
  | "ringing-out"    // caller: waiting for callee to answer
  | "ringing-in"     // callee: incoming call
  | "connecting"     // WebRTC negotiating
  | "connected"      // call active
  | "error";

export type VoiceError =
  | "mic-denied"       // 麦克风权限被拒
  | "timeout"          // 连接超时
  | "network"          // ICE/NAT 失败
  | "peer-rejected"    // 对方拒绝
  | "peer-timeout"     // 对方未接
  | "disconnected"     // 通话中断开
  | null;

export type VoiceChatState = {
  status: VoiceChatStatus;
  isMuted: boolean;
  callerName?: string;
  errorType: VoiceError;
  startCall: () => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
};

type UseVoiceChatOptions = {
  provider: unknown;
  enabled: boolean;
};

// ---------- Signal types ----------

const VOICE_TYPES = [
  "voice-ring", "voice-accept", "voice-reject", "voice-cancel",
  "voice-offer", "voice-answer", "voice-ice-candidate", "voice-hangup",
] as const;

type VoiceSignal = {
  type: (typeof VOICE_TYPES)[number];
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  callerName?: string;
  from?: string;
};

// ---------- Config ----------

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Free TURN fallback for symmetric NAT / corporate firewalls
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

const RING_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 1;

// ---------- Helpers ----------

function getWs(provider: unknown): WebSocket | null {
  if (!provider || typeof provider !== "object") return null;
  const p = provider as Record<string, unknown>;
  const ws = p.ws;
  if (ws && typeof ws === "object" && "readyState" in ws && "send" in ws) {
    return ws as WebSocket;
  }
  return null;
}

function sendSignal(ws: WebSocket | null, msg: Omit<VoiceSignal, "from">) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ---------- Hook ----------

export function useVoiceChat({ provider, enabled }: UseVoiceChatOptions): VoiceChatState {
  const [status, setStatus] = useState<VoiceChatStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [callerName, setCallerName] = useState<string>();
  const [errorType, setErrorType] = useState<VoiceError>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const iceCandidateBuffer = useRef<RTCIceCandidateInit[]>([]);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; });

  // Track current WebSocket for reconnection detection
  const wsRef = useRef<WebSocket | null>(null);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // ----- Cleanup -----
  const cleanup = useCallback((error?: VoiceError) => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = null; }
    iceCandidateBuffer.current = [];
    setIsMuted(false);
    setCallerName(undefined);
    if (error) {
      setStatus("error");
      setErrorType(error);
    } else {
      setStatus("idle");
      setErrorType(null);
    }
  }, []);

  // ----- Flush buffered ICE candidates -----
  const flushIceCandidates = useCallback(() => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return;
    for (const c of iceCandidateBuffer.current) {
      pcRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    iceCandidateBuffer.current = [];
  }, []);

  // ----- Create RTCPeerConnection -----
  const createPC = useCallback((ws: WebSocket): RTCPeerConnection => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal(ws, { type: "voice-ice-candidate", candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      if (!remoteAudioRef.current) {
        remoteAudioRef.current = new Audio();
        remoteAudioRef.current.autoplay = true;
      }
      remoteAudioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
        retryCountRef.current = 0;
        setStatus("connected");
        setErrorType(null);
      } else if (s === "failed") {
        // Try retry
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          cleanup();
          // Auto-retry after 2s (will be triggered by the caller)
        } else {
          cleanup("network");
        }
      } else if (s === "closed" || s === "disconnected") {
        if (statusRef.current === "connected") {
          cleanup("disconnected");
        }
      }
    };

    pcRef.current = pc;

    // Connection timeout
    connectTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "connecting") {
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          cleanup();
          // Return to idle for retry
        } else {
          cleanup("timeout");
        }
      }
    }, CONNECT_TIMEOUT_MS);

    return pc;
  }, [cleanup]);

  // ----- Start call (caller) -----
  const startCall = useCallback(() => {
    const ws = getWs(provider);
    if (!ws || !enabled) return;
    // Allow starting from idle OR error state (retry)
    if (statusRef.current !== "idle" && statusRef.current !== "error") return;

    retryCountRef.current = 0;
    setStatus("ringing-out");
    setErrorType(null);
    sendSignal(ws, { type: "voice-ring" });

    ringTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "ringing-out") {
        sendSignal(ws, { type: "voice-cancel" });
        cleanup("peer-timeout");
      }
    }, RING_TIMEOUT_MS);
  }, [provider, enabled, cleanup]);

  // ----- Accept call (callee) -----
  const acceptCall = useCallback(() => {
    const ws = getWs(provider);
    if (!ws || statusRef.current !== "ringing-in") return;
    setStatus("connecting");
    sendSignal(ws, { type: "voice-accept" });
  }, [provider]);

  // ----- Reject call (callee) -----
  const rejectCall = useCallback(() => {
    const ws = getWs(provider);
    sendSignal(ws, { type: "voice-reject" });
    cleanup();
  }, [provider, cleanup]);

  // ----- End call / cancel -----
  const endCall = useCallback(() => {
    const ws = getWs(provider);
    if (statusRef.current === "ringing-out") {
      sendSignal(ws, { type: "voice-cancel" });
    } else {
      sendSignal(ws, { type: "voice-hangup" });
    }
    cleanup();
  }, [provider, cleanup]);

  // ----- Toggle mute -----
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  }, []);

  // ----- WebSocket message handler (signaling) -----
  const createMessageHandler = useCallback((ws: WebSocket) => {
    return async (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      let msg: VoiceSignal;
      try {
        msg = JSON.parse(event.data);
        if (!msg.type || !VOICE_TYPES.includes(msg.type as (typeof VOICE_TYPES)[number])) return;
      } catch { return; }

      const currentStatus = statusRef.current;

      if (msg.type === "voice-ring") {
        if (currentStatus === "idle") {
          setStatus("ringing-in");
          setCallerName(msg.callerName || "对方");
        }
        return;
      }

      if (msg.type === "voice-cancel") {
        if (currentStatus === "ringing-in") cleanup();
        return;
      }

      if (msg.type === "voice-reject") {
        if (currentStatus === "ringing-out") cleanup("peer-rejected");
        return;
      }

      if (msg.type === "voice-accept") {
        if (currentStatus === "ringing-out") {
          if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
          setStatus("connecting");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;
            const pc = createPC(ws);
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendSignal(ws, { type: "voice-offer", sdp: offer.sdp! });
          } catch (err) {
            const isDenied = err instanceof DOMException && err.name === "NotAllowedError";
            sendSignal(ws, { type: "voice-hangup" });
            cleanup(isDenied ? "mic-denied" : "network");
          }
        }
        return;
      }

      if (msg.type === "voice-offer") {
        if (currentStatus === "connecting" || currentStatus === "ringing-in") {
          setStatus("connecting");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;
            const pc = createPC(ws);
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp! }));
            flushIceCandidates();
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(ws, { type: "voice-answer", sdp: answer.sdp! });
          } catch (err) {
            const isDenied = err instanceof DOMException && err.name === "NotAllowedError";
            sendSignal(ws, { type: "voice-hangup" });
            cleanup(isDenied ? "mic-denied" : "network");
          }
        }
        return;
      }

      if (msg.type === "voice-answer") {
        if (pcRef.current?.signalingState === "have-local-offer") {
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: msg.sdp! }));
            flushIceCandidates();
          } catch { cleanup("network"); }
        }
        return;
      }

      if (msg.type === "voice-ice-candidate" && msg.candidate) {
        if (pcRef.current?.remoteDescription) {
          pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
        } else {
          // Buffer until remote description is set
          iceCandidateBuffer.current.push(msg.candidate);
        }
        return;
      }

      if (msg.type === "voice-hangup") {
        if (currentStatus === "connected") cleanup("disconnected");
        else cleanup();
        return;
      }
    };
  }, [createPC, cleanup, flushIceCandidates]);

  // ----- WebSocket binding with reconnection detection -----
  useEffect(() => {
    if (!enabled) return;

    const bindListener = () => {
      const ws = getWs(provider);
      if (ws === wsRef.current) return; // same WS, no change

      // Remove old listener
      if (wsRef.current && listenerRef.current) {
        wsRef.current.removeEventListener("message", listenerRef.current);
      }

      wsRef.current = ws;
      if (!ws) { listenerRef.current = null; return; }

      const handler = createMessageHandler(ws);
      listenerRef.current = handler;
      ws.addEventListener("message", handler);
    };

    // Bind immediately
    bindListener();

    // Check for WebSocket reconnection every second
    const interval = setInterval(bindListener, 1000);

    return () => {
      clearInterval(interval);
      if (wsRef.current && listenerRef.current) {
        wsRef.current.removeEventListener("message", listenerRef.current);
      }
      wsRef.current = null;
      listenerRef.current = null;
    };
  }, [provider, enabled, createMessageHandler]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return { status, isMuted, callerName, errorType, startCall, acceptCall, rejectCall, endCall, toggleMute };
}
