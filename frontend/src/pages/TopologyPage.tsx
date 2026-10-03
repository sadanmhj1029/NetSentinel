import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, BackgroundVariant, Controls, Handle, Position } from "reactflow";
import type { Edge, Node, NodeProps, ReactFlowInstance } from "reactflow";
import "reactflow/dist/style.css";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Monitor, Network, Router, Server, Boxes, X, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PriorityApi, TopologyApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import { layoutTopology } from "../lib/layout";
import { cn } from "../lib/utils";
import { StatusBadge } from "../components/Badges";
import { Tilt } from "../components/motion-primitives/tilt";
import { GlowEffect } from "../components/motion-primitives/glow-effect";
import { BorderTrail } from "../components/motion-primitives/border-trail";
import { TextShimmer } from "../components/motion-primitives/text-shimmer";
import type { Device, PriorityItem, TopologyLink } from "../types";

const TYPE_ICONS: Record<string, LucideIcon> = {
  router: Router,
  switch: Network,
  server: Server,
  pc: Monitor,
};

const STATUS_TILE: Record<string, string> = {
  online: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  degraded: "bg-amber-50 text-amber-700 ring-amber-200",
  offline: "bg-red-50 text-red-600 ring-red-200",
  unknown: "bg-stone-100 text-stone-500 ring-stone-200",
};

type NodeData = Device & {
  selected: boolean;
  onSelect: () => void;
  enterDelay: number;
  priority: PriorityItem | null;
};

/** "#1 Fix first" style tag pinned to a faulty node's corner. Knock-on devices get none. */
function PriorityTag({ item }: { item: PriorityItem | null }) {
  if (!item || item.caused_by) return null;
  const first = item.is_first_priority;
  return (
    <motion.span
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={cn(
        "absolute -right-2 -top-2.5 z-20 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-sm",
        first ? "bg-brand-orange text-white" : "bg-white text-stone-700 ring-1 ring-stone-300",
      )}
    >
      #{item.rank}
      {first ? " Fix first" : ""}
    </motion.span>
  );
}

function DeviceNode({ data }: NodeProps<NodeData>) {
  const isRootCause = (data.is_root_cause_of ?? []).length > 0;
  const hasIncident = (data.active_incidents ?? []).length > 0;
  const Icon = TYPE_ICONS[data.device_type] ?? Boxes;

  return (
    <div className="relative" style={{ width: 200 }}>
      <Handle type="target" position={Position.Top} className="!border-0 !bg-transparent" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.94, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ delay: data.enterDelay, type: "spring", stiffness: 260, damping: 24 }}
      >
        <Tilt rotationFactor={7} springOptions={{ stiffness: 260, damping: 20 }} className="relative">
          <PriorityTag item={data.priority} />
          {isRootCause && <GlowEffect colors={["#ef4444", "#f97316"]} mode="pulse" />}
          {!isRootCause && hasIncident && <GlowEffect colors={["#f59e0b"]} mode="breathe" />}
          <button
            type="button"
            onClick={data.onSelect}
            className={cn(
              "relative flex w-full cursor-pointer items-center gap-3 rounded-2xl border bg-white/95 p-3 text-left shadow-sm shadow-stone-900/5 backdrop-blur transition-shadow hover:shadow-md",
              isRootCause ? "border-red-300" : hasIncident ? "border-amber-300" : "border-stone-200",
              data.selected && "ring-2 ring-brand-orange ring-offset-2 ring-offset-cream",
            )}
          >
            {isRootCause && <BorderTrail className="bg-red-500" size={36} duration={3} />}
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                STATUS_TILE[data.status] ?? STATUS_TILE.unknown,
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-stone-900">{data.device_id}</span>
              <span className="block truncate text-[11px] text-stone-500">{data.ip_address}</span>
              {isRootCause ? (
                <span className="mt-0.5 block text-[11px] font-medium text-red-600">Probable root cause</span>
              ) : hasIncident ? (
                <span className="mt-0.5 block text-[11px] font-medium text-amber-700">Affected</span>
              ) : (
                <span className="mt-0.5 block text-[11px] capitalize text-stone-400">{data.device_type}</span>
              )}
            </span>
          </button>
        </Tilt>
      </motion.div>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { device: DeviceNode };

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs shadow-sm shadow-stone-900/5">
      <span className={cn("h-2 w-2 rounded-full", tone)} />
      <span className="text-stone-500">{label}</span>
      <motion.span
        key={value}
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="font-semibold tabular-nums text-stone-900"
      >
        {value}
      </motion.span>
    </div>
  );
}

