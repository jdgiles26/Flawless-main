"""Rancher 多集群、CMDB 拓扑和 Prometheus 指标接口。"""

from ._registry import build_feature_router


def build_router(runtime):
    return build_feature_router(runtime, [
        ("GET", "/api/rancher/status", "rancher_status"),
        ("GET", "/api/rancher/inventory", "rancher_inventory"),
        ("GET", "/api/resources", "unified_resources"),
        ("GET", "/api/cmdb/topology", "cmdb_topology"),
        ("GET", "/api/prometheus/summary", "prometheus_summary"),
    ], tag="集群资源与指标")
