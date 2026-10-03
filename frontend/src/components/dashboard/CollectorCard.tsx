import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Activity } from "lucide-react";
import { cn } from "../../lib/utils";
import { timeOf } from "../../lib/format";
import type { CollectorHealth } from "../../types";

const STALE_AFTER_S = 10; // poll interval is 2s; >10s without a good poll = stale

function Ring({ pct, healthy }: { pct: number; healthy: boolean }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const color = !healthy ? "#ef4444" : pct >= 99 ? "#10b981" : pct >= 95 ? "#f59e0b" : "#ef4444";
  return (
    <svg viewBox="0 0 112 112" className="h-[112px] w-[112px] shrink-0 -rotate-90">
      <circle cx="56" cy="56" r={r} fill="none" stroke="#f4e0d6" strokeWidth={9} />
      {/* tick marks like the reference's dial */}
      {Array.from({ length: 40 }).map((_, i) => (
        <line
          key={i}
          x1="56"
          y1="4"
          x2="56"
          y2="8"
          stroke="#f0d1c4"
          strokeWidth={1}
          transform={`rotate(${i * 9} 56 56)`}
        />
      ))}
      <motion.circle
        cx="56"
        cy="56"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - pct / 100) }}
        transition={{ type: "spring", stiffness: 60, damping: 18 }}
      />
    </svg>
  );
}

export function CollectorCard({ health }: { health: CollectorHealth | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pct = health?.polling_success_rate_pct ?? 0;
  const healthy = health?.is_healthy ?? false;
  const ageS = health?.last_successful_tick_at
    ? Math.max(0, (now - new Date(health.last_successful_tick_at).getTime()) / 1000)
    : null;
  const fresh = ageS != null && ageS <= STALE_AFTER_S;
  const freshPct = ageS == null ? 0 : Math.max(0, 100 - (ageS / STALE_AFTER_S) * 100);

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-stone-900">
            <Activity className="h-4 w-4 text-brand-orange" /> Collector Health
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">Is the monitoring itself working?</p>
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
            !health ? "bg-stone-100 text-stone-500" : healthy ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", healthy ? "bg-emerald-500" : "animate-pulse bg-red-500")} />
          {!health ? "Checking" : healthy ? "Polling" : "Interrupted"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <div className="relative">
          <Ring pct={pct} healthy={healthy} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] text-stone-400">success</span>
            <span className="text-xl font-semibold tabular-nums text-stone-900">{health ? `${pct.toFixed(pct >= 99.95 ? 0 : 1)}%` : "—"}</span>
          </div>
        </div>
        <dl className="flex-1 space-y-2 text-sm">
          <div>
            <dt className="text-[11px] text-stone-500">Last successful poll</dt>
            <dd className="font-medium tabular-nums text-stone-900">{timeOf(health?.last_successful_tick_at)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-stone-500">Polls this session</dt>
            <dd className="font-medium tabular-nums text-stone-900">
              {health?.total_ticks.toLocaleString() ?? "—"}
              {health && health.consecutive_collector_failures > 0 && (
                <span className="ml-1 text-xs font-normal text-red-600">({health.consecutive_collector_failures} failing)</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-auto pt-5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-stone-700">Data freshness</span>
          <span className={cn("font-semibold tabular-nums", fresh ? "text-emerald-700" : "text-red-600")}>
            {ageS == null ? "—" : ageS < 1 ? "just now" : `${ageS.toFixed(0)}s old`}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1">
          {Array.from({ length: 20 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-2 flex-1 rounded-full transition-colors",
                i < Math.round(freshPct / 5) ? (fresh ? "bg-ink" : "bg-red-400") : "bg-stone-200",
              )}
            />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-stone-400">
          <span>{health?.stale_devices.length ? `${health.stale_devices.length} stale device(s)` : "No stale devices"}</span>
          <span>stale after {STALE_AFTER_S}s</span>
        </div>
      </div>
    </div>
  );
}
