import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, StatTile, Button } from "../components/Card";
import { StatusBadge } from "../components/Badges";
import { DevicesApi } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { ApiError } from "../api/client";
import type { Device, MetricSample } from "../types";

function Chart({ data, dataKey, label, color }: { data: MetricSample[]; dataKey: keyof MetricSample; label: string; color: string }) {
  const points = data.map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString(),
    value: s[dataKey] as number | null,
  }));
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={points}>
          <CartesianGrid stroke="#e7e0d6" strokeDasharray="3 3" />
          <XAxis dataKey="time" tick={{ fontSize: 10, fill: "#78716c" }} minTickGap={40} />
          <YAxis tick={{ fontSize: 10, fill: "#78716c" }} width={36} />
          <Tooltip
            contentStyle={{ background: "#ffffff", border: "1px solid #e7e0d6", fontSize: 12 }}
            labelStyle={{ color: "#78716c" }}
          />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { hasRole } = useAuth();
  const { tickVersion } = useLive();
  const [device, setDevice] = useState<Device | null>(null);
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const [baseline, setBaseline] = useState<{ median: number; sample_count: number } | null>(null);
  const [anomaly, setAnomaly] = useState<{ available: boolean; anomaly_score: number | null; is_anomalous: boolean } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!deviceId) return;
    try {
      const data = await DevicesApi.metrics(deviceId, 30);
      setDevice(data.device);
      setSamples(data.samples);
      setBaseline(data.latency_baseline);
      setAnomaly(data.ml_anomaly);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load device");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, tickVersion]);

  async function handleDeactivate() {
    if (!deviceId) return;
    setBusy(true);
    try {
      await DevicesApi.deactivate(deviceId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not deactivate device");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!device) return <p className="text-sm text-stone-500">Loading…</p>;

  const latest = samples[samples.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <Link to="/devices" className="text-xs text-stone-500 hover:text-stone-700">
          ← Back to devices
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{device.device_id}</h1>
            <p className="text-sm text-stone-500">
              {device.hostname} · {device.ip_address} · {device.device_type}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={device.status} />
            {hasRole("admin") && device.is_active && (
              <Button variant="danger" onClick={handleDeactivate} disabled={busy}>
                Deactivate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Latency" value={latest?.latency_ms != null ? `${latest.latency_ms.toFixed(1)} ms` : "—"} />
        <StatTile
          label="Packet loss"
          value={latest?.packet_loss_pct != null ? `${latest.packet_loss_pct.toFixed(1)}%` : "—"}
        />
        <StatTile label="CPU" value={latest?.cpu_pct != null ? `${latest.cpu_pct.toFixed(0)}%` : "—"} />
        <StatTile label="Memory" value={latest?.memory_pct != null ? `${latest.memory_pct.toFixed(0)}%` : "—"} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <Chart data={samples} dataKey="latency_ms" label="Latency (ms)" color="#38bdf8" />
        </Card>
        <Card>
          <Chart data={samples} dataKey="packet_loss_pct" label="Packet loss (%)" color="#f59e0b" />
        </Card>
        <Card>
          <Chart data={samples} dataKey="cpu_pct" label="CPU (%)" color="#a78bfa" />
        </Card>
        <Card>
          <Chart data={samples} dataKey="memory_pct" label="Memory (%)" color="#34d399" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Adaptive baseline (latency)">
          {baseline ? (
            <p className="text-sm text-stone-700">
              Median {baseline.median} ms over the last {baseline.sample_count} samples.
            </p>
          ) : (
            <p className="text-sm text-stone-500">Not enough history yet to establish a baseline.</p>
          )}
        </Card>
        <Card title="ML anomaly score">
          {anomaly?.available ? (
            <p className="text-sm text-stone-700">
              Score {anomaly.anomaly_score?.toFixed(3)} —{" "}
              <span className={anomaly.is_anomalous ? "text-red-600" : "text-emerald-600"}>
                {anomaly.is_anomalous ? "anomalous" : "normal"}
              </span>
            </p>
          ) : (
            <p className="text-sm text-stone-500">ML model not trained or disabled — see ML Admin.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
