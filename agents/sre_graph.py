"""
SRE Graph — Core Orchestration Engine (Localized Edition)

Changes:
  - Uses a local LLM (Ollama/vLLM/LocalAI) for AI diagnosis instead of rule matching
  - Uses self-hosted LangFuse for end-to-end tracing
  - Calls k8s-mcp-server through the MCP client (no longer uses fake data)
  - Certificate verification is controlled by OUTBOUND_VERIFY_SSL; in production, enable it and configure the corporate CA
"""
import os
import json
import uuid
import traceback
from typing import TypedDict, Any, Literal

import httpx
from dotenv import load_dotenv
from langgraph.graph import StateGraph, END

from agents.aiops_observability import (
    end_observation,
    estimate_llm_cost_usd,
    flush as flush_observability,
    langfuse_status,
    new_trace_id,
    observation_id,
    quality_score_from_diagnosis,
    redact_sensitive as _redact_sensitive,
    score_observation,
    start_generation,
    start_span,
    start_trace,
    update_trace,
)
from agents.llm_client import get_llm
from agents.remediation_engine import ACTION_CATALOG, build_remediation_plan, expert_steps_from_diagnosis

load_dotenv()

# ============================================================
# Internal service endpoints
# ============================================================
HEALING_AGENT_URL = os.getenv("HEALING_AGENT_URL", "http://localhost:8101/a2a/tasks")
INCIDENT_AGENT_URL = os.getenv("INCIDENT_AGENT_URL", "http://localhost:8102/a2a/tasks")
POSTMORTEM_AGENT_URL = os.getenv("POSTMORTEM_AGENT_URL", "http://localhost:8103/a2a/tasks")

# MCP Server endpoint (can be stdio locally or an SSE endpoint inside Kubernetes)
# HTTP mode is convenient here for Kubernetes Service calls
MCP_SERVER_URL = os.getenv("MCP_SERVER_URL", "http://localhost:8105/mcp")

# ============================================================
# Private-network HTTP client (disables certificate verification for self-signed environments)
# ============================================================
def _http_client(timeout: int = 30) -> httpx.AsyncClient:
    verify = os.getenv("OUTBOUND_VERIFY_SSL", "true").lower() in {"1", "true", "yes", "on"}
    return httpx.AsyncClient(timeout=timeout, verify=verify)


def _mcp_tools_url() -> str:
    base = MCP_SERVER_URL.rstrip("/")
    if base.endswith("/mcp"):
        return base + "/tools/call"
    return base + "/mcp/tools/call"


# ============================================================
# State
# ============================================================
class SREState(TypedDict, total=False):
    alert: dict[str, Any]
    model_profile_id: str
    model_profile_override: dict[str, Any]
    k8s_context: dict[str, Any]
    operator_skills: list[dict[str, Any]]
    diagnosis: dict[str, Any]
    decision: dict[str, Any]
    remediation: dict[str, Any]
    incident: dict[str, Any]
    postmortem: dict[str, Any]
    observability: dict[str, Any]
    final_answer: str


SUPPORTED_ACTIONS = set(ACTION_CATALOG) | {"execute_plan", "investigate"}
_TRACE_CACHE: dict[str, Any] = {}


def _alert_scope(alert: dict[str, Any]) -> dict[str, str]:
    cluster_id = str(alert.get("cluster_id") or alert.get("cluster") or "local-cluster")
    cluster = str(alert.get("cluster") or cluster_id)
    namespace = str(alert.get("namespace") or "default")
    workload = str(alert.get("deployment") or alert.get("workload_name") or alert.get("pod") or "scope")
    workload_type = str(alert.get("workload_type") or "Workload")
    return {
        "cluster": cluster,
        "cluster_id": cluster_id,
        "namespace": namespace,
        "workload": workload,
        "workload_type": workload_type,
    }


def _pod_matches_workload(pod: dict[str, Any], workload_name: str) -> bool:
    workload_name = str(workload_name or "").strip()
    if not workload_name:
        return True
    workload = pod.get("workload") or {}
    return (
        workload_name in {str(pod.get("workload_name") or ""), str(workload.get("name") or "")}
        or str(pod.get("name") or "").startswith(f"{workload_name}-")
    )


def _pod_evidence_priority(pod: dict[str, Any]) -> tuple[int, int, str]:
    state_text = " ".join(
        " ".join([
            str(container.get("state", "")),
            str(container.get("reason", "")),
            str((container.get("state_detail") or {}).get("reason", "")),
            str((container.get("state_detail") or {}).get("message", "")),
        ])
        for container in pod.get("containers", [])
    ).lower()
    score = 0
    if any(term in state_text for term in ("crashloopbackoff", "oomkilled", "back-off", "error")):
        score += 500
    if any(term in state_text for term in ("imagepullbackoff", "errimagepull", "pull access denied")):
        score += 480
    if any(term in state_text for term in ("failedmount", "persistentvolumeclaim", "permission denied")):
        score += 460
    if str(pod.get("phase") or "") == "Pending":
        score += 240
    if not pod.get("ready"):
        score += 120
    restart_count = int(pod.get("restart_count") or 0)
    score += min(120, restart_count * 10)
    if pod.get("completed"):
        score -= 1000
    return score, restart_count, str(pod.get("name") or "")


def _select_evidence_pod(
    pods: list[dict[str, Any]],
    *,
    workload_name: str = "",
    requested_pod: str = "",
) -> dict[str, Any] | None:
    requested_pod = str(requested_pod or "").strip()
    if requested_pod:
        return next((pod for pod in pods if requested_pod == str(pod.get("name") or "")), None)
    matches = [pod for pod in pods if _pod_matches_workload(pod, workload_name)]
    if not matches:
        return None
    matches.sort(key=_pod_evidence_priority, reverse=True)
    return matches[0]


