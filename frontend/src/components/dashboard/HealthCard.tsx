import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { CollectorHealth, Device } from "../../types";
import { LiquidGlass } from "../LiquidGlass";

const STATES = [
  { key: "online", label: "Online", color: "#10b981", bar: "bg-emerald-500", cx: 63, cy: 50, delay: 0 },
  { key: "degraded", label: "Degraded", color: "#f59e0b", bar: "bg-amber-500", cx: 34, cy: 70, delay: 0.6 },
  { key: "offline", label: "Offline", color: "#ef4444", bar: "bg-red-500", cx: 86, cy: 24, delay: 1.2 },
  { key: "stale", label: "Stale / unknown", color: "#a8a29e", bar: "bg-stone-400", cx: 88, cy: 80, delay: 1.8 },
] as const;

type Key = (typeof STATES)[number]["key"];

export function healthScore(counts: Record<Key, number>, total: number): number | null {
  if (!total) return null;
  return Math.round((100 * (counts.online + 0.5 * counts.degraded + 0.25 * counts.stale)) / total);
}

export function HealthCard({ devices, collector }: { devices: Device[] | null; collector: CollectorHealth | null }) {
  const list = devices ?? [];
  const staleIds = new Set(collector?.stale_devices ?? []);
  const counts: Record<Key, number> = { online: 0, degraded: 0, offline: 0, stale: 0 };
  for (const d of list) {
    if (d.status === "unknown" || staleIds.has(d.device_id)) counts.stale++;
    else counts[d.status as "online" | "degraded" | "offline"]++;
  }
  const total = list.length;
  const score = collector && !collector.is_healthy ? null : healthScore(counts, total);
  const bubbles = STATES.filter((st) => counts[st.key] > 0).map((st) => {
    const n = counts[st.key];
    const r = 8 + 20 * Math.sqrt(n / Math.max(total, 1)); // radius, % of box width
    const rH = r * (4 / 3); // same radius as % of box height (box is 4:3)
    // Keep every bubble fully inside the card whatever its size.
    const cx = Math.min(Math.max(st.cx, r + 1), 99 - r);
    const cy = Math.min(Math.max(st.cy, rH + 1), 99 - rH);
    return { key: st.key, n, r, rH, cx, cy, color: st.color, delay: st.delay, label: st.label.split(" ")[0] };
  });
  // Colour carries status in a dot next to the number; the number itself stays dark so it's always readable.
  const scoreDot = score == null ? "bg-stone-400" : score >= 90 ? "bg-emerald-500" : score >= 70 ? "bg-amber-500" : "bg-red-500";
  const bubbleKey = bubbles.map((b) => `${b.key}${b.n}`).join(",");

  return (
    <div className="relative h-full overflow-hidden rounded-[26px] bg-beige p-6 shadow-card">
      <div className="flex h-full flex-col gap-6 md:flex-row">
        <div className="flex min-w-[180px] flex-col">
          <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-stone-900">
            Network Health
            <br />
            <span className="font-normal text-stone-600">{total ? `${total} monitored devices` : "Loading…"}</span>
          </h3>

          <ul className="mt-auto space-y-2.5 pt-6">
            {STATES.map((s) => (
              <li key={s.key} className="flex items-center gap-3 text-sm">
                <span className={`h-2.5 w-8 rounded-full ${s.bar}`} />
                <span className="flex-1 text-stone-700">{s.label}</span>
                <span className="font-semibold tabular-nums text-stone-900">{counts[s.key]}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/devices"
            className="mt-5 inline-flex w-fit items-center gap-1 rounded-full bg-white/70 px-3.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-white"
          >
            View Device Metrics <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Bubble view: each state is a soft circle sized by how many devices are in it. */}
        <div className="relative mx-auto aspect-[4/3] w-full max-w-[440px] flex-1">
          {bubbles.map((b) => (
            <motion.div
              key={b.key}
              aria-hidden
              className="absolute rounded-full"
              style={{
                width: `${b.r * 2}%`,
                aspectRatio: "1",
                left: `${b.cx - b.r}%`,
                top: `${b.cy - b.rH}%`,
                background: `radial-gradient(circle at 50% 50%, ${b.color} 0%, ${b.color}e6 55%, ${b.color}55 63%, ${b.color}00 72%)`,
              }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: [1, 1.04, 1], opacity: 1 }}
              transition={{
                scale: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: b.delay },
                opacity: { duration: 0.5 },
              }}
            />
          ))}
          {/* Labels sit in their own layer so an overlapping bubble never hides a number. */}
          {bubbles.map((b) => (
            <div
              key={`${b.key}-label`}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
              style={{ left: `${b.cx}%`, top: `${b.cy}%` }}
            >
              <span className="text-lg font-semibold leading-none text-white drop-shadow md:text-xl">{b.n}</span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-white drop-shadow-sm">{b.label}</span>
            </div>
          ))}

          {/* Health score on a Liquid Glass lens: the coloured bubbles refract through it. */}
          <div className="absolute left-[27%] top-[12%] z-20 w-[30%]">
            <LiquidGlass
              type="circle"
              tint={0.1}
              minScrim={0.2}
              textColor="#44403c"
              refreshKey={bubbleKey}
              className="flex aspect-square w-full flex-col items-center justify-center text-center"
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${scoreDot}`} />
                <span className="text-2xl font-semibold leading-none tabular-nums text-ink md:text-[30px]">{score ?? "—"}</span>
              </span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-stone-700">
                {score == null && collector && !collector.is_healthy ? "data stale" : "health score"}
              </span>
            </LiquidGlass>
          </div>
        </div>
      </div>
    </div>
  );
}
