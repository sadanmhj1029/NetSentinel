import type { Device, TopologyLink } from "../types";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
}

const LEVEL_HEIGHT = 170;
const NODE_WIDTH = 222;

/**
 * Simple layered (Sugiyama-ish) layout: devices with no parent are roots at
 * depth 0, everything else sits one level below its shallowest parent.
 * Good enough for the tree-shaped topologies this app deals with -- no
 * need to pull in a full graph-layout library for ~a dozen nodes.
 */
export function layoutTopology(nodes: Device[], edges: TopologyLink[]): Record<string, LaidOutNode> {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const e of edges) {
    childrenOf.set(e.source_device_id, [...(childrenOf.get(e.source_device_id) ?? []), e.destination_device_id]);
    hasParent.add(e.destination_device_id);
  }

  const allIds = nodes.map((n) => n.device_id);
  const roots = allIds.filter((id) => !hasParent.has(id));
  const startIds = roots.length > 0 ? roots : allIds.slice(0, 1);

  const depth = new Map<string, number>();
  const order: string[] = [];
  const queue: string[] = [];
  for (const r of startIds) {
    depth.set(r, 0);
    queue.push(r);
  }
  while (queue.length) {
    const current = queue.shift()!;
    if (order.includes(current)) continue;
    order.push(current);
    const d = depth.get(current) ?? 0;
    for (const child of childrenOf.get(current) ?? []) {
      if (!depth.has(child) || depth.get(child)! < d + 1) {
        depth.set(child, d + 1);
      }
      if (!order.includes(child)) queue.push(child);
    }
  }
  // Any node never reached (disconnected / cycle edge case) gets dumped at depth 0.
  for (const id of allIds) {
    if (!depth.has(id)) depth.set(id, 0);
  }

  const byLevel = new Map<number, string[]>();
  for (const id of allIds) {
    const d = depth.get(id) ?? 0;
    byLevel.set(d, [...(byLevel.get(d) ?? []), id]);
  }

  const positions: Record<string, LaidOutNode> = {};
  for (const [level, ids] of byLevel.entries()) {
    const totalWidth = ids.length * NODE_WIDTH;
    ids.forEach((id, i) => {
      positions[id] = {
        id,
        x: i * NODE_WIDTH - totalWidth / 2 + NODE_WIDTH / 2,
        y: level * LEVEL_HEIGHT,
      };
    });
  }
  return positions;
}
