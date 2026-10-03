import type { LiveEvent } from "../store/LiveContext";

export const EVENT_LABELS: Record<string, string> = {
  unreachable: "Unreachable",
  packet_loss: "Packet loss",
  high_latency: "High latency",
  high_cpu: "High CPU",
  high_memory: "High memory",
  interface_down: "Interface down",
  bandwidth_saturation: "Bandwidth saturation",
  ml_anomaly: "ML anomaly",
  baseline_anomaly: "Baseline anomaly",
};

export function eventLabel(type?: string): string {
  if (!type) return "";
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Sentence + tone for one live event, used by the notification bell and the timeline. */
export function describeLiveEvent(e: LiveEvent): { text: string; tone: "bad" | "good" | "warn" | "info" } {
  switch (e.kind) {
    case "fault_opened":
      return { text: `${e.deviceId}: ${eventLabel(e.eventType).toLowerCase()} detected`, tone: e.eventType === "unreachable" ? "bad" : "warn" };
    case "fault_recovered":
      return { text: `${e.deviceId}: ${eventLabel(e.eventType).toLowerCase()} cleared`, tone: "good" };
    case "incident_created":
      return { text: `${e.incidentId} opened and diagnosed`, tone: "bad" };
    case "incident_resolved":
      return { text: `${e.incidentId} recovered and closed`, tone: "good" };
    case "collector_down":
      return { text: "Collector stopped polling: data is going stale", tone: "warn" };
    case "collector_up":
      return { text: "Collector is polling again", tone: "good" };
  }
}

export const TONE_DOT: Record<string, string> = {
  bad: "bg-red-500",
  warn: "bg-amber-500",
  good: "bg-emerald-500",
  info: "bg-stone-400",
};
