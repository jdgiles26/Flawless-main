"""Evidence-driven remediation planning for Kubernetes incidents.

The LLM is a planner, not a privileged shell.  This module owns the stable
action vocabulary, evidence scoring, approval policy, and deterministic
fallback plans used by both SRE chat and cluster inspection.
"""
from __future__ import annotations

import math
import os
import re
from copy import deepcopy
from typing import Any


ACTION_CATALOG: dict[str, dict[str, Any]] = {
    "create_workload": {
        "risk": "high", "auto_allowed": False, "rollback": "delete the newly created workload after approval",
        "description": "Create one validated apps/v1 Deployment, StatefulSet or DaemonSet from the release gate.",
    },
    "patch_workload": {
        "risk": "medium", "auto_allowed": True, "rollback": "restore the previous workload template",
        "description": "Patch Deployment, StatefulSet or DaemonSet pod template/replicas.",
    },
    "restart": {
        "risk": "medium", "auto_allowed": True, "rollback": "not applicable; rollout is convergent",
        "description": "Trigger a controlled rolling restart.",
    },
    "scale_out": {
        "risk": "medium", "auto_allowed": True, "rollback": "restore the previous replica count",
        "description": "Increase workload replicas within the configured cap.",
    },
    "recreate_pod": {
        "risk": "medium", "auto_allowed": True, "rollback": "controller recreates the pod from the unchanged template",
        "description": "Delete one controller-owned unhealthy pod for clean rescheduling.",
    },
    "patch_hpa": {
        "risk": "medium", "auto_allowed": True, "rollback": "restore previous HPA min/max replicas",
        "description": "Adjust HPA bounds without changing its metric semantics.",
    },
    "expand_pvc": {
        "risk": "high", "auto_allowed": False, "rollback": "volume expansion is normally irreversible",
        "description": "Expand a bound PVC when its StorageClass supports expansion.",
    },
    "create_pvc": {
        "risk": "high", "auto_allowed": False, "rollback": "delete the new PVC only after confirming no business data was written",
        "description": "Create a missing PersistentVolumeClaim from workload evidence and approved storage policy.",
    },
    "create_pv": {
        "risk": "high", "auto_allowed": False, "rollback": "delete the PV only after confirming reclaim policy and data safety",
        "description": "Create a statically bound PersistentVolume when the storage backend template is configured.",
    },
    "patch_workload_volume": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the previous workload volume claim reference",
        "description": "Patch a workload volume reference after PVC/PV evidence proves the original claim is wrong.",
    },
    "patch_workload_runtime_security": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the previous pod template security/initContainer section",
        "description": "Patch pod security context or a bounded initContainer when storage ownership evidence proves fsGroup alone is insufficient.",
    },
    "cordon_node": {
        "risk": "high", "auto_allowed": False, "rollback": "uncordon the node",
        "description": "Stop new scheduling on a proven unhealthy node.",
    },
    "evict_pod": {
        "risk": "high", "auto_allowed": False, "rollback": "controller recreates the pod; PDB is honored",
        "description": "Evict a pod through the policy API for node maintenance.",
    },
    "uncordon_node": {
        "risk": "high", "auto_allowed": False, "rollback": "cordon the node again",
        "description": "Return a recovered node to scheduling after condition and capacity verification.",
    },
    "rollback_workload": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the superseded immutable image reference",
        "description": "Patch a workload back to a previously observed immutable image/template revision.",
    },
    "patch_service": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the previous selector and port map",
        "description": "Repair a proven Service selector or port mismatch using a bounded patch.",
    },
    "patch_service_account": {
        "risk": "medium", "auto_allowed": True, "rollback": "remove the injected imagePullSecret from the ServiceAccount",
        "description": "Attach an approved imagePullSecret to a workload ServiceAccount.",
    },
    "create_configmap": {
        "risk": "high", "auto_allowed": False, "rollback": "delete the created ConfigMap after confirming no workload depends on it",
        "description": "Recreate a missing ConfigMap only from an operator-approved template.",
    },
    "patch_pdb": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the previous disruption budget",
        "description": "Repair a PDB deadlock after replica and availability evidence is collected.",
    },
    "db_restart_instance": {
        "risk": "high", "auto_allowed": False, "rollback": "follow the database HA/startup runbook and restore from the pre-change snapshot if needed",
        "description": "Restart a database instance through an approved external executor after connection, role and backup evidence is collected.",
    },
    "db_kill_session": {
        "risk": "high", "auto_allowed": False, "rollback": "application reconnects; keep the killed session evidence for audit",
        "description": "Terminate proven harmful database sessions such as runaway SQL, blocker sessions or abandoned long transactions.",
    },
    "db_expand_storage": {
        "risk": "high", "auto_allowed": False, "rollback": "storage expansion is normally irreversible; validate backup and capacity policy first",
        "description": "Expand database storage through an approved DBA/storage executor.",
    },
    "db_failover": {
        "risk": "high", "auto_allowed": False, "rollback": "execute the approved HA rollback or rejoin procedure",
        "description": "Perform a controlled database failover only when replication, role and application impact evidence supports it.",
    },
    "db_apply_parameter": {
        "risk": "high", "auto_allowed": False, "rollback": "restore the previous parameter snapshot",
        "description": "Apply a bounded database parameter change through an approved executor.",
    },
    "vm_restart_service": {
        "risk": "medium", "auto_allowed": False, "rollback": "restore the previous service unit/configuration and restart again if needed",
        "description": "Restart a specific unhealthy OS service through an approved host executor.",
    },
    "vm_reboot": {
        "risk": "high", "auto_allowed": False, "rollback": "no in-place rollback; recover from snapshot or HA capacity if reboot fails",
        "description": "Reboot a virtual machine only after redundancy, service impact and console access are verified.",
    },
    "vm_expand_disk": {
        "risk": "high", "auto_allowed": False, "rollback": "disk expansion is normally irreversible; confirm snapshot and filesystem procedure",
        "description": "Expand a VM disk and filesystem through an approved virtualization/OS executor.",
    },
    "vm_run_approved_script": {
        "risk": "high", "auto_allowed": False, "rollback": "use the script-specific rollback instruction recorded in the approved script catalog",
        "description": "Run an enterprise-approved host script; arbitrary shell from the LLM is never accepted.",
    },
    "vm_snapshot": {
        "risk": "medium", "auto_allowed": False, "rollback": "delete the snapshot after the maintenance window or restore from it when approved",
        "description": "Create a VM snapshot before a risky remediation step.",
    },
    "middleware_rebalance": {
        "risk": "high", "auto_allowed": False, "rollback": "follow the middleware-specific rebalance rollback plan",
        "description": "Rebalance middleware traffic or partitions through an approved executor.",
    },
    "storage_expand_volume": {
        "risk": "high", "auto_allowed": False, "rollback": "storage expansion is normally irreversible; confirm pool capacity and snapshot policy",
        "description": "Expand enterprise storage volume through an approved storage executor.",
    },
    "infra_run_approved_action": {
        "risk": "high", "auto_allowed": False, "rollback": "use the external executor returned rollback plan",
        "description": "Generic non-Kubernetes infrastructure action routed to an approved external executor.",
    },
}

