"""
Builds the live topology graph from the database with NetworkX (spec
section 13: "Build a topology graph using NetworkX").

Edges always point parent -> child (the direction a failure can
plausibly propagate). All the correlation engine needs from this module
is: given a device, who are its ancestors/descendants right now.
"""
from __future__ import annotations

import networkx as nx
from sqlalchemy.orm import Session

from app.models.topology import TopologyLink


def load_graph(db: Session) -> nx.DiGraph:
    graph = nx.DiGraph()
    links = db.query(TopologyLink).all()
    for link in links:
        graph.add_edge(link.source_device_id, link.destination_device_id)
    return graph


def descendants(graph: nx.DiGraph, device_id: str) -> set[str]:
    if device_id not in graph:
        return set()
    return nx.descendants(graph, device_id)


def ancestors(graph: nx.DiGraph, device_id: str) -> set[str]:
    if device_id not in graph:
        return set()
    return nx.ancestors(graph, device_id)


def parents(graph: nx.DiGraph, device_id: str) -> list[str]:
    if device_id not in graph:
        return []
    return list(graph.predecessors(device_id))


def fan_out(graph: nx.DiGraph, device_id: str) -> int:
    """Number of devices that ultimately depend on this one -- a rough
    measure of "dependency importance"."""
    return len(descendants(graph, device_id))
