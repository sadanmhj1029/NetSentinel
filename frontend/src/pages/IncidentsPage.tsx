import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
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

  const visible = (incidents ?? []).filter((i) => filter === "all" || i.status === filter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Incidents</h1>
          <p className="text-sm text-stone-500">Grouped, correlated faults with ranked root-cause candidates.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                filter === s ? "bg-brand-orange text-white" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {visible.length === 0 ? (
          <p className="text-sm text-stone-500">No incidents match this filter.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-stone-200">
            <table className="w-full text-left text-sm">
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
