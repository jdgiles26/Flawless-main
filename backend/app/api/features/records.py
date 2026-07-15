"""Endpoints for events, alerts, postmortems, and agent invocation records."""

from ._registry import build_feature_router


def build_router(runtime):
    return build_feature_router(runtime, [
        ("GET", "/api/incidents", "list_incidents"),
        ("POST", "/api/incidents", "create_incident"),
        ("GET", "/api/postmortems", "list_postmortems"),
        ("GET", "/api/alerts", "list_alerts"),
        ("GET", "/api/traces", "list_traces"),
    ], tag="Events and Postmortems")

