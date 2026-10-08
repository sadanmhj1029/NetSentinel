import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { wsUrl } from "../api/client";
import { MaintenanceApi } from "../api/endpoints";
import { alertNewIncidents, bumpTitle } from "../lib/alerts";
import { useAuth } from "./AuthContext";
import type { MaintenanceWindow, TickMessage } from "../types";

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
  /** When the live connection dropped (ms epoch), null while connected. */
  disconnectedSince: number | null;
  /** When the next reconnect attempt will happen (ms epoch). */
  nextRetryAt: number | null;
  retryNow: () => void;
  /** Ticks failing in a row on the server (database trouble etc). 0 = fine. */
  pipelineErrors: number;
  /** Active planned-maintenance windows. */
  maintenance: MaintenanceWindow[];
  /** device_id -> the device whose maintenance covers it (itself, or a device in front of it). */
  maintenanceCover: Record<string, string>;
  refreshMaintenance: () => void;
}

const LiveContext = createContext<LiveContextValue>({
  connected: false,
  lastTick: null,
  tickVersion: 0,
  events: [],
  unread: 0,
  markAllRead: () => {},
  disconnectedSince: null,
  nextRetryAt: null,
  retryNow: () => {},
  pipelineErrors: 0,
  maintenance: [],
  maintenanceCover: {},
  refreshMaintenance: () => {},
});

// Reconnect quickly at first, then back off so a server that's down for a
// while isn't hammered: 1s, 2s, 4s, 8s, then every 15s.
const RECONNECT_STEPS_MS = [1000, 2000, 4000, 8000, 15000];
const MAX_EVENTS = 150;
const MAINTENANCE_EVERY_TICKS = 5;

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
  const { isAuthenticated, token, logout } = useAuth();
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
  const attemptRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const [disconnectedSince, setDisconnectedSince] = useState<number | null>(null);
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null);
  const [pipelineErrors, setPipelineErrors] = useState(0);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const refreshMaintenance = useCallback(() => {
    MaintenanceApi.active()
      .then(setMaintenance)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      socketRef.current?.close();
      return;
    }

    closedByUsRef.current = false;

    function scheduleReconnect() {
      if (closedByUsRef.current) return;
      const delay = RECONNECT_STEPS_MS[Math.min(attemptRef.current, RECONNECT_STEPS_MS.length - 1)];
      attemptRef.current += 1;
      setNextRetryAt(Date.now() + delay);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(connect, delay);
    }

    function connect() {
      if (timerRef.current) clearTimeout(timerRef.current);
      const old = socketRef.current;
      if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) return;
      const ws = new WebSocket(wsUrl("/ws/live", token));
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
        setDisconnectedSince(null);
        setNextRetryAt(null);
        refreshMaintenance();
      };
      ws.onclose = (event) => {
        if (socketRef.current !== ws) return;
        setConnected(false);
        if (closedByUsRef.current) return;
        if (event.code === 1008) {
          // Server rejected the token (missing/expired/invalid). Retrying would
          // hit the same rejection forever, so treat it like any other 401.
          try {
            sessionStorage.setItem("netsentinel:sessionExpired", "1");
          } catch {
            /* ignore */
          }
          logout();
          return;
        }
        setDisconnectedSince((since) => since ?? Date.now());
        scheduleReconnect();
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TickMessage;
          if (data.type === "tick_error") {
            setPipelineErrors(data.consecutive_errors ?? 1);
          } else if (data.type === "tick") {
            setPipelineErrors(0);
          }
          const fresh = eventsFromTick(data, collectorRef.current, () => ++idRef.current);
          if (data.type === "tick" && typeof data.collector_healthy === "boolean") {
            collectorRef.current = data.collector_healthy;
          }
          if (fresh.length) {
            setEvents((prev) => [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS));
            setUnread((n) => n + fresh.length);
          }
          const created = data.incidents_created_detail ?? [];
          if (created.length) {
            alertNewIncidents(created, (id) => navigateRef.current(`/incidents/${encodeURIComponent(id)}`));
            bumpTitle(created.length);
          }
          setLastTick(data);
          setTickVersion((v) => {
            if ((v + 1) % MAINTENANCE_EVERY_TICKS === 0) refreshMaintenance();
            return v + 1;
          });
        } catch {
          // ignore malformed frames
        }
      };
    }

    connectRef.current = () => {
      attemptRef.current = 0;
      connect();
    };
    connect();

    // Coming back to the tab or getting the network back: reconnect now
    // instead of waiting out the backoff.
    const wake = () => {
      if (!document.hidden && socketRef.current?.readyState !== WebSocket.OPEN) connectRef.current();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      closedByUsRef.current = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      if (timerRef.current) clearTimeout(timerRef.current);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close();
      setConnected(false);
      setDisconnectedSince(null);
      setNextRetryAt(null);
    };
  }, [isAuthenticated, token, logout, refreshMaintenance]);

  const markAllRead = useCallback(() => setUnread(0), []);
  const retryNow = useCallback(() => connectRef.current(), []);

  const maintenanceCover = useMemo(() => {
    const cover: Record<string, string> = {};
    for (const w of maintenance) {
      cover[w.device_id] = w.device_id;
      for (const d of w.covers ?? []) cover[d] = cover[d] ?? w.device_id;
    }
    return cover;
  }, [maintenance]);

  return (
    <LiveContext.Provider
      value={{
        connected,
        lastTick,
        tickVersion,
        events,
        unread,
        markAllRead,
        disconnectedSince,
        nextRetryAt,
        retryNow,
        pipelineErrors,
        maintenance,
        maintenanceCover,
        refreshMaintenance,
      }}
    >
      {children}
    </LiveContext.Provider>
  );
}

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}
