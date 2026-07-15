"""Endpoints for topology impact, blast radius, and progressive release gates."""

from ._registry import build_feature_router


def build_router(runtime):
    return build_feature_router(runtime, [
        ("POST", "/api/topology/impact", "analyze_topology_impact"),
        ("POST", "/api/network/external-flows", "external_traffic_flows"),
        ("POST", "/api/release-gate/evaluate", "evaluate_gray_release_gate"),
    ], tag="Topology and Change Risk")
