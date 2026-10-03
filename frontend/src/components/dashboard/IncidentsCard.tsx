import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Network, Server, Monitor, Router as RouterIcon, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { timeAgo } from "../../lib/format";
import { stageProgress } from "./lifecycle";
import type { Incident, Severity } from "../../types";

const SEVERITIES: { key: Severity; label: string; dot: string; text: string; soft: string }[] = [
  { key: "critical", label: "Critical", dot: "bg-red-500", text: "text-red-600", soft: "bg-red-50" },
  { key: "high", label: "High", dot: "bg-orange-500", text: "text-orange-600", soft: "bg-orange-50" },
  { key: "medium", label: "Medium", dot: "bg-amber-500", text: "text-amber-700", soft: "bg-amber-50" },
  { key: "low", label: "Low", dot: "bg-sky-500", text: "text-sky-700", soft: "bg-sky-50" },
];

const SEV_ICON_BG: Record<Severity, string> = {
  critical: "bg-red-100 text-red-600",
  high: "bg-orange-100 text-orange-600",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-sky-100 text-sky-700",
};

function iconFor(deviceId: string | null) {
  const id = (deviceId ?? "").toLowerCase();
  if (id.startsWith("router")) return RouterIcon;
  if (id.startsWith("switch")) return Network;
  if (id.startsWith("server")) return Server;
  return Monitor;
}

function Segments({ done, total, resolved }: { done: number; total: number; resolved: boolean }) {
  return (
    <div className="flex gap-[3px]">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-3.5 w-[7px] rounded-[3px]",
            i < done ? (resolved ? "bg-emerald-400" : "bg-brand-orange") : "bg-stone-200",
          )}
        />
      ))}
    </div>
  );
}

function IncidentRow({ inc }: { inc: Incident }) {
  const Icon = iconFor(inc.probable_root_cause_device_id);
  const p = stageProgress(inc);
  const resolved = inc.status === "resolved";
  return (
    <motion.li layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <Link
        to={`/incidents/${inc.incident_id}`}
        className={cn(
          "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors",
          resolved ? "bg-stone-50 hover:bg-stone-100" : "bg-stone-100/80 hover:bg-stone-100",
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            resolved ? "bg-emerald-100 text-emerald-600" : SEV_ICON_BG[inc.severity],
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", resolved ? "text-stone-700" : "text-stone-900")}>
            {inc.title}
          </span>
          <span className="block truncate text-xs text-stone-500">
            {inc.incident_id} · {inc.affected_devices.length} device(s) · {timeAgo(inc.detected_at)}
          </span>
        </span>
        <span className="hidden text-right text-xs text-stone-500 sm:block">
          {resolved
            ? `Recovered${inc.recovery_time_seconds != null ? ` in ${Math.round(inc.recovery_time_seconds)}s` : ""}`
            : p.current ?? "Recovered"}
          {!resolved && (
            <span className="ml-1 font-semibold tabular-nums text-stone-800">
              {p.done}/{p.total}
            </span>
          )}
        </span>
        <Segments done={p.done} total={p.total} resolved={resolved} />
      </Link>
    </motion.li>
  );
}

export function IncidentsCard({ incidents }: { incidents: Incident[] }) {
  const active = incidents.filter((i) => i.status !== "resolved");
  const recent = incidents
    .filter((i) => i.status === "resolved")
    .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
    .slice(0, 4);
  const bySev = Object.fromEntries(SEVERITIES.map((s) => [s.key, active.filter((i) => i.severity === s.key).length]));

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Active Incidents</h3>
          <p className="mt-0.5 text-xs text-stone-500">
            {active.length ? `${active.length} open · lifecycle progress on the right` : "Nothing open right now"}
          </p>
        </div>
        <Link to="/incidents" className="flex items-center gap-2 text-sm font-medium text-stone-800">
          View Active Incidents
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-brand-orange">
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {SEVERITIES.map((s) => (
          <div key={s.key} className={cn("rounded-2xl px-3 py-2.5", bySev[s.key] ? s.soft : "bg-stone-50")}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
              <span className={cn("h-2 w-2 rounded-full", bySev[s.key] ? s.dot : "bg-stone-300")} />
              {s.label}
            </div>
            <div className={cn("mt-0.5 text-2xl font-semibold tabular-nums", bySev[s.key] ? s.text : "text-stone-300")}>
              {bySev[s.key]}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex-1 space-y-4">
        {active.length > 0 ? (
          <ul className="space-y-2">
            {active.map((inc) => (
              <IncidentRow key={inc.incident_id} inc={inc} />
            ))}
          </ul>
        ) : (
          <div className="rounded-2xl bg-emerald-50/70 px-4 py-4 text-sm text-emerald-800">
            No open incidents. Every device is reporting normally.
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Recently resolved</div>
            <ul className="space-y-2">
              {recent.map((inc) => (
                <IncidentRow key={inc.incident_id} inc={inc} />
              ))}
            </ul>
          </div>
        )}

        {!active.length && !recent.length && (
          <p className="rounded-2xl bg-stone-50 px-4 py-6 text-center text-sm text-stone-500">
            No incidents yet. Try one from the Fault Injection card.
          </p>
        )}
      </div>

      {!active.length && (
        <Link
          to="/scenarios"
          className="mt-3 flex items-center gap-1 self-start text-xs font-medium text-stone-500 hover:text-stone-900"
        >
          <Plus className="h-3.5 w-3.5" /> Open Fault Injection Lab
        </Link>
      )}
    </div>
  );
}