def _ensure_trace(state: SREState, stage: str) -> tuple[Any, dict[str, Any]]:
    alert = state.get("alert") or {}
    scope = _alert_scope(alert)
    observability = dict(state.get("observability") or {})
    trace_id = observability.get("trace_id") or new_trace_id("sre")
    session_id = observability.get("session_id") or (
        f"sre:{scope['cluster_id']}:{scope['namespace']}:{scope['workload']}:{alert.get('alert_name') or 'chat'}"
    )
    observability.update({
        "trace_id": trace_id,
        "session_id": session_id,
        "stage": stage,
        "langfuse": langfuse_status(),
    })
    trace = _TRACE_CACHE.get(trace_id)
    if trace is None:
        trace = start_trace(
            "luxyai.sre.workflow",
            trace_id=trace_id,
            user_id=str(alert.get("user_id") or alert.get("operator") or "luxyai-operator"),
            session_id=session_id,
            input={"alert": alert, "scope": scope},
            metadata={
                **scope,
                "alert_name": alert.get("alert_name"),
                "severity": alert.get("severity"),
                "model_profile_id": state.get("model_profile_id") or alert.get("model_profile_id"),
                "workflow": "sre_graph",
                "created_at": observability.get("created_at") or trace_id,
            },
            tags=["luxyai", "aiops", "sre", str(alert.get("severity") or "P2")],
        )
        _TRACE_CACHE[trace_id] = trace
    return trace, observability


def _extract_json_object(content: str) -> dict[str, Any]:
    content = content.strip()
    if "```" in content:
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()

    try:
        return json.loads(content)
    except json.JSONDecodeError:
        start = content.find("{")
        end = content.rfind("}")
        if start >= 0 and end > start:
            return json.loads(content[start : end + 1])
        raise


def _policy_action(alert: dict[str, Any], diagnosis: dict[str, Any]) -> tuple[str, str]:
    """Deterministic AIOps guardrail for remediable alert classes."""
    alert_name = str(alert.get("alert_name") or "").lower()
    summary = str(alert.get("summary") or alert.get("description") or "").lower()
    root_cause = str(diagnosis.get("root_cause") or "").lower()
    signal_text = " ".join(
        str(item.get("finding", item)) if isinstance(item, dict) else str(item)
        for item in diagnosis.get("signals", [])
    ).lower()
    corpus = " ".join([alert_name, summary, root_cause, signal_text])

    if any(k in corpus for k in ["oomkilled", "out of memory", "\u5185\u5b58\u4e0d\u8db3", "\u5185\u5b58\u6ea2\u51fa"]):
        return "patch_workload", "policy: OOM evidence prefers resource patch over restart"

    if any(k in corpus for k in ["probe failed", "liveness", "readiness", "startup probe", "\u63a2\u9488"]):
        return "patch_workload", "policy: probe evidence prefers workload probe tuning"

    if any(k in corpus for k in ["permission denied", "failedmount", "mountvolume", "read-only file system", "\u6743\u9650\u4e0d\u8db3", "\u6302\u8f7d\u5931\u8d25"]):
        return "patch_workload", "policy: storage/config evidence prefers workload securityContext patch"

    if any(k in corpus for k in ["imagepullbackoff", "errimagepull", "pull access denied", "manifest unknown"]):
        return "observe", "policy: image pull failures need registry/tag/secret evidence before mutation"

    if any(k in corpus for k in ["crashloop", "crash looping", "\u5bb9\u5668\u53cd\u590d\u5d29\u6e83", "\u53cd\u590d\u91cd\u542f"]):
        return "observe", "policy: generic crashloop requires evidence-specific plan before mutation"

    if any(k in corpus for k in ["highcpu", "cpu usage", "cpu \u4f7f\u7528\u7387", "\u9ad8 cpu", "\u9ad8cpu"]):
        return "scale_out", "policy: high cpu capacity alert"

    if any(k in corpus for k in ["pending", "\u65e0\u6cd5\u8c03\u5ea6", "insufficient", "node affinity", "taint"]):
        return "observe", "policy: scheduling issue requires investigation"

    return "observe", "policy: no safe deterministic remediation"


