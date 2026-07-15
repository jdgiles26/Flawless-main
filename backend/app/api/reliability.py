"""SLO, error budget, and application release governance APIs."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
import re
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Request
import httpx
import yaml

from backend.app.domain.slo import evaluate_error_budget
from backend.app.schemas.reliability import ApprovalRequest, ObjectiveRequest, ReleaseRequest
from backend.app.services.reliability_store import ReliabilityStore


GateEvaluator = Callable[..., dict[str, Any]]
ReleaseSubmitter = Callable[[dict[str, Any], str], Awaitable[dict[str, Any]]]


@dataclass
class ReliabilityDependencies:
    store: ReliabilityStore
    gate_evaluator: GateEvaluator
    submit_release: ReleaseSubmitter


ALLOWED_RELEASE_KINDS = {"Deployment", "StatefulSet", "DaemonSet"}
MUTABLE_IMAGE_TAGS = {"", "latest", "main", "master", "dev", "snapshot"}


def _image_is_immutable(image: str) -> bool:
    image = str(image or "").strip()
    if not image:
        return False
    if "@sha256:" in image:
        return True
    tail = image.rsplit("/", 1)[-1]
    tag = tail.rsplit(":", 1)[-1].lower() if ":" in tail else ""
    return tag not in MUTABLE_IMAGE_TAGS


def _validate_release_manifest(raw_yaml: str, request: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        documents = [item for item in yaml.safe_load_all(raw_yaml) if item is not None]
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=422, detail=f"Failed to parse YAML: {exc}") from exc
    if len(documents) != 1 or not isinstance(documents[0], dict):
        raise HTTPException(status_code=422, detail="Each release submission must include exactly one Kubernetes workload YAML.")
    manifest = documents[0]
    kind = str(manifest.get("kind") or "")
    api_version = str(manifest.get("apiVersion") or "")
    metadata = manifest.get("metadata") or {}
    spec = manifest.get("spec") or {}
    if kind not in ALLOWED_RELEASE_KINDS or api_version != "apps/v1":
        raise HTTPException(status_code=422, detail="Release governance currently accepts only apps/v1 Deployment, StatefulSet, or DaemonSet resources.")
    name = str(metadata.get("name") or "")
    namespace = str(metadata.get("namespace") or request.get("namespace") or "default")
    if not re.fullmatch(r"[a-z0-9]([-a-z0-9.]*[a-z0-9])?", name or ""):
        raise HTTPException(status_code=422, detail="YAML metadata.name is not a valid Kubernetes resource name.")
    if namespace != request.get("namespace"):
        raise HTTPException(status_code=422, detail="The YAML namespace must match the selected release scope.")
    if request.get("release_mode") == "existing":
        if kind != request.get("workload_kind") or name != request.get("workload_name"):
            raise HTTPException(status_code=422, detail="The YAML kind and name must exactly match the selected workload.")
    pod_spec = (((spec.get("template") or {}).get("spec")) or {})
    forbidden = [key for key in ("hostNetwork", "hostPID", "hostIPC") if pod_spec.get(key)]
    if forbidden:
        raise HTTPException(status_code=422, detail=f"Production releases may not enable: {', '.join(forbidden)}")
    if pod_spec.get("serviceAccountName") and pod_spec.get("automountServiceAccountToken", True):
        raise HTTPException(status_code=422, detail="When a workload uses a ServiceAccount, it must explicitly set automountServiceAccountToken=false or go through a security exception approval.")
    for volume in pod_spec.get("volumes") or []:
        if isinstance(volume, dict) and volume.get("hostPath"):
            raise HTTPException(status_code=422, detail="hostPath volumes are not allowed in production releases.")
    containers = list(pod_spec.get("containers") or []) + list(pod_spec.get("initContainers") or [])
    if not containers:
        raise HTTPException(status_code=422, detail="The YAML must define at least one container.")
    for container in containers:
        if not isinstance(container, dict) or not container.get("name") or not container.get("image"):
            raise HTTPException(status_code=422, detail="Each container must include both name and image.")
        if not _image_is_immutable(str(container.get("image"))):
            raise HTTPException(status_code=422, detail=f"Container {container.get('name')} must use an immutable image tag or sha256 digest.")
        security = container.get("securityContext") or {}
        if security.get("privileged") or security.get("allowPrivilegeEscalation") is True:
            raise HTTPException(status_code=422, detail=f"Container {container.get('name')} may not enable privileged or allowPrivilegeEscalation.")
        add_caps = set(((security.get("capabilities") or {}).get("add")) or [])
        if add_caps & {"SYS_ADMIN", "NET_ADMIN", "SYS_PTRACE", "ALL"}:
            raise HTTPException(status_code=422, detail=f"Container {container.get('name')} requests a prohibited Linux capability.")
    safe_manifest = {
        "apiVersion": "apps/v1",
        "kind": kind,
        "metadata": {
            "name": name,
            "namespace": namespace,
            "labels": metadata.get("labels") or {},
            "annotations": metadata.get("annotations") or {},
        },
        "spec": spec,
    }
    validation = {
        "policy": "ProductionWorkloadManifest/v1",
        "kind": kind,
        "name": name,
        "namespace": namespace,
        "containers": len(containers),
        "immutable_images": True,
        "privileged": False,
        "host_path": False,
        "digest": hashlib.sha256(yaml.safe_dump(safe_manifest, sort_keys=True).encode()).hexdigest()[:16],
    }
    return safe_manifest, validation


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _percent(value: Any, digits: int = 1) -> str:
    return f"{_safe_float(value) * 100:.{digits}f}%"


def _risk_label(score: Any) -> str:
    value = _safe_float(score)
    if value >= 0.82:
        return "Very high"
    if value >= 0.62:
        return "High"
    if value >= 0.38:
        return "Medium"
    return "Low"


def _release_strategy_text(gate: dict[str, Any]) -> str:
    strategy = gate.get("selected_strategy") or {}
    if strategy:
        return (
            f"Recommended canary rollout: start with {_percent(strategy.get('first_ratio'))}, increase by at most {_percent(strategy.get('step_ratio'))} per batch, "
            f"and do not exceed {_percent(strategy.get('max_ratio'))}; observe each batch for {strategy.get('observation_window_min', 20)} minutes, "
            f"with an estimated {strategy.get('batches', 1)} batches to complete."
        )
    envelope = gate.get("safety_envelope") or {}
    return (
        "No candidate canary strategy currently falls within the safety envelope. Start with a manually controlled canary or shadow validation under 1%, "
        f"keep the initial ratio below {_percent(envelope.get('first_ratio_limit', 0.01))}, "
        "and re-evaluate only after error rate, P99 latency, restarts, and downstream errors have stabilized."
    )


def _blast_text(gate: dict[str, Any]) -> str:
    blast = gate.get("blast_radius") or {}
    radius = blast.get("blast_radius") or {}
    services = len(radius.get("impacted_services") or [])
    pods = len(radius.get("impacted_pods") or [])
    dependencies = len(radius.get("related_dependencies") or [])
    paths = len(radius.get("critical_paths") or [])
    return (
        f"Impact level {blast.get('impact_level', 'unknown')}, amplification factor {blast.get('amplification_factor', 0)}, "
        f"and {paths} critical paths; estimated impact includes {services} services, {pods} pods, and {dependencies} shared dependencies."
    )


def _release_images(payload: dict[str, Any], manifest: dict[str, Any] | None) -> list[str]:
    images: list[str] = []
    if payload.get("image"):
        images.append(str(payload["image"]))
    pod_spec = (((manifest or {}).get("spec") or {}).get("template") or {}).get("spec") or {}
    for container in list(pod_spec.get("containers") or []) + list(pod_spec.get("initContainers") or []):
        if isinstance(container, dict) and container.get("image"):
            images.append(str(container["image"]))
    seen = set()
    return [image for image in images if not (image in seen or seen.add(image))]


def _scanner_risk_level(scan: dict[str, Any]) -> str:
    critical = int(_safe_float(scan.get("critical") or scan.get("critical_count") or scan.get("critical_vulnerabilities")))
    high = int(_safe_float(scan.get("high") or scan.get("high_count") or scan.get("high_vulnerabilities")))
    if critical > 0:
        return "critical"
    if high > 0:
        return "high"
    return str(scan.get("risk_level") or scan.get("severity") or "low").lower()


async def _scan_release_images(images: list[str]) -> dict[str, Any]:
    if not images:
        return {"status": "not_applicable", "summary": "No image changes were detected for this release.", "images": []}
    scanner_url = os.getenv("IMAGE_SECURITY_SCAN_URL", "").strip()
    if not scanner_url:
        return {
            "status": "not_configured",
            "summary": "No image scanning service is configured; immutable tag/digest and workload security policy checks were completed, but no vulnerability database scan was performed.",
            "images": images,
            "risk_level": "unknown",
        }
    try:
        verify = os.getenv("IMAGE_SECURITY_SCAN_VERIFY_SSL", "true").lower() not in {"0", "false", "no"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0), verify=verify) as client:
            response = await client.post(scanner_url, json={"images": images})
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return {
            "status": "degraded",
            "summary": f"The image scanning service is temporarily unavailable: {type(exc).__name__}: {exc}. Only offline security validation results are available for this release.",
            "images": images,
            "risk_level": "unknown",
        }
    if isinstance(data, dict):
        risk_level = _scanner_risk_level(data)
        return {
            "status": str(data.get("status") or "ok"),
            "summary": str(data.get("summary") or data.get("message") or f"Image scan completed with risk level {risk_level}."),
            "images": data.get("images") or images,
            "risk_level": risk_level,
            "critical": data.get("critical") or data.get("critical_count") or 0,
            "high": data.get("high") or data.get("high_count") or 0,
            "raw": data,
        }
    return {"status": "ok", "summary": "Image scan completed.", "images": images, "risk_level": "unknown", "raw": data}


def _image_report(payload: dict[str, Any], manifest_validation: dict[str, Any] | None, image_scan: dict[str, Any] | None) -> str:
    scan = image_scan or {}
    scan_summary = scan.get("summary")
    if payload.get("change_channel") == "emergency_recovery" and payload.get("emergency_action") == "restart_component":
        return "This is a controlled restart with no image change; the current image and generation will be recorded before execution."
    image = payload.get("image")
    if manifest_validation:
        return (
            f"The YAML passed production security validation and includes {manifest_validation.get('containers', 0)} containers; "
            f"all images are immutable, and no privileged mode, hostPath, or high-risk capabilities were detected; validation fingerprint {manifest_validation.get('digest')}."
            f"{' ' + scan_summary if scan_summary else ''}"
        )
    if image:
        return (
            f"Image {image} passed the immutability check. Without a complete YAML submission, the platform can validate only the image format; "
            "submit the desired-state YAML as well to validate probes, resource limits, ServiceAccount usage, and security context."
            f"{' ' + scan_summary if scan_summary else ''}"
        )
    return "No image changes were detected; this release primarily changes configuration or the workload's desired state."


def _build_release_report(
    payload: dict[str, Any],
    gate: dict[str, Any],
    budget: dict[str, Any],
    manifest_validation: dict[str, Any] | None,
    image_scan: dict[str, Any] | None,
) -> dict[str, Any]:
    """Generate a release risk summary for operators without including code snippets."""
    risk = gate.get("risk") or {}
    envelope = gate.get("safety_envelope") or {}
    verdict = str(gate.get("verdict") or "manual_review")
    is_emergency = payload.get("change_channel") == "emergency_recovery"
    budget_state = budget.get("state", "unknown")
    diff_risk = _safe_float(risk.get("diff_risk"))
    amp = _safe_float(risk.get("amplification_factor"))
    decision_map = {
        "pass": "Proceed with the recommended canary rollout",
        "hold": "Pause further canary expansion and continue observing",
        "rollback": "Rollback threshold reached",
        "blocked": "Regular release blocked",
        "manual_approval": "Manual review required before a very small canary rollout",
        "manual_review": "Manual review required",
        "emergency_review": "Emergency recovery requires manual review before execution",
    }
    short_risks = [
        f"In the short term, rollout stalls, insufficient Ready replicas, rising error rates, or increased P99 latency may occur; current diff risk is {_risk_label(diff_risk)} ({diff_risk:.2f}).",
        f"The topology amplification factor is {amp:.2f}; if shared middleware or upstream traffic exists on critical paths, failures can propagate through dependent chains.",
    ]
    if budget.get("freeze_changes") and not is_emergency:
        short_risks.insert(0, "The error budget is exhausted, so regular releases are immediately frozen.")
    if is_emergency:
        short_risks.insert(0, "Emergency recovery is only for restoring stability; if it fails, stop immediately and switch to rollback or manual intervention.")
    long_risks = [
        "Without a complete YAML, observation window, and rollback evidence, it will be difficult to determine later which configuration change altered the risk profile.",
        "If mutable image tags continue to be used, or resource boundaries or readinessProbe remain missing, future releases will be more likely to fail unpredictably.",
    ]
    recommendations = [
        _release_strategy_text(gate),
        "During rollout, closely monitor error rate, P95/P99 latency, pod restarts, Ready replicas, CPU throttling, downstream errors, and shared dependencies such as Kafka or databases.",
        "If any core metric crosses the pause threshold, stop expanding the canary; if it crosses the rollback threshold, execute rollback or use the emergency recovery path.",
    ]
    if verdict in {"blocked", "manual_approval", "manual_review"}:
        recommendations.insert(0, "Do not proceed directly to a full rollout; first complete the supporting evidence or run only a small manually verified traffic test.")
    if is_emergency:
        recommendations.insert(0, "Before execution, confirm the impact scope, rollback conditions, and validation criteria; after execution, verify the recovery criteria.")
    evidence = [
        f"SLO target {budget.get('target_percent', 99.9)}%, error budget state {budget_state}, remaining budget {_percent(budget.get('remaining_ratio'))}, burn rate {budget.get('burn_rate', 0)}x.",
        f"Gate algorithm {((gate.get('algorithm') or {}).get('name') or 'SemanticGrayReleaseGate')}, {len(gate.get('candidate_strategies') or [])} candidate canary strategies, safety-envelope budget limit {_percent(envelope.get('budget_cost_limit'))}.",
        _blast_text(gate),
        _image_report(payload, manifest_validation, image_scan),
        gate.get("reason") or "The gate did not return a detailed reason and has been handled as a manual review.",
    ]
    return {
        "headline": (
            f"{decision_map.get(verdict, 'Manual review required')}: {payload.get('service')} "
            f"{payload.get('workload_kind')}/{payload.get('workload_name')}"
        ),
        "risk_decision": (
            f"{decision_map.get(verdict, 'Manual review required')}. Risk level {_risk_label(max(diff_risk, amp / 3.0))}; "
            f"this is based on error budget, candidate canary strategies, blast radius, historical risk, and current observed diff."
        ),
        "allowed_scope": _release_strategy_text(gate),
        "blast_radius": _blast_text(gate),
        "image_check": _image_report(payload, manifest_validation, image_scan),
        "image_scan": image_scan or {},
        "short_term_risks": short_risks,
        "long_term_risks": long_risks,
        "recommendations": recommendations,
        "evidence": evidence,
    }


def _actor(request: Request) -> str:
    return str(request.headers.get("x-auth-request-user") or request.headers.get("x-forwarded-user") or (request.client.host if request.client else "unknown"))[:120]


def build_reliability_router(deps: ReliabilityDependencies) -> APIRouter:
    router = APIRouter(tags=["SRE reliability governance"])

    @router.get("/api/reliability/summary")
    async def reliability_summary():
        objectives = deps.store.objectives()
        budgets = [item["budget"] for item in objectives]
        return {
            "status": "ok",
            "objectives": objectives,
            "summary": {
                "total": len(budgets),
                "healthy": sum(1 for item in budgets if item["state"] == "healthy"),
                "at_risk": sum(1 for item in budgets if item["state"] == "at_risk"),
                "exhausted": sum(1 for item in budgets if item["state"] == "exhausted"),
                "changes_frozen": sum(1 for item in budgets if item["freeze_changes"]),
            },
            "policy": "When the error budget is exhausted, new features and regular releases are frozen; only emergency changes that restore stability are allowed.",
            "audit_storage": deps.store.storage_status(),
        }

    @router.post("/api/reliability/objectives")
    async def upsert_objective(req: ObjectiveRequest):
        try:
            return {"status": "ok", "objective": deps.store.upsert_objective(req.model_dump())}
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @router.get("/api/releases")
    async def list_releases():
        return {"status": "ok", "releases": deps.store.releases()}

    @router.post("/api/releases")
    async def create_release(req: ReleaseRequest, request: Request):
        payload = req.model_dump()
        is_emergency = payload["change_channel"] == "emergency_recovery"
        if is_emergency:
            if payload["release_mode"] != "existing":
                raise HTTPException(status_code=422, detail="The emergency recovery path can only operate on an existing workload and cannot be used to release a new application.")
            if payload["emergency_action"] not in {"rollback", "restore_config", "restart_component"}:
                raise HTTPException(status_code=422, detail="Choose rollback to a stable version, restore configuration, or restart the failed component.")
            if len(payload["emergency_reason"].strip()) < 8:
                raise HTTPException(status_code=422, detail="Emergency recovery requires a description of the failure symptoms, business impact, or recovery reason with at least 8 characters.")
        manifest = None
        manifest_validation = None
        if payload["manifest_yaml"].strip():
            manifest, manifest_validation = _validate_release_manifest(payload.pop("manifest_yaml"), payload)
            payload["workload_kind"] = manifest["kind"]
            payload["workload_name"] = manifest["metadata"]["name"]
            payload["namespace"] = manifest["metadata"]["namespace"]
            if payload["release_mode"] == "existing":
                payload["patch"] = {"spec": manifest["spec"]}
        elif payload["release_mode"] == "new":
            raise HTTPException(status_code=422, detail="Creating a new workload requires a complete YAML submission.")
        elif not payload["workload_name"]:
            raise HTTPException(status_code=422, detail="Select an existing workload, or switch to new and submit YAML.")
        elif not payload["image"] and not payload["patch"] and not (is_emergency and payload["emergency_action"] == "restart_component"):
            raise HTTPException(status_code=422, detail="Releasing an existing workload requires an immutable image or a complete desired-state YAML submission to create an auditable change.")
        if is_emergency and payload["emergency_action"] == "rollback" and not payload["image"]:
            raise HTTPException(status_code=422, detail="Rollback requires the previously verified stable image version or digest.")
        if is_emergency and payload["emergency_action"] == "restore_config" and not (manifest or payload["patch"]):
            raise HTTPException(status_code=422, detail="Restoring accidentally deleted configuration requires a validated desired-state YAML submission.")
        if is_emergency and payload["emergency_action"] == "restart_component":
            payload["image"] = ""
            payload["patch"] = {}
        if payload["image"]:
            if not _image_is_immutable(payload["image"]):
                raise HTTPException(status_code=422, detail="Production releases must use immutable image versions; latest/main/master/dev are not allowed.")
            if not payload["container_name"]:
                raise HTTPException(status_code=422, detail="Image-based releases must specify container_name.")
        image_scan = await _scan_release_images(_release_images(payload, manifest))
        objective = deps.store.objective_for(payload["service"], payload["cluster"], payload["namespace"])
        budget = evaluate_error_budget(objective)
        runtime = {
            "remaining_budget": budget["remaining_ratio"],
            "budget_burn_rate": budget["burn_rate"],
            "runtime_pressure": min(1.0, budget["burn_rate"] / 4.0),
            "release_state": "frozen" if budget["freeze_changes"] else "pending",
        }
        change = {
            "target": f"{payload['workload_kind']}/{payload['workload_name']}",
            "kind": payload["workload_kind"],
            "summary": payload["change_summary"],
            "operator": (
                f"emergency_{payload['emergency_action']}"
                if is_emergency else
                "version_replace" if payload["image"] else "config_replace"
            ),
            "selected": {
                "id": f"{payload['cluster']}:{payload['namespace']}:{payload['workload_kind']}:{payload['workload_name']}",
                "type": "workload",
                "title": f"{payload['workload_kind']}/{payload['workload_name']}",
                "category": "application",
            },
        }
        try:
            gate = deps.gate_evaluator(change, payload["graph"], runtime, payload["history"], payload["candidates"], payload["observation"])
        except Exception as exc:
            gate = {
                "status": "degraded",
                "verdict": "manual_review",
                "action": "human_approval",
                "reason": f"Risk gate degraded: {type(exc).__name__}: {exc}. Manually verify topology, SLO budget, and the rollback plan before approving.",
                "risk": {"risk_score": 0.62, "risk_level": "medium"},
                "algorithm": {"name": "SemanticGrayReleaseGate", "fallback": True},
            }
        if budget["freeze_changes"] and not is_emergency:
            gate = {
                **gate,
                "verdict": "blocked",
                "action": "freeze_change",
                "reason": budget["freeze_reason"],
            }
        elif _scanner_risk_level(image_scan) in {"critical", "high"} and not is_emergency:
            gate = {
                **gate,
                "verdict": "blocked",
                "action": "block_image_risk",
                "reason": f"Image security scan failed: {image_scan.get('summary') or image_scan.get('risk_level')}",
            }
        elif is_emergency:
            gate = {
                **gate,
                "verdict": "emergency_review",
                "action": "break_glass_approval",
                "reason": (
                    "The emergency recovery path exempts only the error-budget freeze; it does not exempt YAML security validation, manual approval, auditing, or recovery verification."
                    f" Action: {payload['emergency_action']}; reason: {payload['emergency_reason'].strip()}"
                ),
                "emergency": True,
            }
        status = "blocked" if gate.get("verdict") in {"blocked", "rollback"} else "awaiting_approval"
        release_report = _build_release_report(payload, gate, budget, manifest_validation, image_scan)
        try:
            release = deps.store.add_release({
                **payload,
                "manifest": manifest,
                "manifest_validation": manifest_validation,
                "status": status,
                "gate": gate,
                "report": release_report,
                "error_budget": budget,
                "submitted_by": _actor(request),
                "emergency_audit": {
                    "enabled": is_emergency,
                    "action": payload["emergency_action"],
                    "reason": payload["emergency_reason"].strip(),
                    "budget_freeze_bypassed": bool(is_emergency and budget["freeze_changes"]),
                },
            })
        except OSError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Unable to write release audit state. Check whether RELIABILITY_STORE_PATH is mounted as a writable directory. "
                    f"Current error: {type(exc).__name__}: {exc}"
                ),
            ) from exc
        return {"status": "ok", "release": release}

    @router.post("/api/releases/{release_id}/approve")
    async def approve_release(release_id: str, req: ApprovalRequest, request: Request):
        release = deps.store.release(release_id)
        if not release:
            raise HTTPException(status_code=404, detail="Release request does not exist.")
        if not req.confirm:
            raise HTTPException(status_code=409, detail="Approval requires explicit confirmation of the risk.")
        is_emergency = release.get("change_channel") == "emergency_recovery"
        if (release.get("error_budget") or {}).get("freeze_changes") and not is_emergency:
            raise HTTPException(status_code=409, detail="The error budget is exhausted and releases are frozen; restore stability first or use a separate emergency change process.")
        if (release.get("gate") or {}).get("verdict") in {"blocked", "rollback"} and not is_emergency:
            raise HTTPException(status_code=409, detail="The release gate has blocked this release and it cannot be approved.")
        if is_emergency and len(req.comment.strip()) < 8:
            raise HTTPException(status_code=422, detail="Emergency recovery approval requires a review comment of at least 8 characters.")
        updated = deps.store.update_release(
            release_id,
            status="approved",
            approved_by=_actor(request),
            approval_comment=req.comment,
            break_glass_approved=is_emergency,
        )
        return {"status": "ok", "release": updated}

    @router.post("/api/releases/{release_id}/execute")
    async def execute_release(release_id: str, request: Request):
        release = deps.store.release(release_id)
        if not release:
            raise HTTPException(status_code=404, detail="Release request does not exist.")
        if release.get("status") != "approved":
            raise HTTPException(status_code=409, detail="A release must first pass the gate and be manually approved.")
        if (release.get("error_budget") or {}).get("freeze_changes") and release.get("change_channel") != "emergency_recovery":
            raise HTTPException(status_code=409, detail="The error budget is exhausted, so release execution is not allowed.")
        job = await deps.submit_release(release, _actor(request))
        updated = deps.store.update_release(release_id, status="executing", ops_job_id=job.get("id"), execution=job)
        return {"status": "accepted", "release": updated, "job": job}

    return router
