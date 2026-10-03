import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileJson } from "lucide-react";
import { Card, StatTile } from "../components/Card";
import { IncidentStatusBadge, SeverityBadge } from "../components/Badges";
import { IncidentsApi, ReportsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import type { Incident, ReportSummary } from "../types";

function download(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function ReportsPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const { tickVersion } = useLive();

  useEffect(() => {
    ReportsApi.summary().then(setSummary).catch(() => {});
    IncidentsApi.list().then(setIncidents).catch(() => {});
  }, [tickVersion]);

  const sorted = [...incidents].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime());

  function downloadCsv() {
    const header = [
      "incident_id", "title", "severity", "status", "probable_root_cause", "confidence",
      "affected_devices", "detected_at", "acknowledged_by", "resolved_at", "recovery_time_seconds", "recommended_checks",
    ];
    const rows = sorted.map((i) => [
      i.incident_id, i.title, i.severity, i.status, i.probable_root_cause_device_id ?? "",
      `${i.root_cause_confidence_label} (${i.root_cause_confidence.toFixed(1)})`,
      i.affected_devices.join(" "), i.detected_at, i.acknowledged_by ?? "", i.resolved_at ?? "",
      i.recovery_time_seconds ?? "", i.recommended_checks.join("; "),
    ]);
    download(`netsentinel-incidents-${stamp()}.csv`, [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  }

  function downloadJson() {
    download(
      `netsentinel-report-${stamp()}.json`,
      JSON.stringify({ generated_at: new Date().toISOString(), summary, incidents: sorted }, null, 2),
      "application/json",
    );
  }

  const fmtS = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(0)}s`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-stone-900">Reports</h2>
          <p className="text-sm text-stone-500">Incident history and response metrics for this monitoring session.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadCsv}
            disabled={!incidents.length}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Download Incident Report (CSV)
          </button>
          <button
            onClick={downloadJson}
            disabled={!summary}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            <FileJson className="h-4 w-4" /> Download Full Report (JSON)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Incidents" value={summary?.incidents.total ?? "—"} sub={summary ? `${summary.incidents.active} active` : undefined} />
        <StatTile label="Mean time to detect" value={fmtS(summary?.mttd_seconds)} />
        <StatTile label="Mean time to acknowledge" value={fmtS(summary?.mtta_seconds)} />
        <StatTile label="Mean time to recover" value={fmtS(summary?.mttr_seconds)} />
        <StatTile
          label="Root-cause accuracy"
          value={summary?.root_cause_accuracy_pct != null ? `${summary.root_cause_accuracy_pct}%` : "—"}
          tone="good"
        />
        <StatTile label="False-positive rate" value={summary ? `${summary.false_positive_rate_pct}%` : "—"} />
      </div>

      <Card title="Incident history" subtitle={`${sorted.length} incident(s), newest first`}>
        {sorted.length === 0 ? (
          <p className="text-sm text-stone-500">No incidents recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-stone-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Incident</th>
                  <th className="px-3 py-2">Root cause</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Detected</th>
                  <th className="px-3 py-2">Recovered in</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((i) => (
                  <tr key={i.incident_id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2.5">
                      <Link to={`/incidents/${i.incident_id}`} className="font-medium text-brand-orange-ink hover:underline">
                        {i.title}
                      </Link>
                      <div className="text-xs text-stone-500">{i.incident_id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{i.probable_root_cause_device_id ?? "—"}</td>
                    <td className="px-3 py-2.5"><SeverityBadge severity={i.severity} /></td>
                    <td className="px-3 py-2.5"><IncidentStatusBadge status={i.status} /></td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">{new Date(i.detected_at).toLocaleString()}</td>
                    <td className="px-3 py-2.5 tabular-nums text-stone-700">{fmtS(i.recovery_time_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {summary?.notes && <p className="text-xs leading-relaxed text-stone-400">{summary.notes}</p>}
    </div>
  );
}
