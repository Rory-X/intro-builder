"use client";

/**
 * WebRTC P2P voice chat with call/answer flow (like WeChat).
 *
 * Flow:
 * 1. Caller clicks "发起通话" → sends "voice-ring" via WebSocket
 * 2. Callee sees incoming call UI → can accept or reject
 * 3. If accepted: WebRTC offer/answer exchange
 * 4. 30s timeout: auto-cancel if no answer
 * 5. Either side can hangup at any time
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

export type VoiceChatState = {
  status: VoiceChatStatus;
  isMuted: boolean;
  callerName?: string;   // who's calling (for incoming call UI)
  startCall: () => void;
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
};

type UseVoiceChatOptions = {
  /** YPartyKitProvider instance — we access its WebSocket for signaling */
  provider: unknown;
  /** Only show voice when true (e.g. 2 users present) */
  enabled: boolean;
};

// ---------- Signal message types ----------

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
  ],
};

const RING_TIMEOUT_MS = 30_000;

// ---------- Helpers ----------

function getWs(provider: unknown): WebSocket | null {
  if (!provider || typeof provider !== "object") return null;
  // YPartyKitProvider stores WebSocket as .ws
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; });

  // ----- Cleanup -----
  const cleanup = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setStatus("idle");
    setIsMuted(false);
    setCallerName(undefined);
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
      if (s === "connected") setStatus("connected");
      else if (s === "failed" || s === "closed") cleanup();
    };

    pcRef.current = pc;
    return pc;
  }, [cleanup]);

  // ----- Start call (caller) -----
  const startCall = useCallback(() => {
    const ws = getWs(provider);
    if (!ws || !enabled || statusRef.current !== "idle") return;

    setStatus("ringing-out");
    sendSignal(ws, { type: "voice-ring" });

    // 30s timeout
    ringTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === "ringing-out") {
        sendSignal(ws, { type: "voice-cancel" });
        cleanup();
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

  // ----- WebSocket signaling listener -----
  useEffect(() => {
    if (!enabled) return;
    const ws = getWs(provider);
    if (!ws) return;

    const handleMessage = async (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      let msg: VoiceSignal;
      try {
        msg = JSON.parse(event.data);
        if (!msg.type || !VOICE_TYPES.includes(msg.type as typeof VOICE_TYPES[number])) return;
      } catch {
        return;
      }

      const currentStatus = statusRef.current;

      // --- Incoming ring (we are callee) ---
      if (msg.type === "voice-ring") {
        if (currentStatus === "idle") {
          setStatus("ringing-in");
          setCallerName(msg.callerName || "对方");
        }
        return;
      }

      // --- Caller cancelled / timed out ---
      if (msg.type === "voice-cancel") {
        if (currentStatus === "ringing-in") {
          cleanup();
        }
        return;
      }

      // --- Callee rejected ---
      if (msg.type === "voice-reject") {
        if (currentStatus === "ringing-out") {
          cleanup();
        }
        return;
      }

      // --- Callee accepted → caller initiates WebRTC offer ---
      if (msg.type === "voice-accept") {
        if (currentStatus === "ringing-out") {
          if (ringTimeoutRef.current) {
            clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
          }
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
            console.error("[voice] create offer failed:", err);
            sendSignal(ws, { type: "voice-hangup" });
            cleanup();
            setStatus("error");
          }
        }
        return;
      }

      // --- Incoming offer (callee receives after they accepted) ---
      if (msg.type === "voice-offer") {
        if (currentStatus === "connecting" || currentStatus === "ringing-in") {
          setStatus("connecting");
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = stream;
            const pc = createPC(ws);
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
            await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp! }));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignal(ws, { type: "voice-answer", sdp: answer.sdp! });
          } catch (err) {
            console.error("[voice] handle offer failed:", err);
            sendSignal(ws, { type: "voice-hangup" });
            cleanup();
            setStatus("error");
          }
        }
        return;
      }

      // --- Incoming answer (caller receives) ---
      if (msg.type === "voice-answer") {
        if (pcRef.current?.signalingState === "have-local-offer") {
          try {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: msg.sdp! }),
            );
          } catch (err) {
            console.error("[voice] setRemoteDescription failed:", err);
          }
        }
        return;
      }

      // --- ICE candidate ---
      if (msg.type === "voice-ice-candidate" && msg.candidate) {
        if (pcRef.current?.remoteDescription) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (err) {
            console.error("[voice] addIceCandidate failed:", err);
          }
        }
        return;
      }

      // --- Remote hangup ---
      if (msg.type === "voice-hangup") {
        cleanup();
        return;
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [provider, enabled, createPC, cleanup]);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  return { status, isMuted, callerName, startCall, acceptCall, rejectCall, endCall, toggleMute };
}
