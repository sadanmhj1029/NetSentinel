import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { wsUrl } from "../api/client";
import { useAuth } from "./AuthContext";
import type { TickMessage } from "../types";

/** One human-readable thing that happened, derived from websocket ticks. */
export interface LiveEvent {
  id: number;
  at: string;
  kind: "fault_opened" | "fault_recovered" | "incident_created" | "incident_resolved" | "collector_down" | "collector_up";
  deviceId?: string;
  eventType?: string;
  incidentId?: string;
}

interface LiveContextValue {
  connected: boolean;
  lastTick: TickMessage | null;
  // increments on every tick broadcast -- pages depend on this in a
  // useEffect to know "something changed on the server, refetch" without
  // having to reconcile the tick payload into their own local state.
  tickVersion: number;
  /** Newest first, capped. Only ticks where something actually happened add entries. */
  events: LiveEvent[];
  unread: number;
  markAllRead: () => void;
}

const LiveContext = createContext<LiveContextValue>({
  connected: false,
  lastTick: null,
  tickVersion: 0,
  events: [],
  unread: 0,
  markAllRead: () => {},
});

const RECONNECT_DELAY_MS = 3000;
const MAX_EVENTS = 150;

function eventsFromTick(tick: TickMessage, prevCollectorHealthy: boolean | null, nextId: () => number): LiveEvent[] {
  if (tick.type !== "tick" || !tick.timestamp) return [];
  const at = tick.timestamp;
  const out: LiveEvent[] = [];
  if (prevCollectorHealthy !== null && tick.collector_healthy !== prevCollectorHealthy) {
    out.push({ id: nextId(), at, kind: tick.collector_healthy ? "collector_up" : "collector_down" });
  }
  for (const e of tick.opened_events ?? []) {
    out.push({ id: nextId(), at, kind: "fault_opened", deviceId: e.device_id, eventType: e.event_type });
  }
  for (const id of tick.incidents_created ?? []) out.push({ id: nextId(), at, kind: "incident_created", incidentId: id });
  for (const e of tick.recovered_events ?? []) {
    out.push({ id: nextId(), at, kind: "fault_recovered", deviceId: e.device_id, eventType: e.event_type });
  }
  for (const id of tick.incidents_resolved ?? []) out.push({ id: nextId(), at, kind: "incident_resolved", incidentId: id });
  return out;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastTick, setLastTick] = useState<TickMessage | null>(null);
  const [tickVersion, setTickVersion] = useState(0);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUsRef = useRef(false);
  const idRef = useRef(0);
  const collectorRef = useRef<boolean | null>(null);

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
          const fresh = eventsFromTick(data, collectorRef.current, () => ++idRef.current);
          if (data.type === "tick" && typeof data.collector_healthy === "boolean") {
            collectorRef.current = data.collector_healthy;
          }
          if (fresh.length) {
            setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS));
            setUnread((n) => n + fresh.length);
          }
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

  const markAllRead = useCallback(() => setUnread(0), []);

  return (
    <LiveContext.Provider value={{ connected, lastTick, tickVersion, events, unread, markAllRead }}>
      {children}
    </LiveContext.Provider>
  );
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}
