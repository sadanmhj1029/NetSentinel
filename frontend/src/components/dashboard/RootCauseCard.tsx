import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowUpRight, CheckCircle2, Crosshair } from "lucide-react";
import { cn } from "../../lib/utils";
import { timeOf } from "../../lib/format";
import { evidenceLine } from "./evidence";
import type { Incident, TopologyResponse } from "../../types";

/**
 * Evidence that actually discriminates the root cause from its symptoms:
 * its own measurement, what failed after it downstream, and whether the
 * device above it stayed healthy. Built from the incident's events and
 * the live topology.
 */
function buildEvidence(inc: Incident, topology: TopologyResponse | null): string[] {
  const root = inc.probable_root_cause_device_id;
  const events = inc.events ?? [];
  if (!root) return events.slice(0, 3).map(evidenceLine);

  const lines: string[] = [];
  const rootEvents = events.filter((e) => e.device_id === root);
  if (rootEvents[0]) lines.push(evidenceLine(rootEvents[0]));
  const rootStart = rootEvents.length ? Math.min(...rootEvents.map((e) => new Date(e.timestamp).getTime())) : null;

  // Downstream: everything reachable below the root in the topology.
  const edges = topology?.edges ?? [];
  const below = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.source_device_id === cur && !below.has(e.destination_device_id)) {
        below.add(e.destination_device_id);
        stack.push(e.destination_device_id);
      }
    }
  }
  const others = inc.affected_devices.filter((d) => d !== root);
  const downstream = others.filter((d) => below.has(d));
  if (downstream.length) {
    const firstAt = (id: string) =>
      Math.min(...events.filter((e) => e.device_id === id).map((e) => new Date(e.timestamp).getTime()), Infinity);
    const after = rootStart != null && downstream.every((d) => firstAt(d) >= rootStart);
    lines.push(
      `${downstream.length} device${downstream.length > 1 ? "s" : ""} behind it ${after ? "failed after it" : "also failed"}: ${downstream.join(", ")}`,
    );
  } else if (!others.length) {
    lines.push("No other device is affected, so the problem is contained to it");
  }

  // Upstream: is the device feeding it still healthy?
  const parents = edges.filter((e) => e.destination_device_id === root).map((e) => e.source_device_id);
  for (const p of parents.slice(0, 1)) {
    const status = topology?.nodes.find((n) => n.device_id === p)?.status;
    if (status === "online") lines.push(`Upstream ${p} stayed healthy, so the fault starts at ${root}`);
    else if (status) lines.push(`Upstream ${p} is ${status} too, worth checking next`);
  }
  return lines.slice(0, 3);
}

const CONF_TONE: Record<string, string> = {
  high: "text-emerald-300",
  medium: "text-amber-300",
  low: "text-stone-300",
};

const FACTORS = [
  { key: "coverage_pct", label: "Explains affected devices" },
  { key: "temporal_correlation_pct", label: "Failed first" },
  { key: "health_contrast_pct", label: "Upstream still healthy" },
  { key: "dependency_importance_pct", label: "Devices depend on it" },
] as const;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-ink-soft px-3.5 py-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums text-white", tone)}>{value}</div>
    </div>
  );
}

export function RootCauseCard({
  focus,
  activeCount,
  topology,
}: {
  focus: Incident | null;
  activeCount: number;
  topology: TopologyResponse | null;
}) {
  const active = focus && focus.status !== "resolved";

  if (!active) {
    return (
      <div className="flex h-full flex-col rounded-[26px] bg-ink p-6 text-white shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold tracking-tight">Root-Cause Insight</h3>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> All clear
          </span>
        </div>
        <div className="my-auto py-8">
          <div className="text-[11px] uppercase tracking-wide text-stone-400">Probable root cause</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-stone-200">None right now</div>
          <p className="mt-2 max-w-sm text-sm text-stone-400">
            No device is failing, so there is nothing to diagnose. As soon as a fault is confirmed, the most likely
            cause and the evidence for it will appear here.
          </p>
          {focus && (
            <p className="mt-4 rounded-2xl bg-ink-soft px-3.5 py-3 text-xs text-stone-300">
              Last incident: <span className="font-medium text-white">{focus.incident_id}</span>, {focus.title.toLowerCase()},
              recovered{focus.recovery_time_seconds != null ? ` in ${Math.round(focus.recovery_time_seconds)}s` : ""}.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/topology" className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-100">
            View Network Topology
          </Link>
          {focus && (
            <Link
              to={`/incidents/${focus.incident_id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink-line px-4 py-2 text-sm font-medium text-stone-200 hover:bg-ink-soft"
            >
              Open Last Incident <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    );
  }

  const root = focus.probable_root_cause_device_id;
  const top = focus.ranked_candidates.find((c) => c.device_id === root) ?? focus.ranked_candidates[0];
  const evidence = buildEvidence(focus, topology);

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[26px] bg-ink p-6 text-white shadow-card">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-red-500/20 blur-3xl"
        animate={{ opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight">Root-Cause Insight</h3>
        <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[11px] font-medium capitalize text-red-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          {focus.severity} · {focus.status}
          {activeCount > 1 && <span className="text-red-300/70"> · 1 of {activeCount}</span>}
        </span>
      </div>

      <div className="relative mt-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-400">
          <Crosshair className="h-3.5 w-3.5 text-brand-orange" /> Probable root cause
        </div>
        <div className="mt-1 text-[34px] font-semibold leading-none tracking-tight">{root ?? "Investigating…"}</div>
      </div>

      <div className="relative mt-4 grid grid-cols-3 gap-2">
        <Stat
          label="Confidence"
          value={`${focus.root_cause_confidence_label.charAt(0).toUpperCase()}${focus.root_cause_confidence_label.slice(1)}`}
          tone={CONF_TONE[focus.root_cause_confidence_label]}
        />
        <Stat label="Affected devices" value={String(focus.affected_devices.length)} />
        <Stat label="Detection time" value={timeOf(focus.detected_at)} />
      </div>

      {/* Evidence: what supports the diagnosis */}
      <div className="relative mt-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Supporting evidence</div>
        <ul className="mt-2 space-y-1.5">
          {evidence.map((line) => (
            <li key={line} className="flex gap-2 text-[13px] text-stone-200">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-orange" />
              {line}
            </li>
          ))}
        </ul>
        {top && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            {FACTORS.map((f) => (
              <div key={f.key}>
                <div className="flex justify-between text-[11px] text-stone-400">
                  <span>{f.label}</span>
                  <span className="tabular-nums text-stone-300">{Math.round(top[f.key])}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-line">
                  <motion.div
                    className="h-full rounded-full bg-brand-orange"
                    initial={{ width: 0 }}
                    animate={{ width: `${top[f.key]}%` }}
                    transition={{ type: "spring", stiffness: 90, damping: 20 }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative mt-auto flex flex-wrap gap-2 pt-5">
        <Link
          to={`/incidents/${focus.incident_id}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-orange px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange-dark"
        >
          Open Incident <ArrowUpRight className="h-4 w-4" />
        </Link>
        <Link
          to={`/incidents/${focus.incident_id}#root-cause`}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink-line px-4 py-2 text-sm font-medium text-stone-200 hover:bg-ink-soft"
        >
          Analyze Root Cause
        </Link>
        <Link to="/topology" className="ml-auto self-center text-xs font-medium text-stone-400 hover:text-white">
          Trace on topology →
        </Link>
      </div>
    </div>
  );
}
