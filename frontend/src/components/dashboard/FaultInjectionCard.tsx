import { useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Gauge, Loader2, Lock, RotateCcw, Unplug, Waves, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ScenariosApi } from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { cn } from "../../lib/utils";
import { useAuth } from "../../store/AuthContext";
import type { SimulatorState } from "../../types";

const ACTIONS: { id: string; label: string; target: string; icon: LucideIcon }[] = [
  { id: "switch_failure", label: "Inject Switch Failure", target: "Switch-02", icon: Unplug },
  { id: "high_latency", label: "Simulate High Latency", target: "Server-01", icon: Gauge },
  { id: "packet_loss_burst", label: "Simulate Packet Loss", target: "PC-03", icon: Waves },
  { id: "bandwidth_saturation", label: "Simulate Bandwidth Saturation", target: "Switch-02", icon: Activity },
];

const NAMES: Record<string, string> = {
  switch_failure: "Switch failure",
  high_latency: "High latency",
  packet_loss_burst: "Packet loss",
  bandwidth_saturation: "Bandwidth saturation",
};

export function FaultInjectionCard({ sim, onChange }: { sim: SimulatorState | null; onChange?: () => void }) {
  const { hasRole } = useAuth();
  const canRun = hasRole("operator");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const running = sim?.active_faults ?? [];

  async function run(key: string, fn: () => Promise<unknown>, success: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: success, ok: true });
      onChange?.();
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : "That didn't work. Try again.", ok: false });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-beige p-6 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Fault Injection</h3>
          <p className="mt-0.5 text-xs text-stone-600">Break something on purpose and watch the pipeline respond</p>
        </div>
        {!canRun && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[11px] font-medium text-stone-600">
            <Lock className="h-3 w-3" /> Operator only
          </span>
        )}
      </div>

      {running.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {running.map((f) => (
            <li key={f.target} className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              <span className="flex-1 text-stone-700">
                <span className="font-medium text-stone-900">{NAMES[f.scenario] ?? f.scenario}</span> on {f.target}
              </span>
              {canRun && (
                <button
                  onClick={() => run(`stop-${f.target}`, () => ScenariosApi.stop(f.scenario, f.target), `Stopped ${NAMES[f.scenario] ?? f.scenario} on ${f.target}`)}
                  aria-label={`Stop ${f.scenario} on ${f.target}`}
                  className="rounded-full p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const isRunning = running.some((f) => f.scenario === a.id && f.target === a.target);
          return (
            <button
              key={a.id}
              disabled={!canRun || busy !== null || isRunning}
              onClick={() => run(a.id, () => ScenariosApi.start(a.id, a.target), `${NAMES[a.id]} started on ${a.target}`)}
              className={cn(
                "flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-left text-[13px] font-medium text-stone-800 transition-colors",
                "hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-brand-orange">
                {busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="leading-tight">
                {a.label}
                <span className="block text-[10px] font-normal text-stone-400">{isRunning ? "running" : `on ${a.target}`}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          disabled={!canRun || busy !== null || (running.length === 0 && !sim?.collector_failure)}
          onClick={() => run("normal", () => ScenariosApi.start("normal"), "Network restored. Incidents will close once recovery is verified.")}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "normal" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Restore Network
        </button>
        {canRun && (
          <Link to="/scenarios" className="text-xs font-medium text-stone-600 hover:text-stone-900">
            Choose a different target →
          </Link>
        )}
      </div>
      {msg && <p className={cn("mt-2 text-xs", msg.ok ? "text-stone-700" : "text-red-700")}>{msg.text}</p>}
    </div>
  );
}
