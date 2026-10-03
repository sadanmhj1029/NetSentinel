import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, StatTile, Button } from "../components/Card";
import { ConfidenceLabel, IncidentStatusBadge, SeverityBadge } from "../components/Badges";
import { IncidentsApi } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { ApiError } from "../api/client";
import type { Incident } from "../types";

export function IncidentDetailPage() {
  const { incidentId } = useParams<{ incidentId: string }>();
  const { hasRole, username } = useAuth();
  const { tickVersion } = useLive();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!incidentId) return;
    try {
      setIncident(await IncidentsApi.get(incidentId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load incident");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId, tickVersion]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!incident) return <p className="text-sm text-stone-500">Loading…</p>;

  async function run(action: () => Promise<Incident>) {
    setBusy(true);
    try {
      setIncident(await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim() || !incidentId) return;
    await run(() => IncidentsApi.addNote(incidentId, note.trim()));
    setNote("");
  }

  async function handleResolve(e: FormEvent) {
    e.preventDefault();
    if (!resolution.trim() || !incidentId) return;
    await run(() => IncidentsApi.resolve(incidentId, resolution.trim()));
    setResolution("");
  }

  const canOperate = hasRole("operator");

  return (
    <div className="space-y-6">
      <div>
        <Link to="/incidents" className="text-xs text-stone-500 hover:text-stone-700">
          ← Back to incidents
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-stone-900">{incident.title}</h1>
            <p className="text-sm text-stone-500">{incident.incident_id}</p>
          </div>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <IncidentStatusBadge status={incident.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Probable root cause"
          value={incident.probable_root_cause_device_id ?? "Investigating"}
        />
        <StatTile
          label="Confidence"
          value={<ConfidenceLabel label={incident.root_cause_confidence_label} />}
          sub={`${incident.root_cause_confidence.toFixed(1)} score`}
        />
        <StatTile label="Affected devices" value={incident.affected_devices.length} />
        <StatTile
          label="Recovery time"
          value={incident.recovery_time_seconds != null ? `${incident.recovery_time_seconds.toFixed(0)}s` : "—"}
        />
      </div>

      <Card title="Diagnosis">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{incident.diagnosis_text}</p>
        {incident.recommended_checks.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">Recommended checks</div>
            <ul className="list-inside list-disc space-y-1 text-sm text-stone-700">
              {incident.recommended_checks.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Ranked candidates">
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Score</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2">Coverage</th>
                <th className="px-3 py-2">Temporal</th>
                <th className="px-3 py-2">Health contrast</th>
                <th className="px-3 py-2">Dependency</th>
                <th className="px-3 py-2">Direct evidence</th>
              </tr>
            </thead>
            <tbody>
              {incident.ranked_candidates.map((c) => (
                <tr
                  key={c.device_id}
                  className={`border-t border-stone-200 ${
                    c.device_id === incident.probable_root_cause_device_id ? "bg-red-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-stone-800">{c.device_id}</td>
                  <td className="px-3 py-2 text-stone-700">{c.overall_score.toFixed(1)}</td>
                  <td className="px-3 py-2">
                    <ConfidenceLabel label={c.confidence_label} />
                  </td>
                  <td className="px-3 py-2 text-stone-500">{c.coverage_pct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-stone-500">{c.temporal_correlation_pct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-stone-500">{c.health_contrast_pct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-stone-500">{c.dependency_importance_pct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-stone-500">{c.has_direct_evidence ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Timeline">
          <ul className="space-y-2">
            {incident.timeline.map((t, i) => (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-orange" />
                <span className="text-stone-700 capitalize">{t.stage}</span>
                <span className="text-xs text-stone-500">{new Date(t.timestamp).toLocaleTimeString()}</span>
                {t.by && <span className="text-xs text-stone-500">by {t.by}</span>}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Operator notes">
          <ul className="mb-3 space-y-2">
            {incident.operator_notes.length === 0 && <p className="text-sm text-stone-500">No notes yet.</p>}
            {incident.operator_notes.map((n, i) => (
              <li key={i} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                <div className="text-stone-700">{n.note}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {n.author} · {new Date(n.timestamp).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>

          {canOperate && incident.status !== "resolved" && (
            <div className="space-y-3">
              <form onSubmit={handleAddNote} className="flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={`Add a note as ${username}…`}
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
                />
                <Button type="submit" variant="secondary" disabled={busy || !note.trim()}>
                  Add note
                </Button>
              </form>

              {!incident.acknowledged && (
                <Button onClick={() => run(() => IncidentsApi.acknowledge(incidentId!))} disabled={busy}>
                  Acknowledge
                </Button>
              )}

              <form onSubmit={handleResolve} className="flex gap-2">
                <input
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Resolution summary…"
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
                />
                <Button type="submit" variant="danger" disabled={busy || !resolution.trim()}>
                  Resolve
                </Button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