ACTION_OPERATOR_GUIDANCE: dict[str, dict[str, str]] = {
    "create_workload": {"label": "Create new Workload", "when_to_use": "Release governance has validated the full YAML, and a new Deployment, StatefulSet, or DaemonSet must be created.", "operator_note": "High risk; verify the namespace, image, resources, probes, ServiceAccount, and rollback path before creating it."},
    "patch_workload": {"label": "Modify Workload configuration", "when_to_use": "Evidence confirms that the image, probes, resources, replicas, environment variables, or security context of a Deployment, StatefulSet, or DaemonSet is misconfigured.", "operator_note": "Only change controlled fields, show the diff before execution, and preserve the ability to roll back to the original template."},
    "restart": {"label": "Rolling restart component", "when_to_use": "The configuration is correct, but the process is stuck, connections were not refreshed, or the Workload must recreate its Pods.", "operator_note": "This does not fix bad configuration; first confirm there are enough replicas and that the PDB allows a rolling restart."},
    "scale_out": {"label": "Increase replicas", "when_to_use": "CPU, concurrency, or traffic evidence shows insufficient capacity, and the application supports horizontal scaling.", "operator_note": "Scale only within the replica limit and monitor downstream dependencies and resource quotas."},
    "recreate_pod": {"label": "Recreate unhealthy Pod", "when_to_use": "A single controller-managed Pod is corrupted, while the Workload template and other replicas remain healthy.", "operator_note": "After deletion, the controller recreates it from the original template; this is not suitable for template-level, storage-level, or fleet-wide failures."},
    "patch_hpa": {"label": "Adjust HPA range", "when_to_use": "The HPA min/max range is blocking appropriate scaling, while metric semantics and data sources are healthy.", "operator_note": "Do not change the metric algorithm; only adjust min/max replicas."},
    "expand_pvc": {"label": "Expand PVC", "when_to_use": "Volume usage is approaching the limit, and the StorageClass explicitly supports expansion.", "operator_note": "Usually irreversible; verify filesystem expansion support and business backups first."},
    "create_pvc": {"label": "Create missing PVC", "when_to_use": "The Workload clearly references a non-existent PVC, and the storage policy, capacity, and access mode have been confirmed.", "operator_note": "High risk; create it only from an approved StorageClass or approved template."},
    "create_pv": {"label": "Create static PV", "when_to_use": "Dynamic provisioning is unavailable, and the storage administrator has provided approved backend paths and binding details.", "operator_note": "High risk; the LLM must never invent NFS, LUN, or directory paths."},
    "patch_workload_volume": {"label": "Correct volume reference", "when_to_use": "Evidence shows the Workload references the wrong PVC, volume, or mount configuration.", "operator_note": "High risk; requires complete storage-chain evidence and a rollback point for the original configuration."},
    "patch_workload_runtime_security": {"label": "Fix runtime permissions", "when_to_use": "Logs or events show that mount ownership prevents the container from writing, the fsGroup approach is insufficient, and a controlled initContainer or security-context adjustment is required.", "operator_note": "High risk; verify step by step and allow only bounded chown/chmod/mkdir permission-repair commands."},
    "cordon_node": {"label": "Cordon node", "when_to_use": "The node clearly has pressure, NotReady, hardware, or runtime faults, and new Pod scheduling must stop.", "operator_note": "This only stops new scheduling; it does not automatically migrate existing Pods and is typically followed by controlled eviction."},
    "evict_pod": {"label": "Controlled Pod eviction", "when_to_use": "Pods must be moved after node maintenance or isolation, and the PDB allows disruption.", "operator_note": "Execute via the Eviction API and honor the PDB; this is high risk and requires human approval."},
    "uncordon_node": {"label": "Restore node scheduling", "when_to_use": "The node is Ready again, pressure conditions have cleared, and capacity and system-component checks have passed.", "operator_note": "Before restoring scheduling, confirm the fault is resolved so workloads do not land back on a bad node."},
    "rollback_workload": {"label": "Rollback Workload", "when_to_use": "The most recent rollout aligns with the incident timeline, and a verified stable image or template revision exists.", "operator_note": "High risk; roll back only to a genuinely observed stable version."},
    "patch_service": {"label": "Correct Service", "when_to_use": "The selector, port, or targetPort clearly does not match Ready Pods.", "operator_note": "High risk; an incorrect change can create a traffic black hole, so preserve the original selector and port mapping first."},
    "patch_service_account": {"label": "Correct ServiceAccount", "when_to_use": "Image pull failures are caused by a missing, enterprise-approved imagePullSecret binding.", "operator_note": "Only add references to approved Secrets; never read or modify Secret plaintext."},
    "create_configmap": {"label": "Restore ConfigMap", "when_to_use": "A ConfigMap referenced by the Workload is missing, and the platform already has an operations-approved configuration template.", "operator_note": "High risk; the LLM must not generate production configuration values on its own."},
    "patch_pdb": {"label": "Correct PDB", "when_to_use": "The PDB and replica configuration have created a rollout or eviction deadlock, and availability evidence is sufficient.", "operator_note": "High risk; continuously monitor available replicas and business SLOs while the change is in effect."},
    "db_restart_instance": {"label": "Restart database instance", "when_to_use": "Connection, role, backup, and business-impact evidence is complete, and the incident clearly requires instance-level recovery.", "operator_note": "High risk; execution must go through a DBA executor, and the LLM may not run SQL or system commands directly."},
    "db_kill_session": {"label": "Terminate database session", "when_to_use": "Evidence confirms a specific session is the direct root cause of lock waits, long transactions, or resource exhaustion.", "operator_note": "High risk; you must show the session source, SQL summary, blocking chain, and business impact."},
    "db_expand_storage": {"label": "Expand database storage", "when_to_use": "Tablespace or disk capacity is nearing its limit, and backup and storage policy have been confirmed.", "operator_note": "Usually irreversible; requires confirmation from the DBA or storage administrator."},
    "db_failover": {"label": "Database failover", "when_to_use": "The primary database is unavailable or latency/errors have crossed the HA playbook threshold, and the replica is ready to take over.", "operator_note": "Extremely high risk; requires a second confirmation plus a business window and failback plan."},
    "db_apply_parameter": {"label": "Adjust database parameter", "when_to_use": "A parameter setting is conclusively identified as the root cause of locking, connection, memory, or replication problems.", "operator_note": "You must preserve the original parameter snapshot and limit the scope of changes."},
    "vm_restart_service": {"label": "Restart host service", "when_to_use": "A single OS service is unhealthy, and system-resource and configuration evidence supports service-level recovery.", "operator_note": "Restart only the specified service through a controlled executor; arbitrary shell commands are not allowed."},
    "vm_reboot": {"label": "Reboot virtual machine", "when_to_use": "The host is unreachable or has kernel, driver, or system-level failures, and business redundancy or a maintenance window is available.", "operator_note": "High risk; confirm snapshots, console access, HA, and blast radius first."},
    "vm_expand_disk": {"label": "Expand virtual machine disk", "when_to_use": "Filesystem capacity risk is clear, and snapshot, disk, and partition expansion steps have been verified.", "operator_note": "Usually irreversible; ensure filesystem expansion commands are executed only by an approved executor."},
    "vm_run_approved_script": {"label": "Run approved host script", "when_to_use": "The matching script already exists in the enterprise script catalog, and the evidence and trigger conditions are fully satisfied.", "operator_note": "The Skill may reference only the script ID and must not store the script body."},
    "vm_snapshot": {"label": "Create virtual machine snapshot", "when_to_use": "A rollback point is required before a high-risk host change.", "operator_note": "A snapshot is not a long-term backup; define a cleanup window."},
    "middleware_rebalance": {"label": "Rebalance middleware", "when_to_use": "Kafka, queue, or cache shards are skewed, backlogged, or affected by node issues.", "operator_note": "You must confirm client impact and the rollback strategy."},
    "storage_expand_volume": {"label": "Expand enterprise storage volume", "when_to_use": "Storage-pool capacity, volume capacity, and business usage evidence support expansion.", "operator_note": "Requires a storage-platform executor and capacity approval."},
    "infra_run_approved_action": {"label": "Run approved infrastructure action", "when_to_use": "The resource type is integrated with an external executor but has not yet been broken out into a dedicated action.", "operator_note": "The executor must return an audit ID, result, and rollback guidance."},
}


EXPERT_PROBES = {
    "current_logs", "previous_logs", "events", "workload_spec", "pod_metrics", "node_pressure",
    "node_conditions", "node_capacity", "system_pods", "service_endpoints", "dns", "network_policy",
    "mesh_routes", "dependency_topology", "storage_chain", "node_storage", "csi_status",
    "pod_security_context", "image_pull_secrets", "registry_connectivity", "scheduler_constraints",
    "node_labels", "quota", "pvc_binding", "hpa", "traffic_baseline", "dependency_latency",
    "cni_events", "recent_changes", "pdb_state", "certificate_chain", "webhook_status",
    "config_ref_exists",
}


def _infer_expert_probe(text: str) -> str:
    """Bind an AI natural-language step to a real read-only probe the platform can execute."""
    lowered = str(text or "").lower()
    mappings = [
        (("previous", "prior", "termination log", "laststate"), "previous_logs"),
        (("event", "events", "failedscheduling", "failedmount"), "events"),
        (("pvc", "pv", "storageclass", "csi", "storage", "mount"), "storage_chain"),
        (("service", "endpoint", "selector", "traffic entry"), "service_endpoints"),
        (("networkpolicy", "network policy"), "network_policy"),
        (("dns", "name resolution"), "dns"),
        (("node", "host node", "diskpressure", "memorypressure"), "node_conditions"),
        (("pdb", "disruption"), "pdb_state"),
        (("quota", "limitrange", "resource quota"), "quota"),
        (("rollout", "revision", "recent changes", "image version", "rollback"), "recent_changes"),
        (("hpa", "autoscaling"), "hpa"),
        (("cmdb", "dependency", "call chain", "kafka"), "dependency_topology"),
        (("registry", "imagepull", "image registry", "pull"), "registry_connectivity"),
        (("workload", "deployment", "statefulset", "daemonset", "template", "configuration"), "workload_spec"),
        (("log", "logs", "stack trace"), "current_logs"),
    ]
    for terms, probe in mappings:
        if any(term in lowered for term in terms):
            return probe
    return "workload_spec"


