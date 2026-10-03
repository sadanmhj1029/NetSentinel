import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { layoutTopology } from "../../lib/layout";
import type { TopologyResponse } from "../../types";

const FILL: Record<string, string> = { online: "#10b981", degraded: "#f59e0b", offline: "#ef4444", unknown: "#a8a29e" };
const LEGEND = [
  { key: "online", label: "Healthy" },
  { key: "degraded", label: "Warning" },
  { key: "offline", label: "Critical" },
  { key: "unknown", label: "Unknown" },
] as const;

const TYPE_GLYPH: Record<string, string> = { router: "R", switch: "S", server: "SV", pc: "PC", service: "SVC" };

export function TopologyPreview({ topology }: { topology: TopologyResponse | null }) {
  const navigate = useNavigate();
  const nodes = topology?.nodes ?? [];
  const edges = topology?.edges ?? [];

  const geo = useMemo(() => {
    const pos = layoutTopology(nodes, edges);
    const pts = Object.values(pos);
    if (!pts.length) return null;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const W = 400;
    const H = 210;
    const pad = 34;
    const sx = (x: number) => (maxX === minX ? W / 2 : pad + ((x - minX) / (maxX - minX)) * (W - pad * 2));
    const sy = (y: number) => (maxY === 0 ? H / 2 : 26 + (y / maxY) * (H - 62));
    const at = Object.fromEntries(Object.entries(pos).map(([id, p]) => [id, { x: sx(p.x), y: sy(p.y) }]));
    return { at, W, H };
  }, [nodes, edges]);

  const troubled = new Set(nodes.filter((n) => (n.active_incidents ?? []).length > 0).map((n) => n.device_id));
  const counts = { online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const n of nodes) counts[n.status]++;

  return (
    <div className="flex h-full flex-col rounded-[26px] bg-white p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">Network Topology Status</h3>
          <p className="mt-0.5 text-xs text-stone-500">Routers, switches, servers and endpoints. Click a device to open it.</p>
        </div>
        <Link to="/topology" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-stone-600 hover:text-stone-900">
          View Network Topology <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="relative mt-3 flex-1 rounded-2xl bg-[radial-gradient(#e2d9cb_1px,transparent_1px)] [background-size:16px_16px]">
        {!geo ? (
          <div className="flex h-full min-h-[210px] items-center justify-center text-sm text-stone-400">Loading topology…</div>
        ) : (
          <svg viewBox={`0 0 ${geo.W} ${geo.H}`} className="h-full max-h-[260px] w-full" role="img" aria-label="Network topology preview">
            {edges.map((e) => {
              const a = geo.at[e.source_device_id];
              const b = geo.at[e.destination_device_id];
              if (!a || !b) return null;
              // A link is "under fault" when the device it feeds is part of an active incident.
              const hot = troubled.has(e.destination_device_id);
              const midY = (a.y + b.y) / 2;
              const d = `M${a.x},${a.y} L${a.x},${midY} L${b.x},${midY} L${b.x},${b.y}`;
              return (
                <path
                  key={e.id}
                  d={d}
                  fill="none"
                  stroke={hot ? "#f59e0b" : "#d6cec0"}
                  strokeWidth={hot ? 2 : 1.4}
                  strokeLinejoin="round"
                  className={hot ? "topo-flow" : undefined}
                  strokeDasharray={hot ? "5 4" : undefined}
                />
              );
            })}
            {nodes.map((n) => {
              const p = geo.at[n.device_id];
              if (!p) return null;
              const root = (n.is_root_cause_of ?? []).length > 0;
              const affected = !root && (n.active_incidents ?? []).length > 0;
              return (
                <g
                  key={n.device_id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  onClick={() => navigate(`/devices/${n.device_id}`)}
                >
                  <title>{`${n.device_id} · ${n.status}${root ? " · probable root cause" : affected ? " · affected" : ""}`}</title>
                  {root && (
                    <motion.circle
                      r={20}
                      fill="none"
                      stroke="#ef4444"
                      strokeWidth={2}
                      animate={{ r: [16, 24, 16], opacity: [0.9, 0, 0.9] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                    />
                  )}
                  {affected && <circle r={17} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeOpacity={0.7} />}
                  <circle r={13} fill={FILL[n.status] ?? FILL.unknown} stroke="#fff" strokeWidth={2.5} />
                  <text textAnchor="middle" dy="0.35em" fontSize={n.device_type === "server" ? 7.5 : 8.5} fontWeight={700} fill="#fff">
                    {TYPE_GLYPH[n.device_type] ?? "•"}
                  </text>
                  <text textAnchor="middle" y={26} fontSize={9} fontWeight={500} fill={root ? "#b91c1c" : "#57534e"}>
                    {n.device_id}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
        {LEGEND.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL[l.key] }} />
            {l.label} <span className="font-semibold tabular-nums text-stone-900">{counts[l.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
