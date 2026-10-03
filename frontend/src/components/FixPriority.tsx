import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Cpu, Gauge, Network, Clock } from "lucide-react";
import { cn } from "../lib/utils";
import type { PriorityItem, PriorityLevel, PriorityResult } from "../types";

const LEVEL_STYLES: Record<PriorityLevel, string> = {
  critical: "bg-red-500/15 text-red-700 ring-red-500/30",
  high: "bg-orange-500/15 text-orange-700 ring-orange-500/30",
  medium: "bg-amber-500/15 text-amber-800 ring-amber-500/30",
  low: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
  follow_up: "bg-stone-500/10 text-stone-600 ring-stone-400/30",
};

const LEVEL_LABEL: Record<PriorityLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  follow_up: "Knock-on",
};

// One colour per part of the score, used in the bar and its legend.
const PARTS = [
  { key: "impact", label: "Impact", color: "bg-brand-orange" },
  { key: "workload", label: "Workload", color: "bg-amber-400" },
  { key: "severity", label: "Severity", color: "bg-red-400" },
  { key: "role", label: "Role", color: "bg-stone-400" },
] as const;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ScoreBar({ item }: { item: PriorityItem }) {
  return (
    <div className="w-full shrink-0 sm:w-40 sm:text-right">
      <div className="text-2xl font-semibold tabular-nums text-stone-900">
        {Math.round(item.priority_score)}
        <span className="text-xs font-normal text-stone-400">/100</span>
      </div>
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-stone-100">
        {PARTS.map((p) => (
          <motion.span
            key={p.key}
            className={p.color}
            initial={{ width: 0 }}
            animate={{ width: `${item.score_breakdown[p.key]}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
            title={`${p.label}: ${item.score_breakdown[p.key]}`}
          />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-stone-400">
        {PARTS.map((p) => `${p.label[0]} ${Math.round(item.score_breakdown[p.key])}`).join(" · ")}
      </div>
    </div>
  );
}

function PriorityRow({ item }: { item: PriorityItem }) {
  const first = item.is_first_priority;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "flex flex-wrap gap-4 rounded-2xl border p-4 sm:flex-nowrap",
        first ? "border-brand-orange/40 bg-brand-orange/[0.06]" : "border-stone-200 bg-stone-50",
      )}
    >
      <div className="flex w-14 shrink-0 flex-col items-center">
        <span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold",
            first ? "bg-brand-orange text-white shadow-[0_0_0_4px_rgb(217_119_87_/_0.15)]" : "bg-white text-stone-600 ring-1 ring-stone-200",
          )}
        >
          {item.rank}
        </span>
        {first && <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-brand-orange-ink">Fix first</span>}
      </div>

      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/devices/${item.device_id}`} className="text-sm font-semibold text-stone-900 hover:underline">
            {item.device_id}
          </Link>
          <span className="text-xs capitalize text-stone-400">{item.device_type}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", LEVEL_STYLES[item.level])}>
            {LEVEL_LABEL[item.level]}
          </span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-inset ring-stone-200">
            {item.problem.title}
          </span>
          {item.problem.also_seen.map((s) => (
            <span key={s} className="text-[11px] text-stone-400">
              + {s}
            </span>
          ))}
        </div>

        <p className="mt-1.5 text-sm text-stone-800">{item.problem.summary}</p>
        <p className="mt-0.5 text-sm text-stone-500">{item.impact.summary}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
          {item.workload.traffic_mbps != null && (
            <span className="flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" /> {Math.round(item.workload.traffic_mbps)} Mbps normal traffic
            </span>
          )}
          {item.workload.cpu_pct != null && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" /> CPU {Math.round(item.workload.cpu_pct)}%
            </span>
          )}
          <span className="flex items-center gap-1">
            <Network className="h-3.5 w-3.5" /> {item.impact.dependents_count} dependent
            {item.impact.dependents_count === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> since {timeOf(item.problem.since)}
          </span>
        </div>

        {item.recommended_checks.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.recommended_checks.slice(0, 3).map((c) => (
              <span key={c} className="rounded-md bg-white px-2 py-1 text-[11px] text-stone-600 ring-1 ring-inset ring-stone-200">
                {c}
              </span>
            ))}
            {item.incident_ids.map((id) => (
              <Link
                key={id}
                to={`/incidents/${id}`}
                className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] font-medium text-brand-orange-ink hover:bg-brand-orange/10"
              >
                {id} <ArrowUpRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <ScoreBar item={item} />
    </motion.li>
  );
}

export function FixPriority({ data }: { data: PriorityResult }) {
  const main = data.ranked.filter((r) => !r.caused_by);
  const knockOn = data.ranked.filter((r) => r.caused_by);
  const causes = [...new Set(knockOn.map((r) => r.caused_by!))];

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-[26px] bg-white p-6 shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Fix Priority</h3>
          <p className="text-xs text-stone-500">
            Faulty devices ranked by impact, workload, severity and role. Work from the top down.
          </p>
        </div>
        <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700">
          {data.faulty_count} faulty device{data.faulty_count === 1 ? "" : "s"}
        </span>
      </div>

      <p className="mt-3 text-sm font-medium text-stone-900">{data.headline}</p>
      {data.why_first && (
        <div className="mt-2 rounded-lg border border-brand-orange/25 bg-brand-orange/[0.07] px-3 py-2 text-sm text-stone-700">
          <span className="font-semibold text-brand-orange-ink">Why this order: </span>
          {data.why_first.replace(/^Fix \S+ before \S+: /, "")}
        </div>
      )}

      <ul className="mt-4 space-y-3">
        <AnimatePresence initial={false}>
          {main.map((item) => (
            <PriorityRow key={item.device_id} item={item} />
          ))}
        </AnimatePresence>
      </ul>

      {knockOn.length > 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-xs text-stone-500">
          <span className="font-medium text-stone-700">Knock-on effects, no separate fix needed: </span>
          {knockOn.map((r) => r.device_id).join(", ")}. These should recover once {causes.join(" and ")}{" "}
          {causes.length === 1 ? "is" : "are"} fixed.
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-stone-400">
        {PARTS.map((p) => (
          <span key={p.key} className="flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-full", p.color)} /> {p.label}
          </span>
        ))}
      </div>
    </motion.section>
  );
}