function Inspector({
  device,
  priority,
  onClose,
}: {
  device: Device;
  priority: PriorityItem | null;
  onClose: () => void;
}) {
  const Icon = TYPE_ICONS[device.device_type] ?? Boxes;
  const rootOf = device.is_root_cause_of ?? [];
  const incidents = device.active_incidents ?? [];
  const rows: [string, string][] = [
    ["Hostname", device.hostname],
    ["IP address", device.ip_address],
    ["Type", device.device_type],
    ["Vendor", device.vendor],
    ["Site", `${device.site} / ${device.department}`],
    ["Last seen", device.last_seen_at ? new Date(device.last_seen_at).toLocaleTimeString() : "never"],
  ];

  return (
    <motion.aside
      key={device.device_id}
      initial={{ opacity: 0, x: 24, filter: "blur(4px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, x: 24, filter: "blur(4px)" }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="flex w-80 shrink-0 flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm shadow-stone-900/5"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset",
              STATUS_TILE[device.status] ?? STATUS_TILE.unknown,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <div className="text-base font-semibold text-stone-900">{device.device_id}</div>
            <StatusBadge status={device.status} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          aria-label="Close inspector"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {rootOf.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Diagnosed as the probable root cause of {rootOf.join(", ")}.
        </div>
      )}
      {rootOf.length === 0 && incidents.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Affected by {incidents.join(", ")}.
        </div>
      )}

      {priority && (
        <div
          className={cn(
            "mt-3 rounded-xl border px-3 py-2.5",
            priority.is_first_priority ? "border-brand-orange/40 bg-brand-orange/[0.06]" : "border-stone-200 bg-stone-50",
          )}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-stone-800">
              {priority.caused_by ? "Knock-on effect" : `Fix priority #${priority.rank}`}
              {priority.is_first_priority && <span className="text-brand-orange-ink"> · fix first</span>}
            </span>
            {!priority.caused_by && (
              <span className="tabular-nums text-stone-500">{Math.round(priority.priority_score)}/100</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-stone-700">{priority.problem.summary}</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-500">{priority.impact.summary}</p>
        </div>
      )}

      <dl className="mt-4 divide-y divide-stone-100 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2">
            <dt className="text-stone-500">{k}</dt>
            <dd className="truncate text-right capitalize text-stone-800">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        {incidents.map((id) => (
          <Link
            key={id}
            to={`/incidents/${id}`}
            className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50"
          >
            Open {id} <ArrowUpRight className="h-4 w-4" />
          </Link>
        ))}
        <Link
          to={`/devices/${device.device_id}`}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-orange px-3 py-2 text-sm font-medium text-white hover:bg-brand-orange-dark"
        >
          Device details <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </motion.aside>
  );
}

export function TopologyPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [edges, setEdges] = useState<TopologyLink[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [priorityById, setPriorityById] = useState<Record<string, PriorityItem>>({});
  const { tickVersion, connected } = useLive();
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Re-fit whenever the canvas actually changes size (inspector sliding in/out, window resize),
  // debounced so it runs once the size has settled rather than on every animation frame.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => flowRef.current?.fitView({ padding: 0.12, duration: 350 }), 120);
    });
    ro.observe(el);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    TopologyApi.get().then((topo) => {
      setDevices(topo.nodes);
      setEdges(topo.edges);
    });
    PriorityApi.get()
      .then((p) => setPriorityById(Object.fromEntries(p.ranked.map((r) => [r.device_id, r]))))
      .catch(() => setPriorityById({}));
  }, [tickVersion]);

  const { flowNodes, flowEdges } = useMemo(() => {
    const positions = layoutTopology(devices, edges);
    const flowNodes: Node<NodeData>[] = devices.map((d, i) => ({
      id: d.device_id,
      type: "device",
      position: positions[d.device_id] ?? { x: 0, y: 0 },
      data: {
        ...d,
        selected: d.device_id === selectedId,
        onSelect: () => setSelectedId((cur) => (cur === d.device_id ? null : d.device_id)),
        enterDelay: (positions[d.device_id]?.y ?? 0) / 170 * 0.12 + i * 0.03,
        priority: priorityById[d.device_id] ?? null,
      },
    }));
    const troubled = (id: string) => {
      const d = devices.find((x) => x.device_id === id);
      return (d?.active_incidents?.length ?? 0) > 0;
    };
    const flowEdges: Edge[] = edges.map((e) => {
      const hot = troubled(e.source_device_id) || troubled(e.destination_device_id);
      return {
        id: String(e.id),
        source: e.source_device_id,
        target: e.destination_device_id,
        type: "smoothstep",
        animated: hot,
        style: { stroke: hot ? "#f59e0b" : "#d6cec0", strokeWidth: hot ? 2.25 : 1.5 },
      };
    });
    return { flowNodes, flowEdges };
  }, [devices, edges, selectedId, priorityById]);

  const counts = { online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const d of devices) counts[d.status]++;
  const rootCauses = devices.filter((d) => (d.is_root_cause_of ?? []).length > 0).length;
  const selected = devices.find((d) => d.device_id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-stone-900">Topology</h1>
            {connected && (
              <span className="rounded-full border border-brand-orange/20 bg-brand-orange/10 px-2 py-0.5 text-[11px] font-medium">
                <TextShimmer>Live</TextShimmer>
              </span>
            )}
          </div>
          <p className="text-sm text-stone-500">Click a device to inspect it. Faults glow where they start.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SummaryChip label="Online" value={counts.online} tone="bg-emerald-500" />
          <SummaryChip label="Degraded" value={counts.degraded} tone="bg-amber-500" />
          <SummaryChip label="Offline" value={counts.offline + counts.unknown} tone="bg-red-500" />
          <SummaryChip label="Root causes" value={rootCauses} tone="bg-brand-orange" />
        </div>
      </motion.div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={canvasRef}
          className="topology-canvas relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-stone-200 shadow-sm shadow-stone-900/5"
        >
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            onInit={(instance) => (flowRef.current = instance)}
            nodesDraggable={false}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} color="#d9cdbb" gap={22} size={1.4} />
            <Controls showInteractive={false} position="top-right" />
          </ReactFlow>

          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="flex items-center gap-4 rounded-full border border-stone-200 bg-white/80 px-4 py-2 text-xs text-stone-600 shadow-sm backdrop-blur">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Healthy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]" /> Affected
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" /> Root cause
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-amber-500" /> Path under fault
              </span>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {selected && (
            <Inspector
              device={selected}
              priority={priorityById[selected.device_id] ?? null}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