def expert_steps_from_diagnosis(diagnosis: dict) -> list[dict[str, Any]]:
    """Convert the current LLM diagnosis into executable, auditable steps bound to real probes."""
    steps: list[dict[str, Any]] = []
    for index, raw in enumerate((diagnosis.get("immediate_actions") or [])[:10], start=1):
        if isinstance(raw, dict):
            title = str(raw.get("title") or raw.get("step") or raw.get("action") or f"Expert step {index}").strip()
            description = str(raw.get("description") or raw.get("detail") or raw.get("purpose") or title).strip()
            requested_probe = str(raw.get("probe") or "").strip()
            probe = requested_probe if requested_probe in EXPERT_PROBES else _infer_expert_probe(f"{title} {description}")
            decision_rule = str(raw.get("decision_rule") or raw.get("decision") or "Use the real evidence returned by this step to choose the next branch.").strip()
            on_match = str(raw.get("on_match") or raw.get("action_if_matched") or raw.get("next_if_true") or "Proceed to the smallest evidence-backed change candidate.").strip()
            on_miss = str(raw.get("on_miss") or raw.get("action_if_not_matched") or raw.get("next_if_false") or "Eliminate this branch and inspect the next candidate root cause.").strip()
            expected = raw.get("expected_evidence") or raw.get("evidence") or []
        else:
            text = str(raw or "").strip()
            if not text:
                continue
            title, _, detail = text.partition("：")
            if not detail:
                title, _, detail = text.partition(":")
            title = title.strip() or f"Expert step {index}"
            description = detail.strip() or text
            probe = _infer_expert_probe(text)
            decision_rule = "Use the real evidence returned by this step to choose the next branch."
            on_match = "Proceed to the smallest evidence-backed change candidate."
            on_miss = "Eliminate this branch and inspect the next candidate root cause."
            expected = []
        if not title:
            continue
        steps.append({
            "id": probe, "sequence": index, "title": title[:120], "description": description[:500],
            "probe": probe, "expected_evidence": expected if isinstance(expected, list) else [str(expected)],
            "decision_rule": decision_rule[:500], "on_match": on_match[:500], "on_miss": on_miss[:500],
            "source": "llm_evidence_expert", "status": "pending",
        })
    return steps


RUNBOOKS: dict[str, dict[str, Any]] = {
    "oom": {
        "title": "OOM / memory pressure recovery",
        "terms": ("oomkilled", "out of memory", "exit code 137", "memory exhaustion", "insufficient memory"),
        "diagnostics": ("previous_logs", "workload_spec", "pod_metrics", "node_pressure"),
        "success": ("pod_ready", "restart_count_stable", "oom_absent"),
    },
    "probe": {
        "title": "Probe and slow-start recovery",
        "terms": ("liveness", "readiness", "startup probe", "probe failed", "connection refused", "context deadline exceeded", "probe"),
        "diagnostics": ("current_logs", "previous_logs", "workload_spec", "service_endpoints"),
        "success": ("pod_ready", "endpoint_ready", "probe_failures_absent"),
    },
    "storage_permission": {
        "title": "Volume permission recovery",
        "terms": (
            "permission denied", "operation not permitted", "read-only file system",
            "can't create directory", "cannot create directory", "mkdir:",
            "permission issue", "directory permissions", "unable to create directory",
        ),
        "diagnostics": ("previous_logs", "storage_chain", "workload_spec", "pod_security_context"),
        "success": ("mount_events_absent", "pod_ready", "write_errors_absent"),
    },
    "storage_mount": {
        "title": "PVC / mount recovery",
        "terms": (
            "failedmount", "failedattachvolume", "mountvolume", "persistentvolumeclaim", "pvc", "mount failure",
            "unbound immediate persistentvolumeclaims", "no persistent volumes available", "volume binding",
        ),
        "diagnostics": ("storage_chain", "events", "node_storage", "csi_status"),
        "success": ("pvc_bound", "mount_events_absent", "pod_ready"),
    },
    "image_auth": {
        "title": "Image registry authentication recovery",
        "terms": ("imagepullbackoff", "errimagepull", "unauthorized", "authentication required", "pull access denied", "image pull"),
        "diagnostics": ("events", "workload_spec", "image_pull_secrets", "registry_connectivity"),
        "success": ("image_pulled", "pod_ready"),
    },
    "image_architecture": {
        "title": "Image architecture or runtime mismatch recovery",
        "terms": (
            "exec format error", "standard_init_linux.go", "cannot execute binary file",
            "no matching manifest for linux/amd64", "no matching manifest for linux/arm64",
            "image architecture", "platform mismatch", "architecture mismatch", "amd64", "arm64",
        ),
        "diagnostics": ("events", "previous_logs", "workload_spec", "node_labels", "recent_changes", "registry_connectivity"),
        "success": ("image_platform_matches_node", "pod_ready", "restart_count_stable"),
    },
    "config_missing": {
        "title": "Missing ConfigMap / configuration reference recovery",
        "terms": ("configmap", "not found", "couldn't find key", "optional: false", "configmap not found", "configuration not found", "missing configuration"),
        "diagnostics": ("events", "workload_spec", "recent_changes"),
        "success": ("config_ref_exists", "pod_ready", "restart_count_stable"),
    },
    "scheduling_capacity": {
        "title": "Scheduling and capacity recovery",
        "terms": ("failedscheduling", "insufficient cpu", "insufficient memory", "unschedulable", "scheduling failed", "insufficient resources"),
        "diagnostics": ("events", "scheduler_constraints", "node_capacity", "quota", "pvc_binding"),
        "success": ("pod_scheduled", "pod_ready"),
    },
    "scheduling_constraints": {
        "title": "Affinity, taint and topology recovery",
        "terms": ("taint", "toleration", "node affinity", "pod affinity", "topology spread", "affinity", "taint"),
        "diagnostics": ("scheduler_constraints", "node_labels", "events", "workload_spec"),
        "success": ("pod_scheduled", "constraint_satisfied"),
    },
    "network_service": {
        "title": "Service discovery and endpoint recovery",
        "terms": ("no endpoints", "connection refused", "no route to host", "service unavailable", "endpoint", "service discovery"),
        "diagnostics": ("service_endpoints", "dns", "network_policy", "mesh_routes", "dependency_topology"),
        "success": ("endpoint_ready", "dependency_reachable", "error_rate_recovered"),
    },
    "dns_cni": {
        "title": "DNS / CNI recovery",
        "terms": ("dns", "coredns", "cni", "networkplugin", "failedcreatepodsandbox", "i/o timeout", "resolution failure"),
        "diagnostics": ("dns", "cni_events", "node_conditions", "network_policy"),
        "success": ("dns_resolves", "pod_sandbox_ready", "pod_ready"),
    },
    "cpu_saturation": {
        "title": "CPU saturation recovery",
        "terms": ("highcpu", "high cpu", "cpu usage", "cpu thrott", "cpu spike", "elevated cpu"),
        "diagnostics": ("pod_metrics", "hpa", "workload_spec", "traffic_baseline", "dependency_latency"),
        "success": ("cpu_below_threshold", "latency_recovered", "error_rate_recovered"),
    },
    "node_pressure": {
        "title": "Node pressure containment",
        "terms": ("diskpressure", "memorypressure", "pidpressure", "notready", "node pressure", "node stress"),
        "diagnostics": ("node_conditions", "node_capacity", "system_pods", "events"),
        "success": ("node_condition_recovered", "workloads_rescheduled"),
    },
    "crash_unknown": {
        "title": "CrashLoop evidence deep dive",
        "terms": ("crashloopbackoff", "back-off restarting", "crashloop", "repeated restarts", "container crash"),
        "diagnostics": ("current_logs", "previous_logs", "events", "workload_spec", "recent_changes", "dependency_topology"),
        "success": ("pod_ready", "restart_count_stable", "business_probe_ok"),
    },
    "rollout_regression": {
        "title": "Recent rollout regression recovery",
        "terms": ("progressdeadlineexceeded", "rollout", "revision", "new replicaset", "post-release", "post-change"),
        "diagnostics": ("recent_changes", "workload_spec", "previous_logs", "events", "dependency_topology"),
        "success": ("rollout_complete", "pod_ready", "business_probe_ok", "error_rate_recovered"),
    },
    "service_selector": {
        "title": "Service selector / EndpointSlice repair",
        "terms": ("no endpoints", "endpointslice", "selector mismatch", "503 service unavailable", "service without endpoints"),
        "diagnostics": ("service_endpoints", "workload_spec", "network_policy", "dependency_topology"),
        "success": ("endpoint_ready", "dependency_reachable", "error_rate_recovered"),
    },
    "pdb_deadlock": {
        "title": "PDB and rollout deadlock recovery",
        "terms": ("disruptionbudget", "pdb", "cannot evict pod", "too many unavailable", "eviction failure"),
        "diagnostics": ("pdb_state", "workload_spec", "events", "node_conditions"),
        "success": ("eviction_allowed", "rollout_complete", "replica_budget_safe"),
    },
    "quota_limit": {
        "title": "Quota / LimitRange admission recovery",
        "terms": ("exceeded quota", "resourcequota", "limitrange", "forbidden: exceeded", "quota shortage"),
        "diagnostics": ("quota", "workload_spec", "node_capacity", "events"),
        "success": ("admission_allowed", "pod_scheduled", "pod_ready"),
    },
    "certificate_expiry": {
        "title": "Certificate and webhook trust recovery",
        "terms": ("x509", "certificate has expired", "tls handshake", "webhook", "certificate expired"),
        "diagnostics": ("current_logs", "events", "certificate_chain", "webhook_status", "dependency_topology"),
        "success": ("tls_handshake_ok", "webhook_available", "error_rate_recovered"),
    },
}


