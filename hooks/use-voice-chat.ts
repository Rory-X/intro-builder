"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------- Types ----------

export type VoiceChatStatus = "idle" | "connecting" | "connected" | "error";

export type VoiceChatState = {
  status: VoiceChatStatus;
  isMuted: boolean;
  startCall: () => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
};

type UseVoiceChatOptions = {
  /** YPartyKitProvider instance — must expose `.ws` (WebSocket) */
  provider: unknown;
  /** Only attempt to use voice when true (e.g. 2 users present) */
  enabled: boolean;
};

// ---------- Signaling message shapes ----------

type VoiceOffer = { type: "voice-offer"; sdp: string; from?: string };
type VoiceAnswer = { type: "voice-answer"; sdp: string; from?: string };
type VoiceIceCandidate = {
  type: "voice-ice-candidate";
  candidate: RTCIceCandidateInit;
  from?: string;
};
type VoiceHangup = { type: "voice-hangup"; from?: string };

type SignalMessage = VoiceOffer | VoiceAnswer | VoiceIceCandidate | VoiceHangup;

/** Outbound signal (no `from` — server adds it) */
type OutboundSignal =
  | Omit<VoiceOffer, "from">
  | Omit<VoiceAnswer, "from">
  | Omit<VoiceIceCandidate, "from">
  | Omit<VoiceHangup, "from">;

// ---------- STUN config ----------

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// ---------- Helpers ----------

function getWs(provider: unknown): WebSocket | null {
  if (
    provider &&
    typeof provider === "object" &&
    "ws" in provider &&
    provider.ws instanceof WebSocket
  ) {
    return provider.ws;
  }
  return null;
}

function sendSignal(ws: WebSocket, msg: OutboundSignal) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ---------- Hook ----------

export function useVoiceChat({
  provider,
  enabled,
}: UseVoiceChatOptions): VoiceChatState {
  const [status, setStatus] = useState<VoiceChatStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Track whether we are the "caller" (created the offer)
  const isCallerRef = useRef(false);

  // ----- Cleanup -----

  const cleanup = useCallback(() => {
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
    isCallerRef.current = false;
    setStatus("idle");
    setIsMuted(false);
  }, []);

  // ----- Create peer connection -----

  const createPeerConnection = useCallback(
    (ws: WebSocket): RTCPeerConnection => {
      const pc = new RTCPeerConnection(RTC_CONFIG);

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal(ws, {
            type: "voice-ice-candidate",
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        // Play remote audio
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      };

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "connected") {
          setStatus("connected");
        } else if (s === "failed" || s === "closed" || s === "disconnected") {
          cleanup();
        }
      };

      pcRef.current = pc;
      return pc;
    },
    [cleanup],
  );

  // ----- Start call (caller side) -----

  const startCall = useCallback(async () => {
    const ws = getWs(provider);
    if (!ws || !enabled) return;

    try {
      setStatus("connecting");
      isCallerRef.current = true;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = createPeerConnection(ws);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendSignal(ws, { type: "voice-offer", sdp: offer.sdp! });
    } catch (err) {
      console.error("[voice-chat] startCall error:", err);
      cleanup();
      setStatus("error");
    }
  }, [provider, enabled, createPeerConnection, cleanup]);

  // ----- End call -----

  const endCall = useCallback(() => {
    const ws = getWs(provider);
    if (ws) {
      sendSignal(ws, { type: "voice-hangup" });
    }
    cleanup();
  }, [provider, cleanup]);

  // ----- Toggle mute -----

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  }, []);

  // ----- WebSocket message listener (signaling) -----

  useEffect(() => {
    if (!enabled) return;

    const ws = getWs(provider);
    if (!ws) return;

    const handleMessage = async (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      let msg: SignalMessage;
      try {
        msg = JSON.parse(event.data) as SignalMessage;
      } catch {
        return;
      }

      // --- Incoming offer (we are the callee) ---
      if (msg.type === "voice-offer") {
        try {
          setStatus("connecting");
          isCallerRef.current = false;

          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          localStreamRef.current = stream;

          const pc = createPeerConnection(ws);
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: "offer", sdp: msg.sdp }),
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          sendSignal(ws, { type: "voice-answer", sdp: answer.sdp! });
        } catch (err) {
          console.error("[voice-chat] handle offer error:", err);
          cleanup();
          setStatus("error");
        }
        return;
      }

      // --- Incoming answer (we are the caller) ---
      if (msg.type === "voice-answer") {
        if (pcRef.current && pcRef.current.signalingState === "have-local-offer") {
          try {
            await pcRef.current.setRemoteDescription(
              new RTCSessionDescription({ type: "answer", sdp: msg.sdp }),
            );
          } catch (err) {
            console.error("[voice-chat] handle answer error:", err);
          }
        }
        return;
      }

      // --- ICE candidate ---
      if (msg.type === "voice-ice-candidate") {
        if (pcRef.current && pcRef.current.remoteDescription) {
          try {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (err) {
            console.error("[voice-chat] addIceCandidate error:", err);
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
    return () => {
      ws.removeEventListener("message", handleMessage);
    };
  }, [provider, enabled, createPeerConnection, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return { status, isMuted, startCall, endCall, toggleMute };
}
