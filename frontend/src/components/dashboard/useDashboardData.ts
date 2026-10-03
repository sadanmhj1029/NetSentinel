import { useEffect, useMemo, useRef, useState } from "react";
import {
  CollectorApi,
  DevicesApi,
  IncidentsApi,
  MlApi,
  PriorityApi,
  ScenariosApi,
  TopologyApi,
} from "../../api/endpoints";
import { useLive } from "../../store/LiveContext";
import type {
  CollectorHealth,
  Device,
  Incident,
  MetricSample,
  MlStatus,
  PriorityResult,
  SimulatorState,
  TopologyResponse,
} from "../../types";

export interface DeviceTelemetry {
  device: Device;
  samples: MetricSample[];
  latencyBaseline: { median: number; sample_count: number } | null;
  ml: { available: boolean; anomaly_score: number | null; is_anomalous: boolean };
}

export interface PerfPoint {
  t: string;
  down: number;
  latency: number | null;
  loss: number | null;
  bandwidth: number | null;
  cpu: number | null;
  memory: number | null;
}

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const TELEMETRY_EVERY_N_TICKS = 3; // ~6s at the default 2s poll

function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Everything the dashboard shows, from the existing API only. */
export function useDashboardData() {
  const { tickVersion, lastTick } = useLive();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [focus, setFocus] = useState<Incident | null>(null);
  const [topology, setTopology] = useState<TopologyResponse | null>(null);
  const [priority, setPriority] = useState<PriorityResult | null>(null);
  const [sim, setSim] = useState<SimulatorState | null>(null);
  const [ml, setMl] = useState<MlStatus | null>(null);
  const [collector, setCollector] = useState<CollectorHealth | null>(null);
  const [telemetry, setTelemetry] = useState<DeviceTelemetry[]>([]);
  const telemetryBusy = useRef(false);

  // Fast data: every tick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, i, topo, p, s, m] = await Promise.all([
        DevicesApi.list(),
        IncidentsApi.list(),
        TopologyApi.get().catch(() => null),
        PriorityApi.get().catch(() => null),
        ScenariosApi.list().catch(() => null),
        MlApi.status().catch(() => null),
      ]);
      if (cancelled) return;
      setDevices(d);
      setIncidents(i);
      setTopology(topo);
      setPriority(p);
      setSim(s?.state ?? null);
      setMl(m);

      // The incident the dashboard explains: worst active one, else the latest.
      const active = i.filter((x) => x.status !== "resolved");
      const pick =
        [...active].sort(
          (a, b) =>
            (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
            new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
        )[0] ?? [...i].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())[0];
      if (pick) {
        const detail = await IncidentsApi.get(pick.incident_id).catch(() => pick);
        if (!cancelled) setFocus(detail);
      } else setFocus(null);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tickVersion]);

  // Collector health rides on every websocket tick; fall back to the API on first load.
  useEffect(() => {
    if (lastTick?.type === "tick" && lastTick.collector_health) setCollector(lastTick.collector_health);
  }, [lastTick]);
  useEffect(() => {
    CollectorApi.health().then(setCollector).catch(() => {});
  }, []);

  // Heavier data: per-device telemetry, every few ticks.
  useEffect(() => {
    if (!devices || telemetryBusy.current) return;
    if (tickVersion !== 0 && tickVersion % TELEMETRY_EVERY_N_TICKS !== 1 && telemetry.length) return;
    telemetryBusy.current = true;
    Promise.all(
      devices
        .filter((d) => d.is_active)
        .map((d) =>
          DevicesApi.metrics(d.device_id, 10)
            .then(
              (r): DeviceTelemetry => ({
                device: r.device,
                samples: r.samples,
                latencyBaseline: r.latency_baseline,
                ml: r.ml_anomaly,
              }),
            )
            .catch(() => null),
        ),
    )
      .then((rows) => setTelemetry(rows.filter((r): r is DeviceTelemetry => r !== null)))
      .finally(() => {
        telemetryBusy.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, tickVersion]);

  // Network-wide performance series: average each metric across devices per poll.
  const perf = useMemo<PerfPoint[]>(() => {
    const byT = new Map<string, MetricSample[]>();
    for (const row of telemetry) {
      for (const s of row.samples) {
        const key = s.timestamp.slice(0, 19); // same poll, to the second
        byT.set(key, [...(byT.get(key) ?? []), s]);
      }
    }
    return [...byT.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-60)
      .map(([, rows]) => {
        const up = rows.filter((r) => r.reachable);
        return {
          t: rows[0].timestamp, // full ISO with timezone, so it renders in local time
          down: rows.length - up.length,
          latency: avg(up.map((r) => r.latency_ms)),
          loss: avg(rows.map((r) => r.packet_loss_pct)),
          bandwidth: up.length
            ? up.reduce((a, r) => a + (r.bandwidth_in_mbps ?? 0) + (r.bandwidth_out_mbps ?? 0), 0)
            : null,
          cpu: avg(up.map((r) => r.cpu_pct)),
          memory: avg(up.map((r) => r.memory_pct)),
        };
      });
  }, [telemetry]);

  return {
    devices,
    incidents,
    activeIncidents: incidents.filter((i) => i.status !== "resolved"),
    focus,
    topology,
    priority,
    sim,
    ml,
    collector,
    telemetry,
    perf,
  };
}

export type DashboardData = ReturnType<typeof useDashboardData>;
