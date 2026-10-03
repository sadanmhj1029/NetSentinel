import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { BrainCircuit, Loader2 } from "lucide-react";
import { MlApi } from "../../api/endpoints";
import { cn } from "../../lib/utils";
import { timeAgo } from "../../lib/format";
import { useAuth } from "../../store/AuthContext";
import type { MlStatus } from "../../types";
import type { DeviceTelemetry } from "./useDashboardData";

/** Semicircle gauge, 0-100, with the model's anomaly threshold (50) marked. */
function Gauge({ value }: { value: number | null }) {
  const r = 70;
  const c = Math.PI * r; // half circumference
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color = value == null ? "#d6d3d1" : v >= 50 ? "#ef4444" : v >= 35 ? "#f59e0b" : "#10b981";
  return (
    <svg viewBox="0 0 180 104" className="w-full max-w-[200px]">
      <path d="M20,92 A70,70 0 0 1 160,92" fill="none" stroke="#f0ece6" strokeWidth={14} strokeLinecap="round" />
      <motion.path
        d="M20,92 A70,70 0 0 1 160,92"
        fill="none"
        stroke={color}
        strokeWidth={14}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - v / 100) }}
        transition={{ type: "spring", stiffness: 60, damping: 18 }}
      />
      {/* threshold tick at 50 = straight up */}
      <line x1="90" y1="14" x2="90" y2="30" stroke="#57534e" strokeWidth={2} strokeLinecap="round" />
      <text x="90" y="9" textAnchor="middle" fontSize="8" fill="#a8a29e">threshold</text>
      <text x="90" y="80" textAnchor="middle" fontSize="28" fontWeight="600" fill="#1c1917" className="tabular-nums">
        {value == null ? "—" : Math.round(v)}
      </text>
      <text x="90" y="96" textAnchor="middle" fontSize="9" fill="#78716c">anomaly score</text>
    </svg>
  );
}

function Row({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-stone-500">{label}</span>
      <span className="text-right text-sm font-medium text-stone-900">
        {value}
        {sub && <span className="block text-[11px] font-normal text-stone-400">{sub}</span>}
      </span>
    </div>
  );
}

export function AnomalyCard({ ml, telemetry, onTrained }: { ml: MlStatus | null; telemetry: DeviceTelemetry[]; onTrained?: () => void }) {
  const { hasRole } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const scored = telemetry.filter((t) => t.ml.available && t.ml.anomaly_score != null);
  const worst = scored.sort((a, b) => (b.ml.anomaly_score ?? 0) - (a.ml.anomaly_score ?? 0))[0];
  const anomalous = telemetry.filter((t) => t.ml.is_anomalous);

  // Baseline deviation: how far each device's latest latency sits from its own learned median.
  const deviations = telemetry
    .map((t) => {
      const last = [...t.samples].reverse().find((s) => s.reachable && s.latency_ms != null);
      if (!last || !t.latencyBaseline?.median) return null;
      return { id: t.device.device_id, pct: ((last.latency_ms! - t.latencyBaseline.median) / t.latencyBaseline.median) * 100 };
    })
    .filter((x): x is { id: string; pct: number } => x !== null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const topDev = deviations[0];

  const trained = ml && ml.status !== "untrained" && ml.trained_at;
  const statusLabel = !ml ? "…" : !trained ? "Not trained" : ml.enabled ? `Active · v${ml.version}` : `Trained · disabled`;
  const statusTone = !trained ? "bg-stone-100 text-stone-600" : ml?.enabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800";

  async function train() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await MlApi.train();
      setMsg(`Trained v${r.version} on ${r.n_samples.toLocaleString()} samples`);
      onTrained?.();
    } catch {
      setMsg("Training failed. See AI / Anomaly Detection for details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-stone-900">
            <BrainCircuit className="h-4 w-4 text-brand-orange" /> AI Anomaly Detection
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">Isolation Forest + per-device adaptive baselines</p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium", statusTone)}>{statusLabel}</span>
      </div>

      <div className="mt-2 flex flex-col items-center">
        <Gauge value={worst ? worst.ml.anomaly_score : null} />
        <p className="-mt-1 text-center text-xs text-stone-500">
          {worst
            ? `Highest: ${worst.device.device_id}${worst.ml.is_anomalous ? " (anomalous)" : ""}`
            : trained
              ? "Scoring starts on the next poll"
              : "Train the model to start scoring. Baseline checks already run."}
        </p>
      </div>

      <div className="mt-3 divide-y divide-stone-100">
        <Row
          label="Detected anomalies"
          value={trained ? <span className={anomalous.length ? "text-red-600" : ""}>{anomalous.length}</span> : "—"}
          sub={anomalous.length ? anomalous.map((a) => a.device.device_id).join(", ") : undefined}
        />
        <Row
          label="Baseline deviation"
          value={
            topDev ? (
              <span className={Math.abs(topDev.pct) > 100 ? "text-red-600" : Math.abs(topDev.pct) > 40 ? "text-amber-700" : ""}>
                {topDev.pct > 0 ? "+" : ""}
                {topDev.pct.toFixed(0)}%
              </span>
            ) : (
              "—"
            )
          }
          sub={topDev ? `${topDev.id} latency vs its normal` : undefined}
        />
        <Row label="Last model training" value={ml?.trained_at ? timeAgo(ml.trained_at) : "Never"} sub={ml?.n_samples ? `${ml.n_samples.toLocaleString()} samples` : undefined} />
      </div>

      <div className="mt-auto pt-4">
        {hasRole("admin") ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={train}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? "Training…" : trained ? "Retrain Anomaly Model" : "Train Anomaly Model"}
            </button>
            <Link to="/ml" className="text-xs font-medium text-stone-500 hover:text-stone-900">
              View Model Details →
            </Link>
          </div>
        ) : (
          <p className="text-xs text-stone-400">Model training is available to admins.</p>
        )}
        {msg && <p className="mt-2 text-xs text-stone-600">{msg}</p>}
      </div>
    </div>
  );
}
