import { useState } from "react";
import { Wrench } from "lucide-react";
import { MaintenanceApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { useAuth } from "../../store/AuthContext";
import { useLive } from "../../store/LiveContext";

const DURATIONS = [
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "2 hours", value: 120 },
  { label: "4 hours", value: 240 },
];

function untilText(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Small "Maintenance" pill for lists. Shows nothing if the device isn't covered. */
export function MaintenanceBadge({ deviceId, className = "" }: { deviceId: string; className?: string }) {
  const { maintenanceCover, maintenance } = useLive();
  const by = maintenanceCover[deviceId];
  if (!by) return null;
  const w = maintenance.find((m) => m.device_id === by);
  const title = by === deviceId ? `Planned maintenance until ${w ? untilText(w.ends_at) : "later"}` : `Behind ${by}, which is in maintenance`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-inset ring-sky-200 ${className}`}
    >
      <Wrench className="h-3 w-3" /> {by === deviceId ? "Maintenance" : "Covered"}
    </span>
  );
}

/**
 * Device page panel: start planned maintenance (operators and admins) so the
 * work doesn't page anyone, or end it early. Faults during the window are
 * still recorded; they just don't open incidents or alerts.
 */
export function MaintenancePanel({ deviceId }: { deviceId: string }) {
  const { hasRole } = useAuth();
  const { maintenance, maintenanceCover, refreshMaintenance } = useLive();
  const [duration, setDuration] = useState(60);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const own = maintenance.find((m) => m.device_id === deviceId);
  const coveredBy = !own ? maintenanceCover[deviceId] : undefined;
  const canEdit = hasRole("operator");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refreshMaintenance();
      setFormOpen(false);
      setReason("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[22px] bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${own || coveredBy ? "bg-sky-100 text-sky-800" : "bg-beige text-brand-orange-ink"}`}>
            <Wrench className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-stone-900">Planned maintenance</div>
            {own ? (
              <p className="text-sm text-stone-600">
                On until <b>{untilText(own.ends_at)}</b> ({Math.ceil(own.seconds_left / 60)} min left) · {own.reason} · by {own.created_by}
                {own.covers && own.covers.length > 0 && <> · also covers {own.covers.join(", ")}</>}
              </p>
            ) : coveredBy ? (
              <p className="text-sm text-stone-600">Covered because <b>{coveredBy}</b>, in front of it, is in maintenance.</p>
            ) : (
              <p className="text-sm text-stone-500">
                Working on this device? Turn this on so faults during the work don't open incidents or send alerts.
              </p>
            )}
          </div>
        </div>
        {canEdit && own && (
          <button
            disabled={busy}
            onClick={() => run(() => MaintenanceApi.end(own.id))}
            className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-50"
          >
            End now
          </button>
        )}
        {canEdit && !own && !formOpen && (
          <button
            onClick={() => setFormOpen(true)}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft"
          >
            Start maintenance
          </button>
        )}
      </div>

      {canEdit && formOpen && !own && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-stone-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => MaintenanceApi.start({ device_id: deviceId, duration_minutes: duration, reason: reason || "Planned maintenance" }));
          }}
        >
          <label className="text-xs font-medium text-stone-600">
            How long
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="mt-1 block rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
            >
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1 text-xs font-medium text-stone-600">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={255}
              placeholder="Firmware upgrade, cable swap…"
              className="mt-1 block w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-full px-4 py-2 text-sm text-stone-600 hover:bg-stone-100">
              Cancel
            </button>
            <button disabled={busy} className="rounded-full bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange-dark disabled:opacity-50">
              Start
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
