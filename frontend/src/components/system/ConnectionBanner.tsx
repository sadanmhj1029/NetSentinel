import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff } from "lucide-react";
import { useLive } from "../../store/LiveContext";

const SHOW_AFTER_MS = 4000; // brief blips (a page reload of the API) don't flash a banner

/**
 * Slim banner at the top of the app when the live connection is down or the
 * monitoring pipeline on the server is failing, so stale numbers are never
 * mistaken for live ones. Says "Back online" for a moment when it recovers.
 */
export function ConnectionBanner() {
  const { connected, disconnectedSince, nextRetryAt, retryNow, pipelineErrors } = useLive();
  const [now, setNow] = useState(Date.now());
  const [backOnline, setBackOnline] = useState(false);
  const wasShowing = useRef(false);

  useEffect(() => {
    if (connected && !pipelineErrors) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [connected, pipelineErrors]);

  const offline = !connected && disconnectedSince !== null && now - disconnectedSince >= SHOW_AFTER_MS;
  const failing = connected && pipelineErrors >= 2;

  useEffect(() => {
    if (offline || failing) {
      wasShowing.current = true;
      setBackOnline(false);
    } else if (wasShowing.current && connected) {
      wasShowing.current = false;
      setBackOnline(true);
      const t = setTimeout(() => setBackOnline(false), 3000);
      return () => clearTimeout(t);
    }
  }, [offline, failing, connected]);

  if (offline) {
    const secs = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : 0;
    const downFor = Math.round((now - (disconnectedSince ?? now)) / 1000);
    return (
      <div role="alert" className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-ink px-4 py-2.5 text-sm text-white shadow-xl">
        <WifiOff className="h-4 w-4 shrink-0 text-brand-orange" />
        <span className="font-medium">Lost connection to the NetSentinel server.</span>
        <span className="text-stone-300">
          Numbers on screen may be out of date ({downFor}s). {secs > 0 ? `Retrying in ${secs}s.` : "Retrying now…"}
        </span>
        <button
          onClick={retryNow}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry now
        </button>
      </div>
    );
  }

  if (failing) {
    return (
      <div role="alert" className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-3xl items-center gap-3 rounded-2xl bg-amber-100 px-4 py-2.5 text-sm text-amber-900 shadow-xl ring-1 ring-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">The monitoring pipeline is having trouble</span> ({pipelineErrors} failed checks in a row,
          usually the database restarting). It keeps retrying on its own.
        </span>
      </div>
    );
  }

  if (backOnline) {
    return (
      <div role="status" className="fixed inset-x-3 top-3 z-[60] mx-auto flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm text-emerald-800 shadow-lg ring-1 ring-emerald-200">
        <CheckCircle2 className="h-4 w-4" /> Back online. Live updates resumed.
      </div>
    );
  }
  return null;
}
