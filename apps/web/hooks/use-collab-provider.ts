"use client";

/* eslint-disable react-hooks/set-state-in-effect -- external subscription pattern */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

type PresenceUser = {
  userId: string;
  displayName: string;
  role: "owner" | "mentor";
  color: string;
};

type JsonMessageHandler = (message: Record<string, unknown>) => void;

type CollabState = {
  ydoc: Y.Doc;
  provider: unknown; // y-partykit WebsocketProvider (opaque)
  isConnected: boolean;
  presenceUsers: PresenceUser[];
  sendJson: (message: Record<string, unknown>) => boolean;
  addJsonMessageListener: (handler: JsonMessageHandler) => () => void;
};

type CollabConfig = {
  roomId: string;
  partyToken: string;
  displayName: string;
  role: "owner" | "mentor";
};

// Hardcode production PartyKit host as fallback
const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "intro-collab.rory-x.partykit.dev";

export function useCollabProvider(config: CollabConfig | null): CollabState | null {
  const [state, setState] = useState<CollabState | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!config) {
      setState(null);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function connect() {
      // Use YPartyKitProvider (default export) — NOT the base WebsocketProvider.
      // YPartyKitProvider correctly constructs: wss://{host}/parties/main/{room}?_pk=...&token=...
      // The base WebsocketProvider treats the host as a raw serverUrl (no protocol added),
      // causing the browser to resolve it as a relative URL → connects to the wrong domain.
      const { default: YPartyKitProvider } = await import("y-partykit/provider");
      if (cancelled) return;

      const ydoc = new Y.Doc();

      const provider = new YPartyKitProvider(
        PARTYKIT_HOST,
        config!.roomId,
        ydoc,
        {
          params: { token: config!.partyToken },
          maxBackoffTime: 10000,
          disableBc: true,
        },
      );

      const jsonHandlers = new Set<JsonMessageHandler>();

      const sendJson = (message: Record<string, unknown>) => {
        if (!provider.ws || provider.ws.readyState !== WebSocket.OPEN) return false;
        provider.ws.send(JSON.stringify(message));
        return true;
      };

      const addJsonMessageListener = (handler: JsonMessageHandler) => {
        jsonHandlers.add(handler);
        return () => { jsonHandlers.delete(handler); };
      };

      // Poll provider.wsconnected every 500ms since event-based detection
      // is unreliable across y-partykit versions
      let lastConnected = false;
      let presenceUsers: PresenceUser[] = [];

      pollTimer = setInterval(() => {
        if (cancelled) return;
        const nowConnected = !!provider.wsconnected;
        if (nowConnected !== lastConnected || !lastConnected) {
          lastConnected = nowConnected;
          setState({ ydoc, provider, isConnected: nowConnected, presenceUsers, sendJson, addJsonMessageListener });
        }
      }, 500);

      // Listen for presence messages via WebSocket
      const handleWsOpen = () => {
        if (provider.ws) {
          provider.ws.addEventListener("message", (event: MessageEvent) => {
            if (typeof event.data !== "string") return;
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "presence") {
                presenceUsers = msg.users;
                setState({ ydoc, provider, isConnected: !!provider.wsconnected, presenceUsers, sendJson, addJsonMessageListener });
              }
              for (const handler of jsonHandlers) {
                handler(msg);
              }
            } catch { /* binary Y.js messages */ }
          });
        }
      };

      // Attach on status change to catch new WebSocket instances (reconnects)
      provider.on("status", () => {
        if (provider.wsconnected && provider.ws) {
          handleWsOpen();
        }
      });

      // Also try immediately
      if (provider.ws) {
        handleWsOpen();
      }

      // Initial state
      setState({ ydoc, provider, isConnected: !!provider.wsconnected, presenceUsers, sendJson, addJsonMessageListener });

      // Store cleanup
      cleanupRef.current = () => {
        provider.disconnect();
        ydoc.destroy();
      };
    }

    void connect();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      setState(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.roomId, config?.partyToken]);

  return state;
}

export type { CollabState, CollabConfig, PresenceUser, JsonMessageHandler };
