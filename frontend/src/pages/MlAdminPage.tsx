import { useEffect, useState } from "react";
import { Card, StatTile, Button } from "../components/Card";
import { MlApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { MlStatus } from "../types";

export function MlAdminPage() {
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await MlApi.status());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <p className="text-sm text-stone-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">ML Admin</h1>
          <p className="text-sm text-stone-500">
            Isolation Forest anomaly detector trained on historical telemetry, feature-engineered with rolling
            stats.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => run(() => MlApi.train())} disabled={busy}>
            {busy ? "Working…" : "Retrain model"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => run(() => (status.enabled ? MlApi.disable() : MlApi.enable()))}
            disabled={busy}
          >
            {status.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Status" value={status.status} tone={status.status === "trained" ? "good" : "warn"} />
        <StatTile label="Enabled" value={status.enabled ? "Yes" : "No"} tone={status.enabled ? "good" : "default"} />
        <StatTile label="Version" value={status.version ?? "—"} />
        <StatTile label="Training samples" value={status.n_samples ?? "—"} />
      </div>

      <Card title="Details">
        <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Trained at</dt>
            <dd className="mt-1 text-stone-700">{status.trained_at ? new Date(status.trained_at).toLocaleString() : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Devices</dt>
            <dd className="mt-1 text-stone-700">{status.n_devices ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Contamination</dt>
            <dd className="mt-1 text-stone-700">{status.contamination ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-stone-500">Anomaly threshold</dt>
            <dd className="mt-1 text-stone-700">{status.anomaly_score_threshold ?? "—"}</dd>
          </div>
          <div className="col-span-2 md:col-span-3">
            <dt className="text-xs uppercase tracking-wide text-stone-500">Features</dt>
            <dd className="mt-1 text-stone-700">{status.features?.join(", ") ?? "—"}</dd>
          </div>
          {status.last_error && (
            <div className="col-span-2 md:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-stone-500">Last error</dt>
              <dd className="mt-1 text-red-600">{status.last_error}</dd>
            </div>
          )}
        </dl>
      </Card>
    </div>
  );
}
