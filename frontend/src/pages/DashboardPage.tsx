import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, StatTile, Switch } from "../components/Card";
import { DashboardHero } from "../components/DashboardHero";
import { IncidentStatusBadge, SeverityBadge, StatusBadge } from "../components/Badges";
import { DevicesApi, IncidentsApi, ReportsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import type { Device, Incident, ReportSummary, TickMessage } from "../types";

const LIVE_FEED_PREF_KEY = "netsentinel:showLiveFeed";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.max(0, Math.round(diffMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

interface FeedEntry extends TickMessage {
  key: number;
}

export function DashboardPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [showLiveFeed, setShowLiveFeed] = useState(() => {
    try {
      return localStorage.getItem(LIVE_FEED_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const { lastTick, tickVersion } = useLive();

  function toggleLiveFeed(next: boolean) {
    setShowLiveFeed(next);
    try {
      localStorage.setItem(LIVE_FEED_PREF_KEY, next ? "1" : "0");
    } catch {
      // localStorage unavailable (private mode, etc.) -- toggle still works for this session
    }
  }

  async function refresh() {
    const [d, i, s] = await Promise.all([
      DevicesApi.list(),
      IncidentsApi.list(),
      ReportsApi.summary().catch(() => null),
    ]);
    setDevices(d);
    setIncidents(i);
    setSummary(s);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tickVersion === 0) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickVersion]);

  useEffect(() => {
    if (!showLiveFeed || !lastTick) return;
    setFeed((prev) => [{ ...lastTick, key: tickVersion }, ...prev].slice(0, 15));
  }, [lastTick, tickVersion, showLiveFeed]);

  const counts = { online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const d of devices ?? []) counts[d.status]++;

  const activeIncidents = (incidents ?? []).filter((i) => i.status !== "resolved");

  return (
    <div className="space-y-6">
      <DashboardHero title="Dashboard" subtitle="Live overview of the monitored network." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Devices online" value={counts.online} tone="good" sub={`${devices?.length ?? 0} total`} />
        <StatTile label="Degraded" value={counts.degraded} tone={counts.degraded ? "warn" : "default"} />
        <StatTile label="Offline / Unknown" value={counts.offline + counts.unknown} tone={counts.offline ? "bad" : "default"} />
        <StatTile
          label="Active incidents"
          value={activeIncidents.length}
          tone={activeIncidents.length ? "bad" : "good"}
        />
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="MTTD" value={summary.mttd_seconds != null ? `${summary.mttd_seconds.toFixed(0)}s` : "—"} />
          <StatTile label="MTTA" value={summary.mtta_seconds != null ? `${summary.mtta_seconds.toFixed(0)}s` : "—"} />
          <StatTile label="MTTR" value={summary.mttr_seconds != null ? `${summary.mttr_seconds.toFixed(0)}s` : "—"} />
          <StatTile
            label="Root-cause accuracy"
            value={summary.root_cause_accuracy_pct != null ? `${summary.root_cause_accuracy_pct}%` : "—"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Active incidents" className="lg:col-span-2">
          {activeIncidents.length === 0 ? (
            <p className="text-sm text-stone-500">No active incidents. Everything looks healthy.</p>
          ) : (
            <div className="space-y-2">
              {activeIncidents.map((inc) => (
                <Link
                  key={inc.incident_id}
                  to={`/incidents/${inc.incident_id}`}
                  className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 hover:border-stone-300"
                >
                  <div>
                    <div className="text-sm font-medium text-stone-800">{inc.title}</div>
                    <div className="mt-0.5 text-xs text-stone-500">
                      Root cause: {inc.probable_root_cause_device_id ?? "investigating"} · {inc.affected_devices.length}{" "}
                      device(s) affected
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={inc.severity} />
                    <IncidentStatusBadge status={inc.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Live feed"
          action={<Switch checked={showLiveFeed} onChange={toggleLiveFeed} label={showLiveFeed ? "On" : "Off"} />}
        >
          {!showLiveFeed ? (
            <p className="text-sm text-stone-500">
              Off by default so it doesn't auto-scroll on you. Flip it on to watch monitoring ticks stream in live.
            </p>
          ) : feed.length === 0 ? (
            <p className="text-sm text-stone-500">Waiting for the next monitoring tick…</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {feed.map((entry) => (
                <li key={entry.key} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                  {entry.type === "tick_error" ? (
                    <span className="text-red-600">Tick failed</span>
                  ) : (
                    <>
                      <span className="text-stone-500">{entry.timestamp && timeAgo(entry.timestamp)}</span>
                      {" — "}
                      {!entry.collector_healthy && <span className="text-amber-700">collector unhealthy</span>}
                      {entry.collector_healthy && (
                        <span className="text-stone-700">
                          {entry.opened_events ? `${entry.opened_events} event(s) opened` : "no new events"}
                          {entry.incidents_created?.length ? `, ${entry.incidents_created.length} incident(s) created` : ""}
                          {entry.incidents_resolved?.length ? `, ${entry.incidents_resolved.length} resolved` : ""}
                        </span>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Devices">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {(devices ?? []).map((d) => (
            <Link
              key={d.device_id}
              to={`/devices/${d.device_id}`}
              className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 hover:border-stone-300"
            >
              <span className="text-sm text-stone-800">{d.device_id}</span>
              <StatusBadge status={d.status} />
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