# ============================================================
# MCP tool invocation (replaces the old fake functions)
# ============================================================
async def mcp_call_tool(tool_name: str, arguments: dict) -> dict:
    """
    Call a local MCP Server tool over HTTP.
    If the MCP Server is unavailable, fall back to direct Kubernetes API calls.
    """
    try:
        headers = {}
        internal_key = os.getenv("INTERNAL_API_KEY", "").strip()
        if internal_key:
            headers["X-Internal-API-Key"] = internal_key
        async with _http_client() as client:
            resp = await client.post(
                _mcp_tools_url(),
                json={"tool": tool_name, "arguments": arguments},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        # Fallback: directly import k8s_mcp_server functions (same-process call)
        from mcp_servers.k8s_mcp_server import (
            list_pods,
            get_pod_events,
            get_pod_logs,
            get_pod_diagnostics,
        )

        tool_map = {
            "list_pods": list_pods,
            "get_pod_events": get_pod_events,
            "get_pod_logs": get_pod_logs,
            "get_pod_diagnostics": get_pod_diagnostics,
        }

        fn = tool_map.get(tool_name)
        if fn is None:
            raise ValueError(f"Unknown MCP tool: {tool_name}; http_error={e}")
        result = fn(**arguments)
        if isinstance(result, dict) and result.get("error"):
            result["mcp_http_error"] = str(e)
        return result


# ============================================================
# Graph Nodes
# ============================================================
async def collect_context(state: SREState) -> SREState:
    alert = state["alert"]
    trace, observability = _ensure_trace(state, "collect_context")
    node_span = start_span(
        trace,
        "01.collect_context",
        input={"alert": alert},
        metadata={"node": "collect_context", "purpose": "collect K8s/Rancher/MCP evidence"},
    )
    provided = state.get("k8s_context") or {}
    if provided.get("source") == "rancher" and (provided.get("pod") or provided.get("pods")):
        end_observation(node_span, output={"source": "rancher", "context": provided})
        return {**state, "k8s_context": provided, "observability": observability}
    namespace = alert.get("namespace", "default")
    deployment = alert.get("deployment") or alert.get("workload_name") or ""
    requested_pod = alert.get("pod") or ""

    # Step 1: get Pods
    span = start_span(
        trace,
        "tool.mcp.list_pods",
        input={"namespace": namespace},
        metadata={"tool": "list_pods", "stage": "evidence"},
    )
    pods_data = await mcp_call_tool("list_pods", {"namespace": namespace})

    end_observation(span, output=pods_data, metadata={"pods_count": len(pods_data.get("pods", []))})

    # Step 2: select the actual target and collect bounded deep evidence.
    context_data = {"pods": pods_data, "events": {}, "diagnostics": {}}

    selected_pod = _select_evidence_pod(
        pods_data.get("pods", []),
        workload_name=deployment,
        requested_pod=requested_pod,
    ) if (requested_pod or deployment) else None
    if selected_pod and selected_pod.get("name"):
        name = selected_pod["name"]
        span2 = start_span(
            trace,
            "tool.mcp.get_pod_diagnostics",
            input={"namespace": namespace, "pod_name": name, "tail_lines": 160},
            metadata={"tool": "get_pod_diagnostics", "target": name},
        )
        diagnostics = await mcp_call_tool(
            "get_pod_diagnostics",
            {"namespace": namespace, "pod_name": name, "tail_lines": 160},
        )
        end_observation(span2, output=diagnostics, metadata={"events_count": len(diagnostics.get("events", []))})
        context_data["pod"] = diagnostics.get("pod") or selected_pod
        context_data["events"] = {"events": diagnostics.get("events", [])}
        context_data["logs"] = diagnostics.get("logs", {})
        context_data["workload"] = diagnostics.get("workload", {})
        context_data["diagnostics"] = diagnostics
        context_data["matching_pods"] = [
            pod for pod in pods_data.get("pods", [])
            if _pod_matches_workload(pod, deployment)
        ][:8]

    # Alerts sometimes omit a workload. Use the first unhealthy-looking Pod as
    # an evidence target, never as an automatic mutation target by name guess.
    if not context_data.get("pod") and not (requested_pod or deployment):
        candidate = _select_evidence_pod(pods_data.get("pods", []))
        if candidate and candidate.get("name"):
            span3 = start_span(
                trace,
                "tool.mcp.get_pod_diagnostics.autotarget",
                input={"namespace": namespace, "pod_name": candidate["name"], "tail_lines": 160},
                metadata={"tool": "get_pod_diagnostics", "target_source": "unhealthy_candidate"},
            )
            diagnostics = await mcp_call_tool(
                "get_pod_diagnostics",
                {"namespace": namespace, "pod_name": candidate["name"], "tail_lines": 160},
            )
            end_observation(span3, output=diagnostics, metadata={"events_count": len(diagnostics.get("events", []))})
            context_data.update({
                "pod": diagnostics.get("pod") or candidate,
                "events": {"events": diagnostics.get("events", [])},
                "logs": diagnostics.get("logs", {}),
                "workload": diagnostics.get("workload", {}),
                "diagnostics": diagnostics,
            })
    elif not context_data.get("pod"):
        context_data["target_binding_error"] = (
            f"operator-selected pod/{requested_pod} was not found"
            if requested_pod else f"operator-selected workload/{deployment} was not found"
        )

    end_observation(
        node_span,
        output=context_data,
        metadata={
            "pods_count": len(pods_data.get("pods", [])),
            "target_pod": (context_data.get("pod") or {}).get("name"),
            "has_deep_evidence": bool(context_data.get("diagnostics")),
        },
    )
    update_trace(trace, metadata={"last_stage": "collect_context", "target_pod": (context_data.get("pod") or {}).get("name")})

    return {**state, "k8s_context": context_data, "observability": observability}


async def diagnose(state: SREState) -> SREState:
    """Use a local LLM for intelligent diagnosis instead of the previous hard-coded rule matching."""
    alert = state["alert"]
    context = state["k8s_context"]
    trace, observability = _ensure_trace(state, "diagnose")
    model_profile_id = state.get("model_profile_id") or alert.get("model_profile_id") or ""
    target_pod = context.get("pod") or {}
    scoped_pods = [target_pod] if target_pod and (alert.get("deployment") or alert.get("workload_name") or alert.get("pod")) else context.get("pods", {}).get("pods", [])[:5]
    llm = get_llm(
        temperature=0.1,
        max_tokens=int(os.getenv("LLM_DIAGNOSIS_MAX_TOKENS", "1400")),
        profile_id=model_profile_id or None,
        profile_override=state.get("model_profile_override") or None,
    )

    generation = start_generation(
        trace,
        "02.llm_diagnosis",
        model=getattr(llm, "model_name", os.getenv("LLM_MODEL", "qwen2.5:7b")),
        input={
            "alert": _redact_sensitive(alert),
            "context": {
                "pods": _redact_sensitive(scoped_pods),
                "events": _redact_sensitive(context.get("events", {}).get("events", [])[:10]),
            },
        },
        metadata={
            "model_profile_id": getattr(llm, "profile_id", model_profile_id),
            "cluster": alert.get("cluster") or alert.get("cluster_id"),
            "namespace": alert.get("namespace"),
            "workload": alert.get("deployment") or alert.get("workload_name"),
            "pods_count": len(context.get("pods", {}).get("pods", [])),
            "events_count": len(context.get("events", {}).get("events", [])),
        },
        prompt_name="luxyai.sre.diagnosis.v2",
    )

    safe_alert = _redact_sensitive(alert)
    safe_pods = _redact_sensitive(scoped_pods)
    safe_events = _redact_sensitive(context.get("events", {}).get("events", [])[:20])
    safe_diagnostics = _redact_sensitive({
        "target_pod": context.get("pod", {}),
        "logs": context.get("logs", {}),
        "workload": context.get("workload", {}),
        "services": (context.get("diagnostics") or {}).get("services", []),
        "storage": (context.get("diagnostics") or {}).get("storage", []),
        "node": (context.get("diagnostics") or {}).get("node", {}),
    })
    operator_skills = _redact_sensitive(state.get("operator_skills") or [])
    prompt = f"""You are a senior AIOps / SRE diagnostics expert. Analyze the following Kubernetes alert and cluster context, then return an actionable, concise production diagnosis that a junior operator can execute step by step.

## Alert details
{safe_alert}

## Cluster context
Pods: {json.dumps(safe_pods, ensure_ascii=False)}
Events: {json.dumps(safe_events, ensure_ascii=False)}
Deep evidence: {json.dumps(safe_diagnostics, ensure_ascii=False)[:14000]}

## Dynamically loaded operations skills
The following content comes from the matched standard Agent Skill. Use it as an expert runbook, but do not bypass real evidence, the action allowlist, RBAC, or required human approval:
{json.dumps(operator_skills, ensure_ascii=False)[:12000]}

## Task
Return the diagnosis as JSON with these fields:
- root_cause: root-cause analysis
- impact: impact scope
- confidence: confidence (0-1)
- risk_level: risk level (low/medium/high/critical)
- blast_radius: blast radius across the namespace/service/workload/user-facing dimensions
- signals: array of key evidence items, each containing source and finding
- immediate_actions: array of expert step objects tailored to this incident, each containing title, description, probe, expected_evidence, decision_rule, on_match, and on_miss. probe must be selected only from current_logs/previous_logs/events/workload_spec/pod_metrics/node_conditions/service_endpoints/dns/network_policy/dependency_topology/storage_chain/csi_status/pod_security_context/image_pull_secrets/registry_connectivity/scheduler_constraints/quota/pvc_binding/hpa/recent_changes/pdb_state/certificate_chain/webhook_status/config_ref_exists
- prevention: array of follow-up prevention recommendations
- suggested_action: recommended action, which must be either execute_plan or investigate; do not use observe as the final operations conclusion
- proposed_changes: array of candidate actions, each containing type, target field, reason, and required parameters. type must be selected only from create_workload/patch_workload/restart/scale_out/recreate_pod/patch_hpa/expand_pvc/create_pvc/create_pv/patch_workload_volume/cordon_node/evict_pod/uncordon_node/rollback_workload/patch_service/patch_service_account/create_configmap/patch_pdb. Every action must have direct evidence; high-risk actions should only be proposed as approval-required candidates, and storage paths, Secret contents, and configuration values must never be guessed.
- need_human_approval: whether human approval is required (true/false)

Decision principles:
1. Do not default CrashLoop to restart. Prefer evidence-driven choices such as OOM resource fixes, probe fixes, configuration/storage permission fixes, image credential fixes, or scheduling fixes.
2. For ImagePullBackOff, do not suggest a restart unless a default imagePullSecret is explicitly confirmed; instead provide steps to check the tag, registry, secret, and node network.
3. Do not generate shell or kubectl command strings. Actions such as network policy changes, Secret content changes, new PVC creation, node expansion, and image version replacement may only be presented as human recommendations; structured actions still require backend allowlists and risk gates.
4. If the user's question is unrelated to Kubernetes or SRE, set root_cause to "non-operations issue", set suggested_action=investigate, and use immediate_actions for a normal answer outline without proposing changes.
5. immediate_actions must be generated dynamically from the real evidence for the current object and must not copy a fixed procedure. Each step should clearly state what to check, why to check it, what result supports or rules out which root cause, and what to do next; cover scope confirmation, parallel evidence collection, at least two root-cause branches, change gates, the minimum safe change, SLI/SLO recovery validation, and alternative strategies if validation fails. Normally provide 6-10 steps.
6. Symptoms and root causes must be distinguished. Without previous logs, Events, or real configuration evidence, restart must not be treated as the default fix.
7. For complex issues, cover branches such as rollout regression, PDB deadlock, Service selector/Endpoint issues, Quota/LimitRange, DNS/CNI, CSI/PVC, certificates/Webhooks, node pressure, and dependency failures.
8. When an operations Skill applies, follow its evidence order and recovery criteria; if the Skill conflicts with live evidence, live evidence takes precedence.
9. If logs do not exist, the Pod has been deleted, or the container has not produced logs yet, first use Events, status, and the Workload template to determine whether PVC, image, ConfigMap, quota, or scheduling blockers exist. If there is no template-level blocker, you may propose recreate_pod as a diagnostic rebuild, but you must collect current and previous logs again after the rebuild.

Return JSON only and no additional text."""

    try:
        response = llm.invoke(prompt)
        diagnosis = _extract_json_object(response.content)

        # Safely retrieve token usage
        try:
            um = getattr(response, "usage_metadata", {}) or {}
            tm = getattr(response, "response_metadata", {}).get("token_usage", {})
            in_tok = int(um.get("input_tokens", tm.get("input_tokens", 0)))
            out_tok = int(um.get("output_tokens", tm.get("output_tokens", 0)))
        except Exception:
            in_tok = out_tok = 0

        cost_usd = estimate_llm_cost_usd(
            {"input_tokens": in_tok, "output_tokens": out_tok, "total_tokens": in_tok + out_tok},
            model_profile_id=getattr(llm, "profile_id", model_profile_id) or model_profile_id,
            model=getattr(llm, "model_name", os.getenv("LLM_MODEL", "qwen2.5:7b")),
        )
        end_observation(
            generation,
            output=_redact_sensitive(diagnosis),
            usage={"input_tokens": in_tok, "output_tokens": out_tok},
            metadata={"estimated_cost_usd": cost_usd},
        )
        quality_scores = quality_score_from_diagnosis(diagnosis, context)
        for score_name, score_value in quality_scores.items():
            score_observation(
                trace,
                name=f"sre_diagnosis.{score_name}",
                value=score_value,
                comment=f"Flawless diagnostic quality score: {score_name}",
                metadata={"stage": "diagnose", "model_profile_id": getattr(llm, "profile_id", model_profile_id)},
            )
        diagnosis["diagnosis_metadata"] = {
            "source": "llm",
            "model": getattr(llm, "model_name", os.getenv("LLM_MODEL", "qwen2.5:7b")),
            "model_profile_id": getattr(llm, "profile_id", model_profile_id),
            "token_usage": {
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "total_tokens": in_tok + out_tok,
            },
            "estimated_cost_usd": cost_usd,
            "quality_scores": quality_scores,
            "langfuse_trace_id": observability.get("trace_id"),
            "langfuse_session_id": observability.get("session_id"),
        }

    except Exception as e:
        diagnosis = _fallback_diagnosis(alert, context)
        diagnosis["llm_error"] = {
            "type": type(e).__name__,
            "message": str(e),
            "trace": traceback.format_exc(limit=4),
        }

        end_observation(
            generation,
            output=_redact_sensitive(diagnosis),
            status_message=f"fallback: LLM failed, using rule-based diagnosis: {e}",
            level="ERROR",
        )
        quality_scores = quality_score_from_diagnosis(diagnosis, context)
        for score_name, score_value in quality_scores.items():
            score_observation(trace, name=f"sre_diagnosis.{score_name}", value=score_value, comment="fallback diagnosis score")
        diagnosis["diagnosis_metadata"] = {
            "source": "fallback",
            "model": getattr(llm, "model_name", os.getenv("LLM_MODEL", "qwen2.5:7b")),
            "model_profile_id": getattr(llm, "profile_id", model_profile_id),
            "token_usage": {},
            "quality_scores": quality_scores,
            "langfuse_trace_id": observability.get("trace_id"),
            "langfuse_session_id": observability.get("session_id"),
        }

    diagnosis["evidence"] = {
        "pods": context.get("pods", {}).get("pods", [])[:5],
        "events": context.get("events", {}).get("events", [])[:10],
    }
    diagnosis.setdefault("risk_level", "medium")
    diagnosis.setdefault("blast_radius", diagnosis.get("impact", "Pending assessment"))
    diagnosis.setdefault("signals", [])
    diagnosis.setdefault("immediate_actions", [])
    diagnosis.setdefault("prevention", [])
    diagnosis.setdefault("proposed_changes", [])

    remediation_plan = build_remediation_plan(alert, diagnosis, context)
    top_hypothesis = (remediation_plan.get("hypotheses") or [{}])[0]
    root_text = str(diagnosis.get("root_cause") or "").lower()
    if top_hypothesis and any(term in root_text for term in ("\u672a\u77e5", "unknown", "\u8bc1\u636e\u4e0d\u8db3", "\u4eba\u5de5\u4ecb\u5165", "insufficient evidence", "manual intervention")):
        confidence = float(top_hypothesis.get("confidence") or 0.0)
        if confidence >= 0.62:
            matched = top_hypothesis.get("matched_evidence") or []
            evidence_sources = ", ".join(sorted({str(item.get("source") or "") for item in matched if item.get("source")})[:4])
            diagnosis["root_cause"] = (
                f"{top_hypothesis.get('title') or top_hypothesis.get('id')}. "
                f"Evidence sources: {evidence_sources or 'runtime evidence'}; "
                f"confidence {confidence:.2f}."
            )
    engine_changes = remediation_plan.get("changes") or []
    llm_changes = []
    for raw_change in diagnosis.get("proposed_changes") or []:
        if not isinstance(raw_change, dict):
            continue
        candidate = dict(raw_change)
        candidate.setdefault("type", "patch_workload" if candidate.get("patch") else "")
        if candidate.get("type") in ACTION_CATALOG:
            llm_changes.append(candidate)
    diagnosis["proposed_changes"] = llm_changes
    if not llm_changes and engine_changes:
        diagnosis["proposed_changes"] = engine_changes
    expert_steps = expert_steps_from_diagnosis(diagnosis)
    if diagnosis.get("diagnosis_metadata", {}).get("source") == "llm" and len(expert_steps) >= 4:
        remediation_plan["steps"] = expert_steps
        remediation_plan["planning_engine"] = "LLMEvidenceExpertPlanner/v1 + EvidenceRunbookEngine guardrails"
        remediation_plan["step_source"] = "llm_evidence_expert"
    else:
        remediation_plan["planning_engine"] = "EvidenceRunbookEngine/v1 fallback"
        remediation_plan["step_source"] = "deterministic_fallback"
    diagnosis["remediation_plan"] = remediation_plan
    diagnosis["root_cause_hypotheses"] = remediation_plan.get("hypotheses", [])
    diagnosis["immediate_actions"] = remediation_plan.get("steps") or diagnosis.get("immediate_actions", [])

    metadata = diagnosis.setdefault("diagnosis_metadata", {})
    if isinstance(metadata, dict):
        metadata.setdefault("quality_scores", quality_score_from_diagnosis(diagnosis, context))
        metadata.setdefault("langfuse_trace_id", observability.get("trace_id"))
        metadata.setdefault("langfuse_session_id", observability.get("session_id"))
    observability["quality_scores"] = metadata.get("quality_scores", {})
    observability["model_profile_id"] = metadata.get("model_profile_id")
    observability["estimated_cost_usd"] = metadata.get("estimated_cost_usd", 0)
    update_trace(trace, output=diagnosis, metadata={"last_stage": "diagnose", "quality_scores": observability.get("quality_scores")})

    return {**state, "diagnosis": diagnosis, "observability": observability}


def _fallback_diagnosis(alert: dict, context: dict) -> dict:
    """Rule-matching fallback used when the LLM is unavailable."""
    alert_name = alert.get("alert_name", "")
    pods = context.get("pods", {}).get("pods", [])
    evidence_text = json.dumps(_redact_sensitive({
        "pod": context.get("pod", {}),
        "events": context.get("events", {}),
        "logs": context.get("logs", {}),
        "diagnostics": context.get("diagnostics", {}),
    }), ensure_ascii=False).lower()

    crash_states = ["CrashLoopBackOff", "Error", "ImagePullBackOff"]
    has_crash = any(
        any(s.lower() in " ".join([
            str(c.get("state", "")),
            str(c.get("reason", "")),
            str((c.get("state_detail") or {}).get("reason", "")),
            str((c.get("state_detail") or {}).get("message", "")),
        ]).lower() for s in crash_states)
        for p in pods
        for c in p.get("containers", [])
    ) or any(term in evidence_text for term in ("crashloopbackoff", "back-off restarting", "imagepullbackoff", "errimagepull"))

    if any(term in evidence_text for term in ("permission denied", "can't create directory", "cannot create directory", "read-only file system")):
        return {
            "root_cause": "Container logs show insufficient permissions for the write path. The most likely causes are a mismatch in mounted volume ownership/group, runtime user settings, or the permissions of the underlying storage directory.",
            "impact": "The target Pod cannot complete startup or service initialization, and the Workload may not have enough available replicas.",
            "confidence": 0.86,
            "risk_level": "high",
            "blast_radius": "The target Workload and any upstream callers that depend on its service may be affected.",
            "signals": [{"source": "logs", "finding": "Matched permission denied / mkdir directory creation failure"}],
            "immediate_actions": [
                {"title": "Read previous logs", "description": "Confirm whether the failure occurs during startup initialization or during application runtime.", "probe": "previous_logs"},
                {"title": "Verify the runtime user and mount points", "description": "Inspect runAsUser/runAsGroup, volumeMounts, and PVC/PV configuration.", "probe": "pod_security_context"},
                {"title": "Generate the minimum-change candidate", "description": "Prioritize fsGroup/fsGroupChangePolicy. If the underlying storage does not support group-based remediation, switch to storage-side directory permission handling.", "probe": "storage_chain"},
            ],
            "prevention": ["Validate image runtime users and storage directory permissions before release", "Create a storage-permission Skill for critical stateful services"],
            "suggested_action": "execute_plan",
            "need_human_approval": True,
        }

    if has_crash or alert_name == "KubePodCrashLooping":
        return {
            "root_cause": "The container is repeatedly crashing. Likely causes include OOM, startup failure, or configuration errors.",
            "impact": "The service is unavailable or only partially available.",
            "confidence": 0.85,
            "risk_level": "high",
            "blast_radius": "Some or all replicas of the target Deployment may be unavailable; without redundancy, user requests may be impacted.",
            "signals": [{"source": "pod_status", "finding": "Detected CrashLoopBackOff/Error/ImagePullBackOff or the corresponding alert"}],
            "immediate_actions": [
                "Collect evidence: review Pod Events, current/previous logs, exit codes, and recent changes.",
                "Branch on the evidence: use resource remediation for OOM, startupProbe/readiness remediation for probe failures, fsGroup or storage-side permission remediation for mount/permission failures, and registry/secret remediation for image pull failures.",
                "Apply change gates: confirm the impact scope, replica redundancy, rollback path, and whether human approval is required.",
                "Validate execution: after the change, observe the new Pod readiness, restart_count, Events, and service health checks.",
            ],
            "prevention": ["Add startup probe and resource limit alerts", "Configure multiple replicas and a PDB for critical services", "Document a CrashLoop runbook"],
            "suggested_action": "investigate",
            "need_human_approval": True,
        }

    if alert_name == "HighCPUUsage":
        return {
            "root_cause": "Deployment CPU usage has remained above the threshold.",
            "impact": "Latency is increasing and request processing is slowing down.",
            "confidence": 0.82,
            "risk_level": "medium",
            "blast_radius": "Throughput for the target service is reduced and the impact may propagate to upstream call chains.",
            "signals": [{"source": "alert", "finding": "CPU usage has remained above the threshold"}],
            "immediate_actions": ["Confirm HPA status", "Check for abnormal traffic", "Temporarily scale out replicas"],
            "prevention": ["Improve the HPA strategy", "Establish a capacity baseline", "Configure rate limiting and graceful degradation for traffic spikes"],
            "suggested_action": "scale_out",
            "need_human_approval": True,
        }

    if alert_name == "KubePodPending":
        return {
            "root_cause": "The Pod cannot be scheduled, likely because of insufficient resources or mismatched node affinity.",
            "impact": "New replicas cannot start.",
            "confidence": 0.88,
            "risk_level": "medium",
            "blast_radius": "Release or scale-out workflows are blocked, and service capacity may be affected if existing replicas are insufficient.",
            "signals": [{"source": "scheduler", "finding": "The Pod has remained in Pending for an extended period"}],
            "immediate_actions": ["Review scheduling events", "Check node resources and taint/toleration settings", "Check PVC status or image pull status"],
            "prevention": ["Add resource saturation alerts", "Improve node pool capacity strategy", "Validate resource quotas before release"],
            "suggested_action": "investigate",
            "need_human_approval": False,
        }

    return {
        "root_cause": "Unknown issue; manual intervention is required.",
        "impact": "Pending assessment",
        "confidence": 0.3,
        "risk_level": "medium",
        "blast_radius": "Unknown; continue investigating with additional context.",
        "signals": [],
        "immediate_actions": ["Review Pod Events", "Review application logs", "Confirm recent changes"],
        "prevention": ["Complete the alert labels", "Add service topology documentation and a runbook"],
        "suggested_action": "investigate",
        "need_human_approval": True,
    }


async def decide_action(state: SREState) -> SREState:
    diagnosis = state["diagnosis"]
    alert = state["alert"]
    trace, observability = _ensure_trace(state, "decide_action")
    span = start_span(
        trace,
        "03.decision_gate",
        input={
            "risk_level": diagnosis.get("risk_level"),
            "confidence": diagnosis.get("confidence"),
            "proposed_changes": diagnosis.get("proposed_changes", []),
        },
        metadata={"node": "decide_action", "gate": "human_approval_and_action_catalog"},
    )

    remediation_plan = diagnosis.get("remediation_plan") or {}
    proposed_changes = diagnosis.get("proposed_changes") or remediation_plan.get("changes") or []
    target = remediation_plan.get("target") or {}
    workload_name = alert.get("deployment") or alert.get("workload_name") or target.get("workload_name") or ""
    action = "execute_plan" if proposed_changes else "investigate"
    decision_source = "evidence_runbook_engine"
    need_approval = diagnosis.get("need_human_approval", True)

    auto_healing_enabled = bool(alert.get("auto_healing_enabled", False))
    decision = {
        "action": action,
        "require_human_approval": need_approval and not auto_healing_enabled,
        "dry_run": not auto_healing_enabled,
        "auto_healing_enabled": auto_healing_enabled,
        "source": decision_source,
        "reason": diagnosis["root_cause"],
        "proposed_changes": proposed_changes,
        "diagnostic_actions": remediation_plan.get("diagnostic_actions", []),
        "runbook_id": remediation_plan.get("runbook_id", "unknown"),
        "success_criteria": remediation_plan.get("success_criteria", []),
        "target": {
            "namespace": alert.get("namespace", "default"),
            "workload_type": alert.get("workload_type") or target.get("workload_type") or "Deployment",
            "workload_name": workload_name or "unknown",
            "pod_name": target.get("pod_name") or alert.get("pod") or "",
        },
    }

    score_observation(
        trace,
        name="sre_decision.has_executable_plan",
        value=1.0 if proposed_changes else 0.0,
        comment=decision.get("reason", ""),
        metadata={"runbook_id": decision.get("runbook_id"), "dry_run": decision.get("dry_run")},
    )
    score_observation(
        trace,
        name="sre_decision.requires_human_approval",
        value=1.0 if decision.get("require_human_approval") else 0.0,
        metadata={"auto_healing_enabled": auto_healing_enabled},
    )
    end_observation(span, output=decision)
    update_trace(trace, metadata={"last_stage": "decide_action", "runbook_id": decision.get("runbook_id")})

    return {**state, "decision": decision, "observability": observability}


async def call_healing_agent(state: SREState) -> SREState:
    decision = state["decision"]
    trace, observability = _ensure_trace(state, "healing")
    span = start_span(
        trace,
        "04.healing_agent",
        input={"decision": decision},
        metadata={"node": "call_healing_agent", "action": decision.get("action")},
    )

    if decision["action"] == "investigate":
        remediation = {
            "executed": False,
            "message": "An executable deep-diagnosis plan has been generated; after evidence collection is complete, the root cause will be rescored and controlled changes will be proposed.",
            "reason": decision.get("reason"),
            "decision_source": decision.get("source"),
            "diagnostic_actions": decision.get("diagnostic_actions", []),
        }
        end_observation(span, output=remediation, metadata={"executed": False, "reason": "investigate_only"})
        return {
            **state,
            "remediation": remediation,
            "observability": observability,
        }

    payload = {
        "id": str(uuid.uuid4()),
        "source_agent": "agentic-sre",
        "target_agent": "healing-agent",
        "task_type": "healing.execute",
        "priority": "high",
        "payload": {
            "namespace": decision["target"]["namespace"],
            "workload_type": decision["target"]["workload_type"],
            "workload_name": decision["target"]["workload_name"],
            "action": decision["action"],
            "reason": decision["reason"],
            "dry_run": decision["dry_run"],
            "patch": (decision.get("proposed_changes") or [{}])[0].get("patch") if decision.get("proposed_changes") else None,
            "changes": decision.get("proposed_changes") or [],
        },
    }

    try:
        async with _http_client() as client:
            resp = await client.post(HEALING_AGENT_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        error_payload = {
            "executed": False,
            "status": "failed",
            "error": f"healing-agent request failed: {type(e).__name__}: {e}",
        }
        end_observation(span, output=error_payload, status_message=error_payload["error"], level="ERROR")
        return {
            **state,
            "remediation": error_payload,
            "observability": observability,
        }

    remediation = data.get("result", data)
    end_observation(span, output=remediation, metadata={"executed": bool((remediation or {}).get("executed")) if isinstance(remediation, dict) else None})
    score_observation(
        trace,
        name="sre_healing.executed",
        value=1.0 if isinstance(remediation, dict) and remediation.get("executed") else 0.0,
        metadata={"action": decision.get("action"), "dry_run": decision.get("dry_run")},
    )
    update_trace(trace, metadata={"last_stage": "healing", "healing_status": (remediation or {}).get("status") if isinstance(remediation, dict) else ""})
    return {**state, "remediation": remediation, "observability": observability}


async def call_incident_agent(state: SREState) -> SREState:
    alert = state["alert"]
    diagnosis = state["diagnosis"]
    trace, observability = _ensure_trace(state, "incident")

    payload = {
        "id": str(uuid.uuid4()),
        "source_agent": "agentic-sre",
        "target_agent": "incident-agent",
        "task_type": "incident.create_or_update",
        "priority": alert.get("priority", "high"),
        "payload": {
            "title": f"K8S Alert: {alert.get('alert_name')}",
            "severity": alert.get("severity", "P2"),
            "namespace": alert.get("namespace", "default"),
            "service": alert.get("service", alert.get("deployment")),
            "summary": diagnosis["root_cause"],
            "status": "open",
        },
    }
    span = start_span(
        trace,
        "05.incident_agent",
        input=payload,
        metadata={"node": "call_incident_agent", "severity": payload["payload"].get("severity")},
    )

    try:
        async with _http_client() as client:
            resp = await client.post(INCIDENT_AGENT_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        incident = {
            "incident_id": f"INC-{uuid.uuid4().hex[:8]}",
            "title": payload["payload"]["title"],
            "severity": payload["payload"]["severity"],
            "namespace": payload["payload"]["namespace"],
            "service": payload["payload"]["service"],
            "summary": payload["payload"]["summary"],
            "status": "open",
            "agent_error": f"incident-agent request failed: {type(e).__name__}: {e}",
        }
        end_observation(span, output=incident, status_message=incident["agent_error"], level="ERROR")
        return {**state, "incident": incident, "observability": observability}

    incident = data.get("result", data)
    end_observation(span, output=incident)
    update_trace(trace, metadata={"last_stage": "incident", "incident_id": (incident or {}).get("incident_id") if isinstance(incident, dict) else ""})
    return {**state, "incident": incident, "observability": observability}


async def call_postmortem_agent(state: SREState) -> SREState:
    trace, observability = _ensure_trace(state, "postmortem")
    payload = {
        "id": str(uuid.uuid4()),
        "source_agent": "agentic-sre",
        "target_agent": "postmortem-agent",
        "task_type": "postmortem.generate",
        "priority": "medium",
        "payload": {
            "incident": state.get("incident"),
            "diagnosis": state.get("diagnosis"),
            "remediation": state.get("remediation"),
        },
    }
    span = start_span(
        trace,
        "06.postmortem_agent",
        input=payload,
        metadata={"node": "call_postmortem_agent", "incident_id": (state.get("incident") or {}).get("incident_id")},
    )

    try:
        async with _http_client() as client:
            resp = await client.post(POSTMORTEM_AGENT_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        postmortem = {
            "report": f"# Post-Mortem generation failed\n\n{type(e).__name__}: {e}",
            "agent_error": f"postmortem-agent request failed: {type(e).__name__}: {e}",
        }
        end_observation(span, output=postmortem, status_message=postmortem["agent_error"], level="ERROR")
        return {
            **state,
            "postmortem": postmortem,
            "observability": observability,
        }

    postmortem = data.get("result", data)
    end_observation(span, output=postmortem)
    update_trace(trace, metadata={"last_stage": "postmortem"})
    return {**state, "postmortem": postmortem, "observability": observability}


async def summarize(state: SREState) -> SREState:
    alert = state["alert"]
    diagnosis = state["diagnosis"]
    decision = state["decision"]
    remediation = state.get("remediation")
    incident = state.get("incident")
    trace, observability = _ensure_trace(state, "summarize")
    span = start_span(
        trace,
        "07.summarize",
        input={
            "diagnosis": diagnosis,
            "decision": decision,
            "remediation": remediation,
            "incident": incident,
        },
        metadata={"node": "summarize"},
    )

    def _lines(items, limit: int = 5) -> str:
        if not items:
            return "- No clear evidence yet"
        rows = []
        for item in items[:limit]:
            if isinstance(item, dict):
                finding = item.get("finding") or item.get("message") or item.get("reason") or json.dumps(item, ensure_ascii=False)
                source = item.get("source")
                rows.append(f"- {source + ': ' if source else ''}{finding}")
            else:
                rows.append(f"- {item}")
        return "\n".join(rows)

    action = decision.get("action") or diagnosis.get("suggested_action") or "investigate"
    dry_run = decision.get("dry_run")
    approval = decision.get("require_human_approval")
    executed = remediation.get("executed") if isinstance(remediation, dict) else False
    remediation_msg = ""
    if isinstance(remediation, dict):
        remediation_msg = remediation.get("message") or remediation.get("error") or remediation.get("reason") or ""
    incident_id = incident.get("incident_id") if isinstance(incident, dict) else ""

    final_answer = f"""
## Conclusion
{diagnosis.get("root_cause") or "There is not yet enough evidence to identify the root cause."}

## Impact
- Scope: {diagnosis.get("impact") or diagnosis.get("blast_radius") or "Pending confirmation"}
- Risk: {diagnosis.get("risk_level") or "medium"}
- Confidence: {diagnosis.get("confidence", "n/a")}

## Evidence trail
{_lines(diagnosis.get("signals") or [])}

## Next steps
{_lines(diagnosis.get("immediate_actions") or [])}

## Execution status
- Recommended action: {action}
- Current mode: {"Diagnosis / awaiting confirmation" if dry_run else "Execution allowed"}
- Human approval: {"Required" if approval else "Not required"}
- Healing Agent: {"Executed" if executed else "Not executed"}{f"; {remediation_msg}" if remediation_msg else ""}
{f"- Incident ID: {incident_id}" if incident_id else ""}

## Prevention recommendations
{_lines(diagnosis.get("prevention") or [], 4)}
"""
    observability.update({
        "trace_id": observation_id(trace, observability.get("trace_id", "")),
        "quality_scores": (diagnosis.get("diagnosis_metadata") or {}).get("quality_scores", {}),
        "estimated_cost_usd": (diagnosis.get("diagnosis_metadata") or {}).get("estimated_cost_usd", 0),
        "token_usage": (diagnosis.get("diagnosis_metadata") or {}).get("token_usage", {}),
        "model_profile_id": (diagnosis.get("diagnosis_metadata") or {}).get("model_profile_id", ""),
        "completed": True,
    })
    end_observation(span, output={"final_answer": final_answer, "observability": observability})
    update_trace(
        trace,
        output={"final_answer": final_answer, "diagnosis": diagnosis, "decision": decision, "remediation": remediation},
        metadata={
            "last_stage": "summarize",
            "quality_scores": observability.get("quality_scores", {}),
            "estimated_cost_usd": observability.get("estimated_cost_usd", 0),
        },
    )
    flush_observability()
    _TRACE_CACHE.pop(observability.get("trace_id", ""), None)
    return {**state, "observability": observability, "final_answer": final_answer}


def should_generate_postmortem(state: SREState) -> Literal["postmortem", "end"]:
    severity = state["alert"].get("severity", "P2")
    return "postmortem" if severity in ["P0", "P1", "P2"] else "end"


# ============================================================
# Graph Build
# ============================================================
def build_graph():
    graph = StateGraph(SREState)

    graph.add_node("collect_context", collect_context)
    graph.add_node("diagnose", diagnose)
    graph.add_node("decide_action", decide_action)
    graph.add_node("healing", call_healing_agent)
    graph.add_node("incident", call_incident_agent)
    graph.add_node("postmortem", call_postmortem_agent)
    graph.add_node("summarize", summarize)

    graph.set_entry_point("collect_context")
    graph.add_edge("collect_context", "diagnose")
    graph.add_edge("diagnose", "decide_action")
    graph.add_edge("decide_action", "healing")
    graph.add_edge("healing", "incident")

    graph.add_conditional_edges(
        "incident",
        should_generate_postmortem,
        {"postmortem": "postmortem", "end": "summarize"},
    )

    graph.add_edge("postmortem", "summarize")
    graph.add_edge("summarize", END)

    return graph.compile()


# ============================================================
# Demo
# ============================================================
async def run_demo():
    app = build_graph()

    alert = {
        "alert_name": "KubePodCrashLooping",
        "namespace": "default",
        "deployment": "your-workload",
        "service": "your-service",
        "severity": "P1",
        "priority": "critical",
    }

    result = await app.ainvoke({"alert": alert})
    print(result["final_answer"])

    if "postmortem" in result:
        print(result["postmortem"]["report"])


if __name__ == "__main__":
    import asyncio

    asyncio.run(run_demo())
