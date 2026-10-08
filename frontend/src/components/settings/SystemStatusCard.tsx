import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Card } from "../Card";
import { SystemApi } from "../../api/endpoints";
import type { SystemStatus } from "../../types";

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

/** Live health of the backend itself: database, monitoring loop, storage. Refreshes every 5s. */
export function SystemStatusCard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      SystemApi.status()
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          setError(false);
        })
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const ok = status?.ready && !error;
  const p = status?.pipeline;
  const rows: [string, string, boolean?][] = status
    ? [
        ["Database", status.checks.database.ok ? `OK · ${status.checks.database.latency_ms} ms` : status.checks.database.error ?? "Down", status.checks.database.ok],
        ["Monitoring loop", status.checks.scheduler.detail ?? "", status.checks.scheduler.ok],
        ["Check time", p?.last_tick_ms != null ? `${p.last_tick_ms} ms per cycle (every ${status.settings.poll_interval_seconds}s)` : "…"],
        ["Running for", duration(p?.uptime_seconds ?? 0)],
        ["Checks run", `${(p?.total_ticks ?? 0).toLocaleString()}${p?.total_errors ? ` · ${p.total_errors} failed` : ""}`],
        ["Stored samples", `${status.counts.metric_samples.toLocaleString()} · kept ${status.settings.metric_retention_hours} h`],
        ["Live screens connected", String(status.counts.live_clients)],
        ["Anomaly model", status.ml.enabled ? `${status.ml.status}, on` : `${status.ml.status}, off`],
        ["Login lockouts", status.counts.login_lockouts ? `${status.counts.login_lockouts} active` : "None"],
        ["Version", status.version],
      ]
    : [];

  return (
    <Card
      title="System status"
      subtitle="Health of the NetSentinel server itself"
      action={
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            status === null && !error ? "bg-stone-100 text-stone-600" : ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {status === null && !error ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {status === null && !error ? "Checking" : ok ? "All good" : "Needs attention"}
        </span>
      }
    >
      {error && !status && <p className="text-sm text-red-600">Can't reach the server right now.</p>}
      <dl className="divide-y divide-stone-100 text-sm">
        {rows.map(([k, v, good]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-stone-500">{k}</dt>
            <dd className={`text-right font-medium ${good === false ? "text-red-600" : "text-stone-900"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {p?.last_error && p.consecutive_errors > 0 && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 font-mono text-xs text-red-800">{p.last_error}</p>
      )}
    </Card>
  );
}
