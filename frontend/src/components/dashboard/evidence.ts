import type { Event } from "../../types";
import { eventLabel } from "../../lib/format";

const n = (v: unknown) => (typeof v === "number" ? v : null);

/** One short, concrete evidence line for an event, using its recorded measurements. */
export function evidenceLine(e: Event): string {
  const ev = e.evidence ?? {};
  switch (e.event_type) {
    case "unreachable": {
      const polls = n(ev.consecutive_bad);
      return `${e.device_id} stopped answering${polls ? ` (${polls} missed polls in a row)` : ""}`;
    }
    case "high_latency": {
      const lat = n(ev.latency_ms);
      const range = Array.isArray(ev.baseline_expected_range) ? (ev.baseline_expected_range as number[]) : null;
      if (lat != null && range) return `${e.device_id} latency ${lat.toFixed(0)} ms vs normal ${range[0].toFixed(0)}–${range[1].toFixed(0)} ms`;
      if (lat != null) return `${e.device_id} latency ${lat.toFixed(0)} ms (limit ${n(ev.threshold_ms)?.toFixed(0) ?? "?"} ms)`;
      break;
    }
    case "packet_loss": {
      const loss = n(ev.packet_loss_pct);
      if (loss != null) return `${e.device_id} dropping ${loss.toFixed(0)}% of packets (limit ${n(ev.threshold_pct)?.toFixed(0) ?? "?"}%)`;
      break;
    }
    case "bandwidth_saturation": {
      const u = n(ev.utilization_pct);
      if (u != null) return `${e.device_id} link ${u.toFixed(0)}% utilized (limit ${n(ev.threshold_pct)?.toFixed(0) ?? 85}%)`;
      break;
    }
    case "high_cpu": {
      const c = n(ev.cpu_pct);
      if (c != null) return `${e.device_id} CPU at ${c.toFixed(0)}%`;
      break;
    }
    case "high_memory": {
      const m = n(ev.memory_pct);
      if (m != null) return `${e.device_id} memory at ${m.toFixed(0)}%`;
      break;
    }
    case "ml_anomaly": {
      const s = n(ev.anomaly_score);
      if (s != null) return `${e.device_id} flagged by the anomaly model (score ${s.toFixed(0)})`;
      break;
    }
  }
  return `${e.device_id}: ${eventLabel(e.event_type).toLowerCase()}`;
}
