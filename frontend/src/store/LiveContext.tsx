import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { wsUrl } from "../api/client";
import { useAuth } from "./AuthContext";
import type { TickMessage } from "../types";

interface LiveContextValue {
  connected: boolean;
  lastTick: TickMessage | null;
  // increments on every tick broadcast -- pages depend on this in a
  // useEffect to know "something changed on the server, refetch" without
  // having to reconcile the tick payload into their own local state.
  tickVersion: number;
}

const LiveContext = createContext<LiveContextValue>({ connected: false, lastTick: null, tickVersion: 0 });

const RECONNECT_DELAY_MS = 3000;

export function LiveProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastTick, setLastTick] = useState<TickMessage | null>(null);
  const [tickVersion, setTickVersion] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.close();
      return;
    }

    closedByUsRef.current = false;

    function connect() {
      const ws = new WebSocket(wsUrl("/ws/live"));
      socketRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closedByUsRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TickMessage;
          setLastTick(data);
          setTickVersion((v) => v + 1);
        } catch {
          // ignore malformed frames
        }
      };
    }

    connect();

    return () => {
      closedByUsRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, [isAuthenticated]);

  return (
    <LiveContext.Provider value={{ connected, lastTick, tickVersion }}>{children}</LiveContext.Provider>
  );
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}
