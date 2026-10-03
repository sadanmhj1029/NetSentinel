import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, StatTile } from "../components/Card";
import { ReportsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import type { ReportSummary } from "../types";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#38bdf8",
};

export function AnalyticsPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const { tickVersion } = useLive();

  useEffect(() => {
    ReportsApi.summary().then(setSummary);
  }, [tickVersion]);

  if (!summary) return <p className="text-sm text-stone-500">Loading…</p>;

  const severityData = Object.entries(summary.incidents.by_severity).map(([severity, count]) => ({
    severity,
    count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Analytics</h1>
        <p className="text-sm text-stone-500">
          Evaluation metrics computed from this session's incident history and fault-injection log.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatTile label="MTTD" value={summary.mttd_seconds != null ? `${summary.mttd_seconds.toFixed(0)}s` : "—"} />
        <StatTile label="MTTA" value={summary.mtta_seconds != null ? `${summary.mtta_seconds.toFixed(0)}s` : "—"} />
        <StatTile label="MTTR" value={summary.mttr_seconds != null ? `${summary.mttr_seconds.toFixed(0)}s` : "—"} />
        <StatTile
          label="Root-cause accuracy"
          value={summary.root_cause_accuracy_pct != null ? `${summary.root_cause_accuracy_pct}%` : "—"}
          tone="good"
        />
        <StatTile
          label="False-positive rate"
          value={`${summary.false_positive_rate_pct}%`}
          tone={summary.false_positive_rate_pct && summary.false_positive_rate_pct > 10 ? "warn" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Incidents by severity">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={severityData}>
              <CartesianGrid stroke="#e7e0d6" strokeDasharray="3 3" />
              <XAxis dataKey="severity" tick={{ fontSize: 11, fill: "#78716c" }} />
              <YAxis tick={{ fontSize: 11, fill: "#78716c" }} width={30} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e7e0d6", fontSize: 12 }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {severityData.map((entry) => (
                  <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] ?? "#78716c"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Incident totals">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Total" value={summary.incidents.total} />
            <StatTile label="Active" value={summary.incidents.active} tone={summary.incidents.active ? "bad" : "good"} />
            <StatTile label="Resolved" value={summary.incidents.resolved} tone="good" />
          </div>
        </Card>

        <Card title="Collector reliability">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Status"
              value={summary.collector_reliability.is_healthy ? "Healthy" : "Unhealthy"}
              tone={summary.collector_reliability.is_healthy ? "good" : "bad"}
            />
            <StatTile
              label="Polling success"
              value={`${summary.collector_reliability.polling_success_rate_pct.toFixed(1)}%`}
              sub={`${summary.collector_reliability.consecutive_collector_failures} consecutive failures`}
            />
          </div>
        </Card>

        <Card title="Methodology">
          <p className="text-sm leading-relaxed text-stone-500">{summary.notes}</p>
        </Card>
      </div>
    </div>
  );
}