def action_catalog_payload() -> list[dict[str, Any]]:
    return [
        {"id": key, **deepcopy(value), **deepcopy(ACTION_OPERATOR_GUIDANCE.get(key, {}))}
        for key, value in ACTION_CATALOG.items()
    ]


def _flatten_text(*values: Any) -> str:
    parts: list[str] = []

    def visit(value: Any, depth: int = 0):
        if depth > 6:
            return
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() not in {"token", "secret", "password", "authorization"}:
                    visit(item, depth + 1)
        elif isinstance(value, (list, tuple)):
            for item in value[:80]:
                visit(item, depth + 1)
        elif value is not None:
            parts.append(str(value))

    for value in values:
        visit(value)
    return " ".join(parts).lower()


def score_root_causes(alert: dict, diagnosis: dict, context: dict) -> list[dict[str, Any]]:
    """Rank runbooks with a transparent weighted evidence score.

    Alert/user text is weak evidence, status/Events are medium evidence, and
    logs/last termination details are strong evidence. The sigmoid keeps the
    reported confidence stable as the amount of evidence grows.
    """
    sources = [
        ("alert", _flatten_text(alert), 0.7),
        ("diagnosis", _flatten_text(diagnosis.get("root_cause"), diagnosis.get("signals")), 0.9),
        ("pod_status", _flatten_text(context.get("pods"), context.get("pod")), 1.25),
        ("events", _flatten_text(context.get("events")), 1.45),
        ("logs", _flatten_text(context.get("logs"), context.get("previous_logs"), context.get("diagnostics")), 1.8),
    ]
    decisive_text = _flatten_text(
        alert,
        diagnosis,
        context.get("events"),
        context.get("storage"),
        context.get("pod"),
        context.get("pods"),
        context.get("logs"),
        context.get("previous_logs"),
    )
    storage_binding_proven = any(term in decisive_text for term in (
        "unbound immediate persistentvolumeclaims",
        "no persistent volumes available",
        "persistentvolumeclaim is not bound",
        "persistentvolumeclaim pending",
    ))
    oom_proven = any(term in decisive_text for term in (
        "oomkilled",
        "exit code 137",
        "exitcode': 137",
        '"exitcode": 137',
        "last_terminated_reason': 'oomkilled",
        '"last_terminated_reason": "oomkilled',
    ))
    image_arch_proven = any(term in decisive_text for term in (
        "exec format error",
        "no matching manifest for linux/amd64",
        "no matching manifest for linux/arm64",
        "image architecture",
        "platform mismatch",
        "cannot execute binary file",
        "standard_init_linux.go",
    ))
    storage_permission_proven = any(term in decisive_text for term in (
        "permission denied",
        "operation not permitted",
        "read-only file system",
        "can't create directory",
        "cannot create directory",
        "mkdir:",
    ))
    log_unavailable_proven = any(term in decisive_text for term in (
        "current_error",
        "previous_error",
        "previous log unavailable",
        "container not found",
        "pod does not exist",
        "waiting to start",
        "logs unavailable",
    ))
    ranked = []
    for runbook_id, runbook in RUNBOOKS.items():
        matches = []
        raw_score = 0.0
        for source, text, weight in sources:
            hit = [term for term in runbook["terms"] if term in text]
            if hit:
                contribution = weight * min(2.2, 1.0 + 0.28 * (len(hit) - 1))
                raw_score += contribution
                matches.append({"source": source, "terms": hit[:4], "weight": weight})
        # FailedScheduling is only the symptom here. An unbound PVC is a
        # deterministic storage root cause and must outrank generic scheduling.
        if runbook_id == "storage_mount" and storage_binding_proven:
            raw_score += 3.2
            matches.append({
                "source": "kubernetes_storage_state",
                "terms": ["pvc_unbound"],
                "weight": 3.2,
            })
        if runbook_id == "oom" and oom_proven:
            raw_score += 2.8
            matches.append({
                "source": "container_last_state",
                "terms": ["oomkilled_or_exit_137"],
                "weight": 2.8,
            })
        if runbook_id == "crash_unknown" and oom_proven:
            raw_score = max(0.0, raw_score - 1.4)
            matches.append({
                "source": "container_last_state",
                "terms": ["demoted_by_oom_evidence"],
                "weight": -1.4,
            })
        if runbook_id == "image_architecture" and image_arch_proven:
            raw_score += 2.8
            matches.append({
                "source": "runtime_platform_state",
                "terms": ["exec_format_or_manifest_platform_mismatch"],
                "weight": 2.8,
            })
        if runbook_id == "crash_unknown" and image_arch_proven:
            raw_score = max(0.0, raw_score - 1.2)
            matches.append({
                "source": "runtime_platform_state",
                "terms": ["demoted_by_architecture_evidence"],
                "weight": -1.2,
            })
        if runbook_id == "storage_permission" and storage_permission_proven:
            raw_score += 2.6
            matches.append({
                "source": "container_logs",
                "terms": ["write_permission_denied"],
                "weight": 2.6,
            })
        if runbook_id == "crash_unknown" and storage_permission_proven:
            raw_score = max(0.0, raw_score - 1.2)
            matches.append({
                "source": "container_logs",
                "terms": ["demoted_by_storage_permission_evidence"],
                "weight": -1.2,
            })
        if runbook_id == "crash_unknown" and log_unavailable_proven and not storage_binding_proven:
            raw_score += 1.4
            matches.append({
                "source": "log_probe",
                "terms": ["logs_unavailable_need_diagnostic_recreate"],
                "weight": 1.4,
            })
        if matches:
            confidence = 1.0 / (1.0 + math.exp(-(raw_score - 1.65)))
            ranked.append({
                "id": runbook_id,
                "title": runbook["title"],
                "score": round(raw_score, 3),
                "confidence": round(min(0.99, confidence), 3),
                "matched_evidence": matches,
                "diagnostics": list(runbook["diagnostics"]),
                "success_criteria": list(runbook["success"]),
            })
    return sorted(ranked, key=lambda item: (-item["score"], item["id"]))


def _target(alert: dict, diagnosis: dict, context: dict) -> tuple[str, str, str, str, dict]:
    pods = (context.get("pods") or {}).get("pods", []) if isinstance(context.get("pods"), dict) else context.get("pods", [])
    pod = context.get("pod") or (pods[0] if pods else {}) or {}
    workload = pod.get("workload") or {}
    namespace = alert.get("namespace") or pod.get("namespace") or "default"
    workload_type = alert.get("workload_type") or workload.get("kind") or pod.get("workload_kind") or "Deployment"
    workload_name = alert.get("workload_name") or alert.get("deployment") or workload.get("name") or pod.get("workload_name") or ""
    pod_name = alert.get("pod") or pod.get("name") or ""
    return namespace, workload_type, workload_name, pod_name, pod


def _first_container(pod: dict) -> dict:
    containers = pod.get("containers") or []
    return next((item for item in containers if item.get("name")), {})


def _security_group_from_pod(pod: dict) -> int:
    """Prefer the workload runtime group over an existing, possibly wrong fsGroup."""
    for container in pod.get("containers", []) or []:
        sc = container.get("security_context") or container.get("securityContext") or {}
        for key in ("runAsGroup", "run_as_group", "runAsUser", "run_as_user"):
            value = sc.get(key)
            if isinstance(value, int) and value > 0:
                return value
    pod_sc = pod.get("security_context") or pod.get("securityContext") or {}
    for key in ("runAsGroup", "run_as_group", "runAsUser", "run_as_user", "fsGroup", "fs_group"):
        value = pod_sc.get(key)
        if isinstance(value, int) and value > 0:
            return value
    return 1000


