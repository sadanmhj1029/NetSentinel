import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Check, Minus } from "lucide-react";
import { Switch } from "../Card";
import { cn } from "../../lib/utils";
import { describeLiveEvent, timeOf, TONE_DOT } from "../../lib/format";
import { useLive } from "../../store/LiveContext";
import { incidentStages } from "./lifecycle";
import type { Stage } from "./lifecycle";
import type { Incident } from "../../types";

const LIVE_FEED_PREF_KEY = "netsentinel:showLiveFeed";

const PLACEHOLDER: Stage[] = [
  "Detection",
  "Correlation",
  "Root-Cause Analysis",
  "Alert",
  "Acknowledgement",
  "Recovery",
].map((label, i) => ({ key: String(i), label, state: "pending", at: null, detail: "" }));

function StepDot({ s }: { s: Stage }) {
  if (s.state === "done")
    return (
      <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-brand-orange">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    );
  if (s.state === "current")
    return (
      <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-brand-orange text-white">
        <motion.span
          className="absolute inset-0 rounded-full bg-brand-orange"
          animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        />
        <span className="relative h-2 w-2 rounded-full bg-white" />
      </span>
    );
  if (s.state === "skipped")
    return (
      <span className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-stone-300 bg-white text-stone-400">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  return <span className="relative z-10 h-8 w-8 rounded-full border-2 border-stone-200 bg-white" />;
}

export function EventTimeline({ focus }: { focus: Incident | null }) {
  const { events } = useLive();
  const [streamOn, setStreamOn] = useState(() => {
    try {
      return localStorage.getItem(LIVE_FEED_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  function toggle(next: boolean) {
    setStreamOn(next);
    try {
      localStorage.setItem(LIVE_FEED_PREF_KEY, next ? "1" : "0");
    } catch {
      /* private mode: toggle still works this session */
    }
  }

  const stages = focus ? incidentStages(focus) : PLACEHOLDER;
  const current = stages.find((s) => s.state === "current");
  const doneCount = stages.filter((s) => s.state === "done" || s.state === "skipped").length;

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Live Event Timeline</h3>
          <p className="mt-0.5 text-xs text-stone-500">
            {focus ? (
              <>
                <Link to={`/incidents/${focus.incident_id}`} className="font-medium text-brand-orange-ink hover:underline">
                  {focus.incident_id}
                </Link>{" "}
                · {focus.status === "resolved" ? "last incident, fully recovered" : current ? `now at ${current.label.toLowerCase()}` : focus.status}
              </>
            ) : (
              "Waiting for the first incident"
            )}
          </p>
        </div>
        <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium tabular-nums text-stone-600">
          {doneCount}/{stages.length} stages
        </span>
      </div>

      {/* Pipeline stepper */}
      <ol className="relative mt-5 grid grid-cols-3 gap-y-5 sm:grid-cols-6">
        <span className="absolute left-[8%] right-[8%] top-4 hidden h-0.5 bg-stone-200 sm:block" />
        <motion.span
          className="absolute left-[8%] top-4 hidden h-0.5 bg-ink sm:block"
          initial={{ width: 0 }}
          animate={{ width: `${(Math.max(0, doneCount - 1) / (stages.length - 1)) * 84}%` }}
          transition={{ type: "spring", stiffness: 80, damping: 20 }}
        />
        {stages.map((s) => (
          <li key={s.label} className="relative flex flex-col items-center text-center" title={s.detail}>
            <StepDot s={s} />
            <span
              className={cn(
                "mt-2 text-[12px] font-medium leading-tight",
                s.state === "pending" ? "text-stone-400" : s.state === "current" ? "text-brand-orange-ink" : "text-stone-800",
              )}
            >
              {s.label}
            </span>
            <span className="mt-0.5 text-[10px] tabular-nums text-stone-400">
              {s.state === "skipped" ? "skipped" : s.at && s.state === "done" ? timeOf(s.at) : s.state === "current" ? "in progress" : "—"}
            </span>
          </li>
        ))}
      </ol>
      {focus && current && (
        <p className="mt-4 rounded-2xl bg-brand-orange/[0.07] px-3.5 py-2.5 text-xs text-stone-700">
          <span className="font-semibold text-brand-orange-ink">{current.label}: </span>
          {current.detail}
        </p>
      )}

      {/* Live stream: off by default, scrolls inside its own box */}
      <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-4">
        <span className="text-xs font-medium text-stone-700">Live event stream</span>
        <Switch checked={streamOn} onChange={toggle} label={streamOn ? "On" : "Off"} />
      </div>
      {!streamOn ? (
        <p className="mt-2 text-xs text-stone-400">
          Off so it doesn't move while you read. Turn it on to watch detections and recoveries as they happen.
        </p>
      ) : (
        <ul className="live-feed-scroll mt-2 h-44 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {events.length === 0 && <li className="py-6 text-center text-xs text-stone-400">Listening… nothing has changed yet.</li>}
          {events.map((e) => {
            const d = describeLiveEvent(e);
            return (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-xs hover:bg-stone-50"
              >
                <span className="w-14 shrink-0 tabular-nums text-stone-400">{timeOf(e.at)}</span>
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[d.tone])} />
                <span className="flex-1 text-stone-700">{d.text}</span>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
