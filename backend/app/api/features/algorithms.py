"""Endpoints for the algorithm catalog, real-time I/O, and decision evidence."""

from ._registry import build_feature_router


def build_router(runtime):
    return build_feature_router(runtime, [
        ("GET", "/api/algorithms", "algorithm_registry"),
        ("GET", "/api/algorithms/workbench", "algorithm_workbench"),
    ], tag="Algorithm Decisions")