def _container_patch_base(container_name: str, container: dict) -> dict[str, Any]:
    """Base fields required when using JSON merge patch on containers lists."""
    patch = {"name": container_name}
    image = str((container or {}).get("image") or "").strip()
    if image:
        patch["image"] = image
    return patch


def _startup_probe_patch(container: dict) -> dict[str, Any]:
    """Generate a valid startupProbe from existing probes to avoid an invalid patch with no handler."""
    handler_keys = ("httpGet", "tcpSocket", "exec", "grpc")
    source = (
        container.get("startupProbe")
        or container.get("startup_probe")
        or container.get("livenessProbe")
        or container.get("liveness_probe")
        or container.get("readinessProbe")
        or container.get("readiness_probe")
        or {}
    )
    if not isinstance(source, dict):
        source = {}
    handler = {key: deepcopy(source[key]) for key in handler_keys if source.get(key)}
    if handler:
        probe: dict[str, Any] = {
            **handler,
            "failureThreshold": max(30, int(source.get("failureThreshold") or source.get("failure_threshold") or 30)),
            "periodSeconds": max(1, int(source.get("periodSeconds") or source.get("period_seconds") or 10)),
        }
        for key in ("timeoutSeconds", "initialDelaySeconds", "successThreshold"):
            if source.get(key) is not None:
                probe[key] = source[key]
        return {"startupProbe": probe}
    return {
        "livenessProbe": {"initialDelaySeconds": max(60, int(os.getenv("AUTO_OPS_PROBE_INITIAL_DELAY_SECONDS", "60")))},
        "readinessProbe": {"initialDelaySeconds": max(30, int(os.getenv("AUTO_OPS_READINESS_INITIAL_DELAY_SECONDS", "30")))},
    }


def _memory_growth(value: str | None) -> str:
    value = str(value or "").strip()
    import re
    match = re.fullmatch(r"(\d+(?:\.\d+)?)(Mi|Gi)", value, re.I)
    if not match:
        return os.getenv("AUTO_OPS_DEFAULT_MEMORY_LIMIT", "1Gi")
    original = float(match.group(1))
    unit = match.group(2)
    amount = original * float(os.getenv("AUTO_OPS_MEMORY_GROWTH_FACTOR", "1.5"))
    # For small containers, multiplying by only 1.5 is often still insufficient; add at least 256Mi to avoid repeated ineffective patches.
    if unit.lower() == "mi":
        amount = max(amount, original + float(os.getenv("AUTO_OPS_MIN_MEMORY_BUMP_MI", "256")))
    if unit.lower() == "gi":
        amount = min(amount, float(os.getenv("AUTO_OPS_MAX_MEMORY_GI", "8")))
    rendered = str(int(amount)) if amount.is_integer() else str(round(amount, 1))
    return rendered + unit


def _storage_evidence_items(context: dict) -> list[dict[str, Any]]:
    items = context.get("storage") or []
    if isinstance(items, dict):
        items = items.get("items") or items.get("storage") or []
    return [item for item in items if isinstance(item, dict)]


def _log_unavailable_evidence(context: dict) -> bool:
    text = _flatten_text(context.get("logs"), context.get("diagnostics"))
    return any(term in text for term in (
        "current_error",
        "previous_error",
        "previous log unavailable",
        "container not found",
        "not found",
        "pod does not exist",
        "waiting to start",
        "logs unavailable",
    ))


def _template_blocker_evidence(context: dict) -> bool:
    """Before recreating a Pod, rule out template or external blockers that a restart cannot fix."""
    text = _flatten_text(
        context.get("events"),
        context.get("storage"),
        context.get("workload"),
        context.get("pod"),
        context.get("logs"),
    )
    blockers = (
        "imagepullbackoff", "errimagepull", "pull access denied", "unauthorized",
        "configmap", "secret not found", "persistentvolumeclaim", "unbound immediate",
        "no persistent volumes available", "failedmount", "failedattachvolume",
        "exceeded quota", "node affinity", "taint", "toleration",
    )
    return any(term in text for term in blockers)


def _first_storage_issue(context: dict) -> dict[str, Any]:
    for item in _storage_evidence_items(context):
        text = _flatten_text(item)
        if (
            item.get("error")
            or str(item.get("pvc_phase") or item.get("phase") or "").lower() in {"pending", "lost"}
            or (item.get("pvc") and not item.get("pv") and not item.get("volume_name"))
            or "not found" in text
            or "no persistent volumes available" in text
        ):
            return item
    return {}


def _storage_quantity(value: Any) -> str:
    text = str(value or "").strip()
    if text and len(text) <= 24:
        return text
    return os.getenv("AUTO_OPS_DEFAULT_PVC_SIZE", "10Gi")


def _pvc_manifest(namespace: str, pvc_name: str, issue: dict[str, Any]) -> dict[str, Any]:
    storage_class = str(issue.get("storage_class") or os.getenv("AUTO_OPS_DEFAULT_STORAGE_CLASS", "")).strip()
    spec: dict[str, Any] = {
        "accessModes": issue.get("access_modes") or [os.getenv("AUTO_OPS_DEFAULT_PVC_ACCESS_MODE", "ReadWriteOnce")],
        "resources": {"requests": {"storage": _storage_quantity(issue.get("requested") or issue.get("storage"))}},
    }
    if storage_class:
        spec["storageClassName"] = storage_class
    return {
        "apiVersion": "v1",
        "kind": "PersistentVolumeClaim",
        "metadata": {
            "name": pvc_name,
            "namespace": namespace,
            "labels": {"app.kubernetes.io/managed-by": "luxyai"},
        },
        "spec": spec,
    }


def _static_pv_manifest(namespace: str, pvc_name: str, issue: dict[str, Any]) -> dict[str, Any]:
    raw_template = os.getenv("AUTO_OPS_STATIC_PV_TEMPLATE_JSON", "").strip()
    if raw_template:
        try:
            import json
            manifest = json.loads(raw_template)
            manifest.setdefault("metadata", {}).setdefault("name", f"pv-{namespace}-{pvc_name}")
            manifest.setdefault("spec", {}).setdefault("claimRef", {"namespace": namespace, "name": pvc_name})
            return manifest
        except Exception:
            return {}
    nfs_server = os.getenv("AUTO_OPS_STATIC_PV_NFS_SERVER", "").strip()
    nfs_base = os.getenv("AUTO_OPS_STATIC_PV_NFS_BASE_PATH", "").strip().rstrip("/")
    storage_class = str(issue.get("storage_class") or os.getenv("AUTO_OPS_STATIC_PV_STORAGE_CLASS", "")).strip()
    allow_local = os.getenv("AUTO_OPS_ALLOW_LOCAL_STATIC_PV", "false").lower() in {"1", "true", "yes", "on"}
    local_base = os.getenv("AUTO_OPS_STATIC_PV_LOCAL_BASE_PATH", "").strip().rstrip("/")
    local_node = str(issue.get("node") or os.getenv("AUTO_OPS_STATIC_PV_LOCAL_NODE", "")).strip()
    if allow_local and local_base and local_node:
        spec: dict[str, Any] = {
            "capacity": {"storage": _storage_quantity(issue.get("requested") or issue.get("capacity"))},
            "accessModes": issue.get("access_modes") or [os.getenv("AUTO_OPS_DEFAULT_PVC_ACCESS_MODE", "ReadWriteOnce")],
            "persistentVolumeReclaimPolicy": os.getenv("AUTO_OPS_STATIC_PV_RECLAIM_POLICY", "Retain"),
            "claimRef": {"namespace": namespace, "name": pvc_name},
            "local": {"path": f"{local_base}/{namespace}/{pvc_name}"},
            "nodeAffinity": {
                "required": {
                    "nodeSelectorTerms": [{
                        "matchExpressions": [{
                            "key": "kubernetes.io/hostname",
                            "operator": "In",
                            "values": [local_node],
                        }]
                    }]
                }
            },
        }
        if storage_class:
            spec["storageClassName"] = storage_class
        return {
            "apiVersion": "v1",
            "kind": "PersistentVolume",
            "metadata": {
                "name": f"pv-{namespace}-{pvc_name}",
                "labels": {"app.kubernetes.io/managed-by": "luxyai", "luxyai.io/local-e2e": "true"},
            },
            "spec": spec,
        }
    if not nfs_server or not nfs_base:
        return {}
    spec: dict[str, Any] = {
        "capacity": {"storage": _storage_quantity(issue.get("requested") or issue.get("capacity"))},
        "accessModes": issue.get("access_modes") or [os.getenv("AUTO_OPS_DEFAULT_PVC_ACCESS_MODE", "ReadWriteOnce")],
        "persistentVolumeReclaimPolicy": os.getenv("AUTO_OPS_STATIC_PV_RECLAIM_POLICY", "Retain"),
        "claimRef": {"namespace": namespace, "name": pvc_name},
        "nfs": {"server": nfs_server, "path": f"{nfs_base}/{namespace}/{pvc_name}"},
    }
    if storage_class:
        spec["storageClassName"] = storage_class
    return {
        "apiVersion": "v1",
        "kind": "PersistentVolume",
        "metadata": {
            "name": f"pv-{namespace}-{pvc_name}",
            "labels": {"app.kubernetes.io/managed-by": "luxyai"},
        },
        "spec": spec,
    }


