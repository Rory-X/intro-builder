"use client";

/* eslint-disable react-hooks/set-state-in-effect -- WebSocket event → setState is the correct pattern for external subscriptions */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

type PresenceUser = {
  userId: string;
  displayName: string;
  role: "owner" | "mentor";
  color: string;
};

// Use a generic type for the provider since y-partykit types aren't exported cleanly
type WebSocketProvider = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  off: (event: string, cb: (...args: unknown[]) => void) => void;
  disconnect: () => void;
  ws: WebSocket | null;
};

type CollabState = {
  ydoc: Y.Doc;
  provider: WebSocketProvider;
  isConnected: boolean;
  isSynced: boolean;
  presenceUsers: PresenceUser[];
};

type CollabConfig = {
  roomId: string;
  partyToken: string;
  displayName: string;
  role: "owner" | "mentor";
};

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999";

export function useCollabProvider(config: CollabConfig | null): CollabState | null {
  const [state, setState] = useState<CollabState | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!config) {
      setState(null);
      return;
    }

    let cancelled = false;

    async function connect() {
      const { WebsocketProvider } = await import("y-partykit/provider");

      if (cancelled) return;
      if (!config) return;

      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      const provider = new WebsocketProvider(
        PARTYKIT_HOST,
        config.roomId,
        ydoc,
        {
          params: { token: config.partyToken },
          maxBackoffTime: 10000, // Max 10s between retries (not infinite)
          disableBc: true, // Disable broadcast channel (not needed for 1-on-1)
        },
      ) as unknown as WebSocketProvider;
      providerRef.current = provider;

      let isConnected = false;
      let isSynced = false;
      let presenceUsers: PresenceUser[] = [];

      // y-partykit events
      provider.on("status", (payload: unknown) => {
        if (cancelled) return;
        const p = payload as { status: string };
        isConnected = p.status === "connected";
        setState({ ydoc, provider, isConnected, isSynced, presenceUsers });
      });

      provider.on("synced", (payload: unknown) => {
        if (cancelled) return;
        isSynced = true;
        setState({ ydoc, provider, isConnected, isSynced, presenceUsers });
      });

      // Also listen for "sync" event (some versions use this name)
      provider.on("sync", (payload: unknown) => {
        if (cancelled) return;
        isSynced = true;
        setState({ ydoc, provider, isConnected, isSynced, presenceUsers });
      });

      // Listen for custom presence messages
      function onWsMessage(event: MessageEvent) {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "presence") {
            presenceUsers = msg.users;
            setState({ ydoc, provider, isConnected, isSynced, presenceUsers });
          }
        } catch {
          // Binary Y.js sync messages — ignore
        }
      }

      // Attach message listener when ws connects
      provider.on("status", (payload: unknown) => {
        const p = payload as { status: string };
        if (p.status === "connected" && provider.ws) {
          provider.ws.addEventListener("message", onWsMessage);
        }
      });
      if (provider.ws) {
        provider.ws.addEventListener("message", onWsMessage);
      }

      // Set initial connected state (provider might already be connected)
      if ((provider as unknown as { wsconnected?: boolean }).wsconnected) {
        isConnected = true;
      }

      setState({ ydoc, provider, isConnected, isSynced, presenceUsers });
    }

    void connect();

    return () => {
      cancelled = true;
      if (providerRef.current) {
        providerRef.current.disconnect();
        providerRef.current = null;
      }
      if (ydocRef.current) {
        ydocRef.current.destroy();
        ydocRef.current = null;
      }
      setState(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.roomId, config?.partyToken]);

  return state;
}

export type { CollabState, CollabConfig, PresenceUser };
