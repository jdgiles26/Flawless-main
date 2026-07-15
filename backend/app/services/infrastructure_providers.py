"""Full-stack infrastructure resource adapters.

This module defines resource entry points outside Kubernetes: databases, virtual
machines, middleware, storage, and cloud resources. Adapters are only responsible
for discovering resources, collecting low-risk health evidence, and generating
standardized findings; real changes must still go through OpsJob, the action
catalog, external controlled executors, human confirmation, and audit.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import socket
import time
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx


RESOURCE_TYPE_CATALOG: list[dict[str, Any]] = [
    {
        "id": "database",
        "name": "Database",
        "description": "Data services such as MySQL, PostgreSQL, Oracle, Redis, MongoDB, and Elasticsearch.",
        "evidence": ["db_connectivity", "db_slow_queries", "db_locks", "db_replication", "db_capacity", "db_backup_status"],
        "typical_actions": ["db_restart_instance", "db_kill_session", "db_expand_storage", "db_failover", "db_apply_parameter"],
    },
    {
        "id": "virtual_machine",
        "name": "Virtual Machine / Host",
        "description": "Compute nodes such as VMware, OpenStack, Harvester, ECS, and bare-metal Linux/Windows hosts.",
        "evidence": ["vm_agent_status", "vm_system_metrics", "vm_service_status", "vm_disk_usage", "vm_security_baseline"],
        "typical_actions": ["vm_restart_service", "vm_reboot", "vm_expand_disk", "vm_run_approved_script", "vm_snapshot"],
    },
    {
        "id": "middleware",
        "name": "Middleware",
        "description": "Cross-system dependencies such as Kafka, RabbitMQ, Nacos, Redis Cluster, and ELK.",
        "evidence": ["middleware_cluster_health", "middleware_lag", "middleware_topic_status", "middleware_client_errors"],
        "typical_actions": ["middleware_rebalance", "middleware_restart_broker", "middleware_expand_partition"],
    },
    {
        "id": "storage",
        "name": "Enterprise Storage",
        "description": "Storage backends such as Generic CSI Storage, Virtualization Platform, NFS, SAN, NAS, and Ceph.",
        "evidence": ["storage_pool_capacity", "storage_latency", "storage_snapshot", "storage_path_acl"],
        "typical_actions": ["storage_expand_volume", "storage_fix_acl", "storage_restore_snapshot"],
    },
    {
        "id": "cloud_service",
        "name": "Cloud Resource",
        "description": "Resources from Alibaba Cloud, general public clouds, private clouds, and organization-managed cloud services.",
        "evidence": ["cloud_instance_status", "cloud_quota", "cloud_security_group", "cloud_billing_risk"],
        "typical_actions": ["cloud_scale_instance", "cloud_attach_disk", "cloud_adjust_security_group"],
    },
]


DEFAULT_THRESHOLDS = {
    "cpu_percent": 85,
    "memory_percent": 88,
    "disk_percent": 85,
    "connections_percent": 85,
    "replication_lag_seconds": 60,
    "slow_query_count": 20,
    "lock_wait_seconds": 30,
}

SECRET_KEYS = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_id(value: str, fallback: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", str(value or fallback).strip()).strip("-")
    return raw[:96] or fallback


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return value.get("resources") or value.get("items") or value.get("targets") or []
    return []


def _json_env(name: str, default: str = "[]") -> Any:
    raw = os.getenv(name, default) or default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return []


def redact_sensitive(value: Any) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if SECRET_KEYS.search(str(key)):
                result[key] = "***"
            else:
                result[key] = redact_sensitive(item)
        return result
    if isinstance(value, list):
        return [redact_sensitive(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"(?i)(password|token|secret|api[_-]?key)=([^\\s&]+)", r"\\1=***", value)
        return value[:3000]
    return value


def _normalize_resource(raw: dict[str, Any], *, default_type: str) -> dict[str, Any]:
    rtype = str(raw.get("type") or raw.get("resource_type") or default_type).strip().lower()
    if rtype in {"db", "mysql", "postgres", "postgresql", "oracle", "redis", "mongodb", "elasticsearch"}:
        subtype = rtype if rtype != "db" else str(raw.get("engine") or raw.get("provider") or "database").lower()
        rtype = "database"
    elif rtype in {"vm", "host", "server", "ecs", "virtualmachine"}:
        subtype = str(raw.get("provider") or raw.get("os") or "vm").lower()
        rtype = "virtual_machine"
    else:
        subtype = str(raw.get("subtype") or raw.get("engine") or raw.get("provider") or rtype).strip().lower()
    host = str(raw.get("host") or raw.get("hostname") or "").strip()
    endpoint = str(raw.get("endpoint") or raw.get("url") or raw.get("dsn") or "").strip()
    if endpoint and not host:
        parsed = urlparse(endpoint if "://" in endpoint else f"tcp://{endpoint}")
        host = parsed.hostname or ""
    port = raw.get("port")
    if port is None and endpoint:
        parsed = urlparse(endpoint if "://" in endpoint else f"tcp://{endpoint}")
        port = parsed.port
    name = str(raw.get("name") or raw.get("display_name") or raw.get("id") or host or endpoint or f"{rtype}-resource").strip()
    resource_id = _safe_id(
        str(raw.get("id") or raw.get("resource_id") or name),
        f"{rtype}-{hashlib.sha1(name.encode('utf-8')).hexdigest()[:10]}",
    )
    return {
        "id": resource_id,
        "name": name,
        "type": rtype,
        "subtype": subtype or rtype,
        "provider": str(raw.get("provider") or subtype or rtype),
        "environment": str(raw.get("environment") or raw.get("env") or "unknown"),
        "cluster": str(raw.get("cluster") or raw.get("cluster_id") or raw.get("region") or "external"),
        "namespace": str(raw.get("namespace") or raw.get("project") or ""),
        "business_service": str(raw.get("business_service") or raw.get("service") or raw.get("app") or ""),
        "owner": str(raw.get("owner") or raw.get("team") or ""),
        "criticality": str(raw.get("criticality") or raw.get("tier") or "medium"),
        "host": host,
        "port": int(port) if str(port or "").isdigit() else None,
        "endpoint": endpoint,
        "health_url": str(raw.get("health_url") or raw.get("probe_url") or ""),
        "metrics": raw.get("metrics") or raw.get("current_metrics") or {},
        "thresholds": {**DEFAULT_THRESHOLDS, **(raw.get("thresholds") or {})},
        "cmdb_id": str(raw.get("cmdb_id") or raw.get("asset_id") or ""),
        "tags": [str(item) for item in raw.get("tags") or []],
        "enabled": bool(raw.get("enabled", True)),
        "actions_enabled": bool(raw.get("actions_enabled", False)),
        "raw": redact_sensitive(raw),
    }


def load_resources() -> list[dict[str, Any]]:
    resources: list[dict[str, Any]] = []
    for item in _as_list(_json_env("INFRASTRUCTURE_RESOURCES_JSON", "[]")):
        if isinstance(item, dict):
            resources.append(_normalize_resource(item, default_type=str(item.get("type") or "external")))
    for item in _as_list(_json_env("DATABASE_TARGETS_JSON", "[]")):
        if isinstance(item, dict):
            resources.append(_normalize_resource(item, default_type="database"))
    for item in _as_list(_json_env("VM_TARGETS_JSON", "[]")):
        if isinstance(item, dict):
            resources.append(_normalize_resource(item, default_type="virtual_machine"))
    for item in _as_list(_json_env("MIDDLEWARE_TARGETS_JSON", "[]")):
        if isinstance(item, dict):
            resources.append(_normalize_resource(item, default_type="middleware"))
    for item in _as_list(_json_env("STORAGE_TARGETS_JSON", "[]")):
        if isinstance(item, dict):
            resources.append(_normalize_resource(item, default_type="storage"))

    dedup: dict[str, dict[str, Any]] = {}
    for item in resources:
        if item.get("enabled", True):
            dedup[item["id"]] = item
    return sorted(dedup.values(), key=lambda item: (item["type"], item["cluster"], item["name"]))


def providers_payload() -> dict[str, Any]:
    resources = load_resources()
    counts: dict[str, int] = {}
    for item in resources:
        counts[item["type"]] = counts.get(item["type"], 0) + 1
    return {
        "status": "ok",
        "catalog": deepcopy(RESOURCE_TYPE_CATALOG),
        "resources": [redact_sensitive(item) for item in resources],
        "summary": {
            "total": len(resources),
            "by_type": counts,
            "configured": bool(resources),
            "action_webhook_configured": bool(os.getenv("INFRASTRUCTURE_ACTION_WEBHOOK_URL", "").strip()),
        },
        "configuration": {
            "unified": "INFRASTRUCTURE_RESOURCES_JSON",
            "database": "DATABASE_TARGETS_JSON",
            "virtual_machine": "VM_TARGETS_JSON",
            "action_webhook": "INFRASTRUCTURE_ACTION_WEBHOOK_URL",
        },
    }


async def _tcp_probe(host: str, port: int | None, timeout: float = 2.5) -> dict[str, Any]:
    if not host or not port:
        return {"status": "skipped", "message": "host/port is not configured"}
    started = time.perf_counter()
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, int(port), family=socket.AF_UNSPEC), timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return {"status": "ok", "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception as exc:
        return {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}


async def _http_probe(url: str, timeout: float = 4.0) -> dict[str, Any]:
    if not url:
        return {"status": "skipped", "message": "health_url is not configured"}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=os.getenv("INFRASTRUCTURE_VERIFY_SSL", "true").lower() in {"1", "true", "yes", "on"}) as client:
            response = await client.get(url)
        return {
            "status": "ok" if response.status_code < 500 else "failed",
            "http_status": response.status_code,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }
    except Exception as exc:
        return {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}


def _metric_findings(resource: dict[str, Any]) -> list[dict[str, Any]]:
    metrics = resource.get("metrics") or {}
    thresholds = resource.get("thresholds") or DEFAULT_THRESHOLDS
    findings = []

    def add_if(metric: str, category: str, title: str, unit: str = "%"):
        value = metrics.get(metric)
        threshold = thresholds.get(metric)
        if value is None or threshold is None:
            return
        try:
            if float(value) >= float(threshold):
                findings.append({
                    "category": category,
                    "severity": "P1" if float(value) >= float(threshold) * 1.15 else "P2",
                    "title": title,
                    "summary": f"{resource['name']} {title}: {value}{unit}, threshold {threshold}{unit}",
                    "evidence": {"metric": metric, "value": value, "threshold": threshold},
                })
        except (TypeError, ValueError):
            return

    for metric in ("cpu_percent", "memory_percent", "disk_percent"):
        add_if(metric, f"{resource['type']}_capacity", {"cpu_percent": "CPU usage is too high", "memory_percent": "Memory usage is too high", "disk_percent": "Disk usage is too high"}[metric])
    add_if("connections_percent", "database_connection", "Database connection pool is nearly exhausted")
    add_if("replication_lag_seconds", "database_replication", "Database replication lag is too high", "s")
    add_if("slow_query_count", "database_slow_query", "Slow SQL count is abnormal", "")
    add_if("lock_wait_seconds", "database_lock", "Lock wait time is too long", "s")
    return findings


def _default_steps(resource: dict[str, Any], finding: dict[str, Any]) -> list[dict[str, Any]]:
    if resource["type"] == "database":
        return [
            {"title": "Read database connections and instance state", "description": "Check connection count, active sessions, replication role, read-only state, error logs, and recent changes.", "probe": "db_connectivity"},
            {"title": "Locate database hotspots", "description": "Analyze slow SQL, lock waits, long transactions, replication lag, tablespace usage, and disk utilization.", "probe": "db_runtime_evidence"},
            {"title": "Assess business impact and rollback conditions", "description": "Use CMDB dependency relationships to confirm affected applications, read/write paths, failover risk, and recovery criteria.", "probe": "dependency_topology"},
        ]
    if resource["type"] == "virtual_machine":
        return [
            {"title": "Read host health evidence", "description": "Check the agent, CPU, memory, disk, IO, network, system logs, and key service status.", "probe": "vm_system_metrics"},
            {"title": "Identify process and system-layer root cause", "description": "Confirm whether the issue is caused by a service failure, full disk, file descriptor exhaustion, kernel error, network outage, or security baseline change.", "probe": "vm_runtime_evidence"},
            {"title": "Choose the smallest repair action", "description": "Prefer restarting the failed service, expanding the disk, or restoring configuration; full host reboot must require a second confirmation as a high-risk action.", "probe": "vm_change_guard"},
        ]
    return [
        {"title": "Read resource health evidence", "description": "Check status, metrics, logs, dependencies, and recent changes.", "probe": "infra_health"},
        {"title": "Determine impact scope", "description": "Use CMDB, business services, and upstream/downstream dependencies to assess the blast radius.", "probe": "dependency_topology"},
        {"title": "Generate a controlled remediation plan", "description": "Only choose actions from the action catalog that are auditable, reversible, and verifiable.", "probe": "infra_action_guard"},
    ]


def _candidate_changes(resource: dict[str, Any], finding: dict[str, Any]) -> list[dict[str, Any]]:
    category = str(finding.get("category") or "")
    rtype = resource["type"]
    base = {
        "resource_id": resource["id"],
        "resource_type": rtype,
        "resource_name": resource["name"],
        "provider": resource.get("provider"),
        "requires_external_executor": True,
        "reason": finding.get("summary") or finding.get("title"),
    }
    if rtype == "database":
        if "capacity" in category or "disk" in str(finding.get("title", "")).lower():
            return [{**base, "type": "db_expand_storage", "risk": "high", "rollback": "Storage expansion is usually irreversible; confirm backups and capacity strategy before execution."}]
        if "connection" in category:
            return [{**base, "type": "db_kill_session", "risk": "high", "rollback": "Re-establish terminated sessions; confirm session source and SQL before execution."}]
        if "replication" in category:
            return [{**base, "type": "db_failover", "risk": "high", "rollback": "Fail back or resynchronize according to the database HA runbook."}]
        if "slow_query" in category or "lock" in category:
            return [{**base, "type": "db_apply_parameter", "risk": "high", "rollback": "Restore the parameter snapshot or roll back within the change window."}]
        return [{**base, "type": "db_restart_instance", "risk": "high", "rollback": "Recover using the pre-start snapshot and the database HA runbook."}]
    if rtype == "virtual_machine":
        if "disk" in str(finding.get("summary", "")).lower() or category.endswith("capacity"):
            return [{**base, "type": "vm_expand_disk", "risk": "high", "rollback": "Disk expansion is usually irreversible; confirm snapshots and filesystem expansion steps before execution."}]
        if "connectivity" in category:
            return [{**base, "type": "vm_reboot", "risk": "high", "rollback": "Cannot be rolled back in place; confirm business redundancy and maintenance window before execution."}]
        return [{**base, "type": "vm_restart_service", "risk": "medium", "rollback": "Restore the service's original startup parameters or revert the configuration."}]
    return [{**base, "type": "infra_run_approved_action", "risk": "high", "rollback": "Handle rollback according to the plan returned by the external executor."}]


async def scan_resources(resource_type: str = "all", resource_id: str = "", *, include_probe: bool = True) -> dict[str, Any]:
    resources = [
        item for item in load_resources()
        if resource_type in {"", "all", "*"} or item["type"] == resource_type
    ]
    if resource_id:
        resources = [item for item in resources if item["id"] == resource_id]
    findings: list[dict[str, Any]] = []
    for resource in resources:
        probes: dict[str, Any] = {}
        if include_probe:
            probes["tcp"] = await _tcp_probe(resource.get("host", ""), resource.get("port"))
            probes["http"] = await _http_probe(resource.get("health_url", ""))
        probe_failed = any((p or {}).get("status") == "failed" for p in probes.values())
        if probe_failed:
            findings.append({
                "id": f"{resource['id']}:connectivity",
                "resource": redact_sensitive(resource),
                "resource_id": resource["id"],
                "resource_type": resource["type"],
                "category": f"{resource['type']}_connectivity",
                "severity": "P1" if resource.get("criticality") in {"high", "core", "p0", "p1"} else "P2",
                "title": f"{resource['name']} connectivity issue",
                "summary": f"{resource['name']} health probe failed; confirm the network, instance state, agent, or access credentials.",
                "evidence": {"probes": redact_sensitive(probes), "resource": redact_sensitive(resource)},
            })
        for metric_finding in _metric_findings(resource):
            metric_finding.update({
                "id": f"{resource['id']}:{metric_finding['category']}",
                "resource": redact_sensitive(resource),
                "resource_id": resource["id"],
                "resource_type": resource["type"],
                "evidence": {**metric_finding.get("evidence", {}), "probes": redact_sensitive(probes), "resource": redact_sensitive(resource)},
            })
            findings.append(metric_finding)

    for finding in findings:
        resource = next((item for item in resources if item["id"] == finding.get("resource_id")), finding.get("resource") or {})
        finding["ops_plan"] = {
            "id": f"infra-plan-{finding['id'].replace(':', '-')}",
            "title": f"AI SRE simulation: {finding['title']}",
            "summary": finding["summary"],
            "source": "infrastructure",
            "resource_type": finding.get("resource_type"),
            "resource_id": finding.get("resource_id"),
            "target": f"{finding.get('resource_type')}/{finding.get('resource_id')}",
            "cluster": resource.get("cluster", "external"),
            "namespace": resource.get("namespace", ""),
            "evidence": finding.get("evidence") or {},
            "steps": _default_steps(resource, finding),
            "changes": _candidate_changes(resource, finding),
            "requires_confirmation": True,
            "requires_high_risk_confirmation": True,
            "success_criteria": ["infra_probe_healthy", "business_probe_ok", "error_rate_recovered"],
            "risk_note": "Database and virtual machine changes must be submitted through an external controlled executor or enterprise-approved scripts; the platform will not treat LLM output as arbitrary executable commands.",
        }
    return {
        "status": "ok",
        "timestamp": _now(),
        "resource_count": len(resources),
        "finding_count": len(findings),
        "resources": [redact_sensitive(item) for item in resources],
        "findings": findings,
        "summary": {
            "total": len(findings),
            "p1": sum(1 for item in findings if item.get("severity") == "P1"),
            "p2": sum(1 for item in findings if item.get("severity") == "P2"),
            "configured": bool(resources),
        },
    }
