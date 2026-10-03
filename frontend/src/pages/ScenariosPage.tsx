import { useEffect, useState } from "react";
import { Card, Button } from "../components/Card";
import { DevicesApi, ScenariosApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import { ApiError } from "../api/client";
import type { Device, Scenario, SimulatorState } from "../types";

export function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [state, setState] = useState<SimulatorState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { tickVersion } = useLive();

  async function refresh() {
    const [s, d] = await Promise.all([ScenariosApi.list(), DevicesApi.list()]);
    setScenarios(s.scenarios);
    setState(s.state);
    setDevices(d);
  }

  useEffect(() => {
    refresh();
  }, [tickVersion]);

  async function handleStart(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await ScenariosApi.start(id, target || undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start scenario");
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(id: string, stopTarget?: string) {
    setError(null);
    setBusyId(id);
    try {
      await ScenariosApi.stop(id, stopTarget);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not stop scenario");
    } finally {
      setBusyId(null);
    }
  }

  const activeFaults = state?.active_faults ?? [];
  const collectorFailing = state?.collector_failure;
  const SCENARIO_NAMES: Record<string, string> = Object.fromEntries(scenarios.map((s) => [s.id, s.description]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Fault Injection Lab</h1>
        <p className="text-sm text-stone-500">
          Trigger a controlled scenario and watch detection, correlation and recovery run end to end. You can run
          several faults at once on different devices to see how the Fix priority ranking compares them.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card title={`Current state${activeFaults.length > 1 ? ` · ${activeFaults.length} faults running` : ""}`}>
        {collectorFailing && (
          <p className="mb-2 text-sm text-amber-700">Collector failure is active. All devices will report stale.</p>
        )}
        {activeFaults.length > 0 ? (
          <ul className="space-y-2">
            {activeFaults.map((f) => (
              <li
                key={f.target}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
              >
                <span className="text-stone-700">
                  <span className="font-medium text-amber-700">{SCENARIO_NAMES[f.scenario] ?? f.scenario}</span> on{" "}
                  <span className="font-medium text-stone-900">{f.target}</span> since{" "}
                  {new Date(f.started_at).toLocaleTimeString()}
                  {f.affected_devices.length > 1 && (
                    <span className="text-stone-500"> · affects {f.affected_devices.join(", ")}</span>
                  )}
                </span>
                <Button variant="secondary" onClick={() => handleStop(f.scenario, f.target)} disabled={busyId === f.scenario}>
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          !collectorFailing && <p className="text-sm text-emerald-600">Network is in its normal state. No active fault.</p>
        )}
      </Card>

      <Card title="Target device (optional override)">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
        >
          <option value="">Default per scenario</option>
          {devices.map((d) => (
            <option key={d.device_id} value={d.device_id}>
              {d.device_id}
            </option>
          ))}
        </select>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {scenarios.map((s) => {
          const runningOn = activeFaults.filter((f) => f.scenario === s.id).map((f) => f.target);
          const isRunning = runningOn.length > 0 || (s.id === "collector_failure" && collectorFailing);
          const isControl = s.id === "normal" || s.id === "recovery";
          return (
            <Card key={s.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-stone-900">{s.description}</div>
                  <div className="mt-1 text-xs text-stone-500">id: {s.id}</div>
                </div>
                {isRunning && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
                    running{runningOn.length ? ` on ${runningOn.join(", ")}` : ""}
                  </span>
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <Button onClick={() => handleStart(s.id)} disabled={busyId === s.id} variant={isControl ? "secondary" : "primary"}>
                  {isControl ? "Apply" : "Start"}
                </Button>
                {!isControl && (
                  <Button onClick={() => handleStop(s.id)} disabled={busyId === s.id} variant="secondary">
                    Stop
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
