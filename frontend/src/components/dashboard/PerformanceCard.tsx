import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowUpRight, CheckCircle2, OctagonAlert } from "lucide-react";
import { cn } from "../../lib/utils";
import { timeOf } from "../../lib/format";
import type { PerfPoint } from "./useDashboardData";

type MetricKey = "latency" | "loss" | "bandwidth" | "cpu" | "memory";

interface MetricDef {
  key: MetricKey;
  label: string;
  unit: string;
  digits: number;
  warn?: number; // amber from here
  alert?: number; // the rule engine's default alert threshold
  note: string;
}

// Thresholds mirror the backend defaults (app/config.py): latency 150 ms, loss 10%, CPU/memory 90%.
const METRICS: MetricDef[] = [
  { key: "latency", label: "Latency", unit: "ms", digits: 0, warn: 100, alert: 150, note: "Average round-trip of reachable devices" },
  { key: "loss", label: "Packet loss", unit: "%", digits: 1, warn: 3, alert: 10, note: "Average across all devices; unreachable counts as 100%" },
  { key: "bandwidth", label: "Bandwidth", unit: "Mbps", digits: 0, note: "Total traffic in + out across the network" },
  { key: "cpu", label: "CPU usage", unit: "%", digits: 0, warn: 75, alert: 90, note: "Average CPU of reachable devices" },
  { key: "memory", label: "Memory usage", unit: "%", digits: 0, warn: 75, alert: 90, note: "Average memory of reachable devices" },
];

type State = "good" | "warn" | "bad" | "none";

function stateOf(m: MetricDef, v: number | null): State {
  if (v == null || m.alert == null || m.warn == null) return "none";
  if (v >= m.alert) return "bad";
  if (v >= m.warn) return "warn";
  return "good";
}

const STATE_UI: Record<State, { label: string; icon: typeof CheckCircle2 | null; cls: string }> = {
  good: { label: "Normal", icon: CheckCircle2, cls: "text-emerald-600" },
  warn: { label: "Elevated", icon: AlertTriangle, cls: "text-amber-700" },
  bad: { label: "Over limit", icon: OctagonAlert, cls: "text-red-600" },
  none: { label: "", icon: null, cls: "text-stone-400" },
};

function fmt(v: number | null, m: MetricDef) {
  return v == null ? "—" : v.toFixed(m.digits);
}

export function PerformanceCard({ perf }: { perf: PerfPoint[] }) {
  const [sel, setSel] = useState<MetricKey>("latency");
  const m = METRICS.find((x) => x.key === sel)!;
  const latest = perf[perf.length - 1];
  const down = latest?.down ?? 0;

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Network Performance</h3>
          <p className="mt-0.5 text-xs text-stone-500">Live telemetry across every monitored device, last few minutes</p>
        </div>
        <Link to="/devices" className="inline-flex items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900">
          View Device Metrics <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Metric switcher: each pill shows its current value and state */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5" role="tablist" aria-label="Metric">
        {METRICS.map((x) => {
          const v = latest ? latest[x.key] : null;
          const st = STATE_UI[stateOf(x, v)];
          const Icon = st.icon;
          const on = x.key === sel;
          return (
            <button
              key={x.key}
              role="tab"
              aria-selected={on}
              onClick={() => setSel(x.key)}
              className={cn(
                "rounded-2xl px-3 py-2.5 text-left transition-colors",
                on ? "bg-ink text-white" : "bg-stone-100/70 text-stone-900 hover:bg-stone-100",
              )}
            >
              <div className={cn("text-[11px] font-medium", on ? "text-stone-400" : "text-stone-500")}>{x.label}</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums leading-tight">
                {fmt(v, x)}
                <span className={cn("ml-0.5 text-[11px] font-normal", on ? "text-stone-400" : "text-stone-400")}>{x.unit}</span>
              </div>
              {Icon && (
                <div className={cn("mt-0.5 flex items-center gap-1 text-[10px] font-medium", on ? "text-stone-300" : st.cls)}>
                  <Icon className="h-3 w-3" /> {st.label}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-[190px] flex-1">
        {perf.length < 2 ? (
          <div className="flex h-full items-center justify-center rounded-2xl bg-stone-50 text-sm text-stone-400">
            Collecting telemetry…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={perf} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d97757" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#d97757" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f3e6dc" />
              <XAxis
                dataKey="t"
                tickFormatter={(t: string) => timeOf(t).slice(0, 5)}
                tick={{ fontSize: 10, fill: "#a8a29e" }}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis tick={{ fontSize: 10, fill: "#a8a29e" }} axisLine={false} tickLine={false} width={44} />
              {m.alert != null && (
                <ReferenceLine
                  y={m.alert}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                  label={{ value: `Alert at ${m.alert} ${m.unit}`, position: "insideTopRight", fontSize: 10, fill: "#78716c" }}
                />
              )}
              <Tooltip
                cursor={{ stroke: "#a8a29e", strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as PerfPoint;
                  return (
                    <div className="rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg">
                      <div className="text-stone-400">{timeOf(p.t)}</div>
                      <div className="mt-0.5 font-semibold tabular-nums">
                        {m.label}: {fmt(p[sel], m)} {m.unit}
                      </div>
                      {p.down > 0 && <div className="mt-0.5 text-red-300">{p.down} device(s) unreachable</div>}
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey={sel}
                stroke="#d97757"
                strokeWidth={2}
                fill="url(#perfFill)"
                connectNulls
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2, fill: "#d97757" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-1 text-[11px] text-stone-400">
        {m.note}
        {down > 0 && <span className="text-red-600"> · {down} device(s) unreachable right now</span>}
      </p>
    </div>
  );
}
