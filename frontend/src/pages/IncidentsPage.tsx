import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { Button, Card } from "../components/Card";
import { FilterBar } from "../components/FilterBar";
import { downloadCsv, stamp, toCsv } from "../lib/csv";
import { ConfidenceLabel, IncidentStatusBadge, SeverityBadge } from "../components/Badges";
import { IncidentsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import type { Incident } from "../types";

const STATUS_FILTERS = ["all", "detected", "investigating", "acknowledged", "recovering", "resolved"] as const;

export function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const { tickVersion } = useLive();

  async function refresh() {
    const data = await IncidentsApi.list();
    setIncidents(data);
  }

  useEffect(() => {
    refresh();
  }, [tickVersion]);

  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (incidents ?? []).filter(
      (i) =>
        (filter === "all" || i.status === filter) &&
        (!q ||
          [i.incident_id, i.title, i.probable_root_cause_device_id ?? "", ...(i.affected_devices ?? [])].some((v) =>
            v.toLowerCase().includes(q)
          ))
    );
  }, [incidents, filter, query]);

  function exportCsv() {
    const csv = toCsv(visible, [
      { header: "Incident", value: (i) => i.incident_id },
      { header: "Title", value: (i) => i.title },
      { header: "Severity", value: (i) => i.severity },
      { header: "Status", value: (i) => i.status },
      { header: "Root cause", value: (i) => i.probable_root_cause_device_id },
      { header: "Confidence", value: (i) => `${Math.round(i.root_cause_confidence)} (${i.root_cause_confidence_label})` },
      { header: "Affected devices", value: (i) => (i.affected_devices ?? []).join(" ") },
      { header: "Detected", value: (i) => new Date(i.detected_at).toLocaleString() },
      { header: "Acknowledged by", value: (i) => i.acknowledged_by },
      { header: "Resolved", value: (i) => (i.resolved_at ? new Date(i.resolved_at).toLocaleString() : "") },
      { header: "Time to recover (s)", value: (i) => (i.recovery_time_seconds != null ? Math.round(i.recovery_time_seconds) : "") },
      { header: "Diagnosis", value: (i) => i.diagnosis_text },
    ]);
    downloadCsv(`netsentinel-incidents-${stamp()}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Incidents</h1>
          <p className="text-sm text-stone-500">Grouped, correlated faults with ranked root-cause candidates.</p>
        </div>
        <Button onClick={exportCsv} variant="secondary" disabled={!visible.length}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <Card>
        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Filter by incident, device or title"
          options={[...STATUS_FILTERS]}
          value={filter}
          onChange={(v) => setFilter(v as (typeof STATUS_FILTERS)[number])}
          count={visible.length}
          total={incidents?.length ?? 0}
        />
        {visible.length === 0 ? (
          <p className="text-sm text-stone-500">No incidents match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Incident</th>
                  <th className="px-3 py-2">Root cause</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Detected</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((inc) => (
                  <tr key={inc.incident_id} className="border-t border-stone-200 hover:bg-stone-50">
                    <td className="px-3 py-2.5">
                      <Link to={`/incidents/${inc.incident_id}`} className="font-medium text-brand-orange-ink hover:underline">
                        {inc.title}
                      </Link>
                      <div className="text-xs text-stone-500">{inc.incident_id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-stone-700">{inc.probable_root_cause_device_id ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <ConfidenceLabel label={inc.root_cause_confidence_label} />
                    </td>
                    <td className="px-3 py-2.5">
                      <SeverityBadge severity={inc.severity} />
                    </td>
                    <td className="px-3 py-2.5">
                      <IncidentStatusBadge status={inc.status} />
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-500">
                      {new Date(inc.detected_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