def _load_json_env(name: str) -> Any:
    raw = os.getenv(name, "").strip()
    if not raw:
        return {}
    try:
        import json
        return json.loads(raw)
    except Exception:
        return {}


def _extract_missing_configmap(context: dict) -> str:
    text = _flatten_text(context)
    patterns = [
        r'configmap\s+"([^"]+)"\s+not\s+found',
        r"configmap\s+'([^']+)'\s+not\s+found",
        r"configmap\s+([a-z0-9.-]+)\s+not\s+found",
        r"couldn't\s+find\s+key\s+[^ ]+\s+in\s+configmap\s+([a-z0-9.-]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return match.group(1).strip()
    for ref in _config_refs_from_context(context).get("config_maps", []):
        if ref and ref.lower() in text and "not found" in text:
            return ref
    return ""


def _config_refs_from_context(context: dict) -> dict[str, list[str]]:
    refs = {"config_maps": [], "secrets": [], "service_accounts": []}

    def add(kind: str, value: Any):
        text = str(value or "").strip()
        if text and text not in refs[kind]:
            refs[kind].append(text)

    def visit_pod_spec(spec: dict):
        add("service_accounts", spec.get("serviceAccountName") or spec.get("service_account"))
        for volume in spec.get("volumes", []) or []:
            add("config_maps", ((volume.get("configMap") or {}).get("name")))
            add("secrets", ((volume.get("secret") or {}).get("secretName")))
        for container in spec.get("containers", []) or []:
            for item in container.get("envFrom", []) or []:
                add("config_maps", ((item.get("configMapRef") or {}).get("name")))
                add("secrets", ((item.get("secretRef") or {}).get("name")))
            for env in container.get("env", []) or []:
                ref = ((env.get("valueFrom") or {}).get("configMapKeyRef") or {})
                add("config_maps", ref.get("name"))
                sref = ((env.get("valueFrom") or {}).get("secretKeyRef") or {})
                add("secrets", sref.get("name"))

    pod = context.get("pod") or {}
    if pod:
        add("service_accounts", pod.get("service_account") or pod.get("serviceAccountName"))
        for volume in pod.get("volumes", []) or []:
            add("config_maps", volume.get("config_map"))
            add("secrets", volume.get("secret"))
    workload = context.get("workload") or {}
    spec = workload.get("spec") or {}
    template_spec = ((spec.get("template") or {}).get("spec") or {})
    if template_spec:
        visit_pod_spec(template_spec)
    diagnostics = context.get("diagnostics") or {}
    for key in ("workload", "pod"):
        value = diagnostics.get(key)
        if isinstance(value, dict):
            visit_pod_spec(((value.get("spec") or {}).get("template") or {}).get("spec") or value.get("spec") or {})
    return refs


def _configmap_manifest_from_template(namespace: str, name: str) -> dict[str, Any]:
    templates = _load_json_env("AUTO_OPS_CONFIGMAP_TEMPLATES_JSON")
    if not isinstance(templates, dict):
        return {}
    candidate = (
        templates.get(f"{namespace}/{name}")
        or templates.get(name)
        or ((templates.get(namespace) or {}).get(name) if isinstance(templates.get(namespace), dict) else None)
    )
    if not isinstance(candidate, dict):
        return {}
    manifest = deepcopy(candidate)
    if "data" in manifest or "binaryData" in manifest:
        manifest = {
            "apiVersion": "v1",
            "kind": "ConfigMap",
            "metadata": {"name": name, "namespace": namespace, "labels": {"app.kubernetes.io/managed-by": "luxyai"}},
            **manifest,
        }
    manifest.setdefault("apiVersion", "v1")
    manifest.setdefault("kind", "ConfigMap")
    manifest.setdefault("metadata", {})
    manifest["metadata"]["name"] = name
    manifest["metadata"]["namespace"] = namespace
    manifest["metadata"].setdefault("labels", {})["app.kubernetes.io/managed-by"] = "luxyai"
    return manifest


def _workload_service_account(context: dict) -> str:
    refs = _config_refs_from_context(context)
    if refs["service_accounts"]:
        return refs["service_accounts"][0]
    pod = context.get("pod") or {}
    return str(pod.get("service_account") or pod.get("serviceAccountName") or "default").strip() or "default"


def _node_architecture(context: dict) -> str:
    node = context.get("node") or {}
    labels = node.get("labels") or node.get("metadata", {}).get("labels") or {}
    arch = labels.get("kubernetes.io/arch") or labels.get("beta.kubernetes.io/arch")
    text = _flatten_text(context.get("events"), context.get("logs"), context.get("pod"))
    if not arch:
        for candidate in ("amd64", "arm64", "arm", "ppc64le", "s390x"):
            if candidate in text:
                arch = candidate
                break
    return str(arch or "").strip().lower()


def _approved_image_replacement(namespace: str, workload_type: str, workload_name: str, container: dict, context: dict) -> str:
    """Return an operator-approved replacement image for image/platform faults.

    The LLM may identify the failure mode, but image replacement must come from
    release history or an explicit platform mapping.  Supported env shape:

    AUTO_OPS_IMAGE_REPLACEMENTS_JSON='{
      "registry/app:arm64": "registry/app:amd64",
      "prod/Deployment/api": {"amd64": "registry/api:stable-amd64"},
      "prod/api": {"replacement": "registry/api:stable"}
    }'
    """
    image = str(container.get("image") or "").strip()
    if not image:
        return ""
    mappings = _load_json_env("AUTO_OPS_IMAGE_REPLACEMENTS_JSON") or _load_json_env("AUTO_OPS_IMAGE_ROLLBACK_MAP_JSON")
    if not isinstance(mappings, dict):
        return ""
    arch = _node_architecture(context)
    keys = [
        image,
        f"{namespace}/{workload_type}/{workload_name}",
        f"{namespace}/{workload_name}",
        workload_name,
    ]
    for key in keys:
        candidate = mappings.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
        if isinstance(candidate, dict):
            for lookup in (arch, "replacement", "stable", "default", "image"):
                value = candidate.get(lookup)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            string_values = [str(value).strip() for value in candidate.values() if isinstance(value, str) and value.strip()]
            unique_values = sorted(set(string_values))
            if len(unique_values) == 1:
                return unique_values[0]
    return ""


def build_remediation_plan(alert: dict, diagnosis: dict, context: dict) -> dict[str, Any]:
    hypotheses = score_root_causes(alert, diagnosis, context)
    namespace, workload_type, workload_name, pod_name, pod = _target(alert, diagnosis, context)
    primary = hypotheses[0] if hypotheses else None
    runbook_id = primary["id"] if primary else "unknown"
    container = _first_container(pod)
    container_name = container.get("name", "")
    changes: list[dict[str, Any]] = []
    patchable = workload_name and str(workload_type).lower() in {"deployment", "statefulset", "daemonset"}
    confidence = float((primary or {}).get("confidence") or 0.0)

    def workload_patch(patch: dict, reason: str):
        changes.append({
            "type": "patch_workload", "namespace": namespace, "workload_type": workload_type,
            "workload_name": workload_name, "patch": patch, "reason": reason,
            "runbook_id": runbook_id, **ACTION_CATALOG["patch_workload"],
        })

    if runbook_id == "storage_mount":
        issue = _first_storage_issue(context)
        issue_text = _flatten_text(issue)
        pvc_name = str(issue.get("pvc") or issue.get("pvc_name") or issue.get("claim") or "").strip()
        missing_pvc = bool(
            pvc_name
            and (
                issue.get("missing") is True
                or "not found" in issue_text
                or "404" in issue_text
                or "does not exist" in issue_text
            )
        )
        phase = str(issue.get("pvc_phase") or issue.get("phase") or "").lower()
        if missing_pvc:
            changes.append({
                "type": "create_pvc", "namespace": namespace, "pvc_name": pvc_name,
                "manifest": _pvc_manifest(namespace, pvc_name, issue),
                "reason": "The Kubernetes API confirmed that the Pod references a non-existent PVC; create a policy-compliant PVC and validate the Pod after dynamic provisioning completes.",
                "runbook_id": runbook_id, **ACTION_CATALOG["create_pvc"],
            })
        elif pvc_name and phase in {"pending", "lost"}:
            pv_manifest = _static_pv_manifest(namespace, pvc_name, issue)
            if pv_manifest:
                changes.append({
                    "type": "create_pv", "namespace": namespace, "pvc_name": pvc_name,
                    "manifest": pv_manifest,
                    "reason": "The Kubernetes API confirmed that the PVC is unbound, and the platform has an approved static-storage template; create a pre-bound PV and verify the PVC reaches Bound.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["create_pv"],
                })

    if primary and confidence >= 0.62 and patchable:
        if runbook_id == "oom" and container_name:
            resources = container.get("resources") or {}
            requests, limits = resources.get("requests") or {}, resources.get("limits") or {}
            workload_patch({"spec": {"template": {"spec": {"containers": [{
                **_container_patch_base(container_name, container),
                "resources": {
                    "requests": {"cpu": requests.get("cpu") or "100m", "memory": requests.get("memory") or "256Mi"},
                    "limits": {"cpu": limits.get("cpu") or "1", "memory": _memory_growth(limits.get("memory"))},
                },
            }]}}}}, "OOM evidence reached the execution threshold: increase the memory limit while preserving the CPU constraint, then verify that OOM events stop after rollout.")
        elif runbook_id == "probe" and container_name:
            workload_patch({"spec": {"template": {"spec": {"containers": [{
                **_container_patch_base(container_name, container), **_startup_probe_patch(container)
            }]}}}}, "Probe/slow-start evidence reached the execution threshold: widen the startupProbe tolerance window and verify the Endpoint becomes Ready.")
        elif runbook_id == "storage_permission":
            fs_group = _security_group_from_pod(pod)
            workload_patch({"spec": {"template": {"spec": {"securityContext": {
                "fsGroup": fs_group, "fsGroupChangePolicy": "OnRootMismatch"
            }}}}}, f"Volume write-permission evidence reached the execution threshold: choose fsGroup={fs_group} based on the container runtime user/group, then recheck mounts and write errors after rollout.")
        elif runbook_id == "storage_mount" and not changes:
            issue = _first_storage_issue(context)
            issue_text = _flatten_text(issue)
            pvc_name = str(issue.get("pvc") or issue.get("pvc_name") or issue.get("claim") or "").strip()
            if pvc_name and ("not found" in issue_text or "404" in issue_text or issue.get("missing") is True):
                changes.append({
                    "type": "create_pvc", "namespace": namespace, "pvc_name": pvc_name,
                    "manifest": _pvc_manifest(namespace, pvc_name, issue),
                    "reason": "The Pod references a non-existent PVC; create a policy-compliant PVC first, then wait for the storage plugin to provision it dynamically and verify the Pod mount.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["create_pvc"],
                })
            elif pvc_name and str(issue.get("pvc_phase") or issue.get("phase") or "").lower() in {"pending", "lost"}:
                pv_manifest = _static_pv_manifest(namespace, pvc_name, issue)
                if pv_manifest:
                    changes.append({
                        "type": "create_pv", "namespace": namespace, "pvc_name": pvc_name,
                        "manifest": pv_manifest,
                        "reason": "The PVC exists but is not bound to a PV, and the platform has a static PV template configured; create a pre-bound PV so the PVC converges to Bound.",
                        "runbook_id": runbook_id, **ACTION_CATALOG["create_pv"],
                    })
        elif runbook_id == "image_auth" and container_name:
            replacement_image = _approved_image_replacement(namespace, workload_type, workload_name, container, context)
            if replacement_image:
                changes.append({
                    "type": "rollback_workload", "namespace": namespace, "workload_type": workload_type,
                    "workload_name": workload_name,
                    "patch": {"spec": {"template": {"spec": {"containers": [{"name": container_name, "image": replacement_image}]}}}},
                    "reason": "Image pulls are failing and an approved image-replacement mapping matched; switch to the stable image first, then verify that the Pod can pull and start successfully.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["rollback_workload"],
                })
            secret_name = os.getenv("DEFAULT_IMAGE_PULL_SECRET", "").strip()
            if secret_name and not changes:
                workload_patch({"spec": {"template": {"spec": {"imagePullSecrets": [{"name": secret_name}]}}}},
                               f"Image-authentication evidence is conclusive: inject the platform-preconfigured imagePullSecret {secret_name}.")
                service_account = _workload_service_account(context)
                if service_account:
                    changes.append({
                        "type": "patch_service_account", "namespace": namespace, "service_account": service_account,
                        "image_pull_secret": secret_name,
                        "patch": {"imagePullSecrets": [{"name": secret_name}]},
                        "reason": f"Bind the platform-approved image credential {secret_name} to ServiceAccount/{service_account} so later Pods using the same account can also pull the image.",
                        "runbook_id": runbook_id, **ACTION_CATALOG["patch_service_account"],
                    })
        elif runbook_id == "image_architecture" and container_name:
            previous_image = str(
                container.get("previous_image")
                or ((context.get("recent_changes") or {}).get("previous_image") if isinstance(context.get("recent_changes"), dict) else "")
                or _approved_image_replacement(namespace, workload_type, workload_name, container, context)
                or ""
            ).strip()
            if previous_image:
                changes.append({
                    "type": "rollback_workload", "namespace": namespace, "workload_type": workload_type,
                    "workload_name": workload_name,
                    "patch": {"spec": {"template": {"spec": {"containers": [{"name": container_name, "image": previous_image}]}}}},
                    "reason": "Evidence shows that the image architecture or runtime platform does not match the node; roll back or switch to a stable image from rollout history or an approved mapping, then verify platform compatibility.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["rollback_workload"],
                })
        elif runbook_id == "config_missing":
            configmap_name = _extract_missing_configmap(context)
            manifest = _configmap_manifest_from_template(namespace, configmap_name) if configmap_name else {}
            if configmap_name and manifest:
                changes.append({
                    "type": "create_configmap", "namespace": namespace, "configmap_name": configmap_name,
                    "manifest": manifest,
                    "reason": f"Kubernetes events confirmed that ConfigMap/{configmap_name} is missing, and the platform has an approved template; restore the configuration and then verify the Pod becomes Ready.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["create_configmap"],
                })
        elif runbook_id == "cpu_saturation":
            current = int((context.get("workload") or {}).get("spec", {}).get("replicas") or 1)
            changes.append({
                "type": "scale_out", "namespace": namespace, "workload_type": workload_type,
                "workload_name": workload_name, "replicas": min(current + 1, int(os.getenv("MAX_PATCH_REPLICAS", "20"))),
                "patch": {"spec": {"replicas": min(current + 1, int(os.getenv("MAX_PATCH_REPLICAS", "20")))}},
                "reason": "CPU saturation evidence reached the execution threshold: add one replica first to restore capacity, then verify latency, error rate, and HPA behavior.",
                "runbook_id": runbook_id, **ACTION_CATALOG["scale_out"],
            })
        elif runbook_id == "rollout_regression" and container_name:
            previous_image = str(
                container.get("previous_image")
                or ((context.get("recent_changes") or {}).get("previous_image") if isinstance(context.get("recent_changes"), dict) else "")
                or ""
            ).strip()
            if previous_image:
                changes.append({
                    "type": "rollback_workload", "namespace": namespace, "workload_type": workload_type,
                    "workload_name": workload_name,
                    "patch": {"spec": {"template": {"spec": {"containers": [{"name": container_name, "image": previous_image}]}}}},
                    "reason": "The recent rollout is strongly correlated with the incident timeline; roll back to the previous immutable image recorded in the evidence and verify the business SLI.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["rollback_workload"],
                })
        elif runbook_id == "service_selector":
            service = context.get("service") or {}
            service_name = service.get("name") or ""
            selector = service.get("recommended_selector") or {}
            if service_name and selector:
                changes.append({
                    "type": "patch_service", "namespace": namespace, "service_name": service_name,
                    "selector": selector, "patch": {"spec": {"selector": selector}},
                    "reason": "Evidence confirms that the Service selector does not match the labels on the healthy Workload.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["patch_service"],
                })
        elif runbook_id == "pdb_deadlock":
            pdb = context.get("pdb") or {}
            if pdb.get("name") and (pdb.get("recommended_max_unavailable") is not None):
                changes.append({
                    "type": "patch_pdb", "namespace": namespace, "pdb_name": pdb.get("name"),
                    "patch": {"spec": {"maxUnavailable": pdb.get("recommended_max_unavailable")}},
                    "reason": "The PDB and replica count have created an eviction deadlock, and the candidate value was calculated from the available-replica budget.",
                    "runbook_id": runbook_id, **ACTION_CATALOG["patch_pdb"],
                })
    if primary and confidence >= 0.72 and not changes and runbook_id == "node_pressure":
        node_name = pod.get("node") or pod.get("node_name") or ""
        if node_name:
            changes.append({
                "type": "cordon_node", "node_name": node_name, "patch": {"spec": {"unschedulable": True}},
                "reason": "Node-pressure evidence is strong: cordon the node first to prevent new Pod scheduling; this action requires human approval.",
                "runbook_id": runbook_id, **ACTION_CATALOG["cordon_node"],
            })
    diagnostic_recreate_needed = (
        runbook_id == "crash_unknown"
        and _log_unavailable_evidence(context)
        and not _template_blocker_evidence(context)
    )
    if primary and not changes and pod_name and (
        (confidence >= 0.72 and runbook_id in {"crash_unknown", "dns_cni"})
        or (confidence >= 0.55 and diagnostic_recreate_needed)
    ):
        changes.append({
            "type": "recreate_pod", "namespace": namespace, "pod_name": pod_name,
            "workload_type": workload_type, "workload_name": workload_name,
            "reason": (
                "Log probes are unavailable, and no template-level blockers such as PVC, image, ConfigMap, or scheduling issues were found; "
                "diagnostically recreate the single controller-managed unhealthy Pod first, then recollect current/previous logs, Events, and Ready status."
                if diagnostic_recreate_needed else
                "Root-cause evidence collection is complete, but no template-level safe patch was found; recreate one controller-managed unhealthy Pod to rule out transient node or sandbox faults."
            ),
            "runbook_id": runbook_id, **ACTION_CATALOG["recreate_pod"],
        })

    diagnostics = list((primary or {}).get("diagnostics") or ["current_logs", "previous_logs", "events", "workload_spec", "service_endpoints", "storage_chain"])
    steps = [
        {"id": probe, "title": diagnostic_title(probe), "description": diagnostic_description(probe), "status": "pending"}
        for probe in diagnostics
    ]
    evidence_gap = "" if changes else "There is not yet enough strong evidence about the root cause, target Workload state, or a rollback-safe patch to prove that changing the template is safer than continuing diagnosis."
    if not changes and runbook_id == "storage_mount":
        issue = _first_storage_issue(context)
        pvc_name = str(issue.get("pvc") or issue.get("pvc_name") or issue.get("claim") or "").strip()
        if pvc_name and str(issue.get("pvc_phase") or issue.get("phase") or "").lower() in {"pending", "lost"}:
            evidence_gap = (
                f"PVC {namespace}/{pvc_name} is not bound to a PV, but the platform has not configured AUTO_OPS_STATIC_PV_TEMPLATE_JSON "
                "or AUTO_OPS_STATIC_PV_NFS_SERVER/AUTO_OPS_STATIC_PV_NFS_BASE_PATH, so it is not safe to create a static PV."
            )
    if not changes and runbook_id == "config_missing":
        configmap_name = _extract_missing_configmap(context)
        if configmap_name:
            evidence_gap = (
                f"Events confirm that ConfigMap {namespace}/{configmap_name} is missing, but the platform does not have a matching template in "
                "AUTO_OPS_CONFIGMAP_TEMPLATES_JSON; register an approved configuration template before attempting recovery."
            )
    if not changes and runbook_id == "image_architecture":
        evidence_gap = (
            "Evidence of an image-architecture or runtime-platform mismatch was found, but no previous stable image or approved image mapping was available. "
            "Preserve the revision/image digest in release governance, or register the application's amd64/arm64 image mapping in the knowledge base or Skill."
        )
    return {
        "engine": "EvidenceRunbookEngine/v1",
        "runbook_id": runbook_id,
        "hypotheses": hypotheses[:5],
        "diagnostic_actions": diagnostics,
        "steps": steps,
        "changes": changes,
        "target": {
            "namespace": namespace, "workload_type": workload_type, "workload_name": workload_name, "pod_name": pod_name,
        },
        "decision": "ready_for_approval" if changes else "evidence_collection_required",
        "evidence_gap": evidence_gap,
        "reason": (
            "A remediation candidate met the evidence threshold and passed the action allowlist."
            if changes else
            "The current evidence is not sufficient to prove that one change is better than the alternatives; run the diagnostic probes first and replan automatically afterward."
        ),
        "success_criteria": list((primary or {}).get("success_criteria") or ["pod_ready", "business_probe_ok"]),
        "action_catalog": action_catalog_payload(),
    }


def diagnostic_title(probe: str) -> str:
    return {
        "current_logs": "Read current container logs", "previous_logs": "Read previous exit logs", "events": "Analyze Kubernetes Events",
        "workload_spec": "Review the Workload template", "pod_metrics": "Check Pod resource metrics", "node_pressure": "Check node pressure",
        "node_conditions": "Check node health conditions", "node_capacity": "Review node capacity", "system_pods": "Check node system components",
        "service_endpoints": "Review Service and Endpoints", "dns": "Validate DNS resolution path", "network_policy": "Analyze NetworkPolicy",
        "mesh_routes": "Check Service Mesh routes", "dependency_topology": "Trace the CMDB dependency chain", "storage_chain": "Check PVC/PV/StorageClass",
        "node_storage": "Check node and CSI storage", "csi_status": "Check CSI component status", "pod_security_context": "Review runtime user and volume permissions",
        "image_pull_secrets": "Review image credential references", "registry_connectivity": "Validate image registry connectivity", "scheduler_constraints": "Analyze scheduling constraints",
        "node_labels": "Review node labels", "quota": "Check ResourceQuota", "pvc_binding": "Check PVC binding", "hpa": "Check HPA status",
        "traffic_baseline": "Compare traffic baseline", "dependency_latency": "Analyze dependency latency", "cni_events": "Analyze CNI events",
        "recent_changes": "Correlate recent changes", "workload_spec": "Review the Workload template", "registry_connectivity": "Validate image registry connectivity",
        "pdb_state": "Check PodDisruptionBudget", "certificate_chain": "Validate certificate chain and expiration",
        "webhook_status": "Check admission webhook", "hpa": "Check HPA status", "config_ref_exists": "Check whether the configuration reference exists",
    }.get(probe, probe.replace("_", " ").title())


def diagnostic_description(probe: str) -> str:
    return {
        "current_logs": "Read the current container logs of the target Pod and extract stack traces, timeouts, and dependency failures.",
        "previous_logs": "Read the --previous logs, exit code, and lastState to distinguish OOM, crashes, and probe-triggered kills.",
        "events": "Aggregate scheduling, image, mount, probe, and sandbox events along a timeline.",
        "workload_spec": "Read the real template and inspect image, resources, probes, environment-variable references, scheduling, and security context.",
        "service_endpoints": "Review selector, EndpointSlice, and Ready endpoints to identify traffic black holes.",
        "storage_chain": "Inspect binding, capacity, and permissions along the Pod volume -> PVC -> PV -> StorageClass/CSI chain.",
        "scheduler_constraints": "Cross-check requests, quota, affinity, taints/tolerations, and topology spread.",
        "dependency_topology": "Use CMDB, Kafka, and database call relationships to judge upstream and downstream impact.",
        "recent_changes": "Correlate Deployment revision, image digest, ConfigMap version, and incident start time to decide whether rollback is needed.",
        "pdb_state": "Review expectedPods, currentHealthy, disruptionsAllowed, and Workload replica count to detect eviction deadlocks.",
        "quota": "Review ResourceQuota, LimitRange, requests/limits, and admission-failure events.",
        "config_ref_exists": "Read the ConfigMap/Secret names referenced by the Workload and confirm the missing object and approved recovery template.",
        "certificate_chain": "Read certificate expiration, SAN, issuer, and trust chain without exporting private keys.",
        "webhook_status": "Check the Webhook Service, Endpoint, CABundle, failurePolicy, and timeout events.",
    }.get(probe, f"Run {diagnostic_title(probe)} and use the result as evidence for the next round of root-cause scoring.")


def validate_change(change: dict) -> tuple[bool, str]:
    action = str(change.get("type") or "")
    if action not in ACTION_CATALOG:
        return False, f"unsupported remediation action: {action}"
    if ACTION_CATALOG[action]["risk"] == "high" and not change.get("human_approved"):
        return False, f"{action} is high risk and requires explicit human approval"
    return True, ""
