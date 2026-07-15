import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend.app.domain.slo import evaluate_error_budget
from backend.app.api.reliability import ReliabilityDependencies, _validate_release_manifest, build_reliability_router
from backend.app.main import _score_benchmark_answer
from backend.app import main as server
from backend.app.services.ops_execution import StageTimeoutError, run_with_heartbeat
from backend.app.services.reliability_store import ReliabilityStore
from backend.app.services.external_traffic import build_external_traffic_payload


class ErrorBudgetTests(unittest.TestCase):
    def test_default_production_slo_is_99_9(self):
        budget = evaluate_error_budget({"service": "svc", "window_days": 30})
        self.assertEqual(budget["target_percent"], 99.9)
        self.assertAlmostEqual(budget["allowed_downtime_minutes"], 43.2)

    def test_workload_target_prefers_unhealthy_pod_for_evidence(self):
        pods = [
            {
                "name": "api-healthy-aaa",
                "workload_name": "api",
                "workload_kind": "Deployment",
                "ready": True,
                "phase": "Running",
                "restart_count": 0,
                "containers": [{"name": "api", "ready": True, "state": "running"}],
            },
            {
                "name": "api-bad-bbb",
                "workload_name": "api",
                "workload_kind": "Deployment",
                "ready": False,
                "phase": "Running",
                "restart_count": 9,
                "containers": [{"name": "api", "ready": False, "state": "waiting", "reason": "CrashLoopBackOff"}],
            },
        ]
        selected, matching = server._select_representative_pod(
            pods,
            workload_name="api",
            workload_type="Deployment",
        )
        self.assertEqual(selected["name"], "api-bad-bbb")
        self.assertEqual(len(matching), 2)

    def test_storage_permission_uses_runtime_group_before_existing_fs_group(self):
        plan = {
            "evidence": {
                "pod": {
                    "security_context": {"fsGroup": 1000, "runAsUser": 472, "runAsGroup": 472},
                    "containers": [{
                        "name": "grafana",
                        "security_context": {"runAsUser": 472, "runAsGroup": 472},
                        "volume_mounts": [{"name": "data", "mount_path": "/var/lib/grafana"}],
                    }],
                }
            }
        }
        self.assertEqual(server._storage_fs_group_from_evidence(plan), 472)

    def test_storage_permission_followup_switches_to_init_container_after_fs_group_fails(self):
        plan = {
            "namespace": "monitoring",
            "target": "Deployment/grafana",
            "summary": "volume permission denied",
            "evidence": {
                "state_text": "mkdir: can't create directory '/var/lib/grafana/plugins': Permission denied",
                "pod": {
                    "containers": [{
                        "name": "grafana",
                        "security_context": {"runAsUser": 472, "runAsGroup": 472},
                        "volume_mounts": [{"name": "data", "mount_path": "/var/lib/grafana"}],
                    }],
                },
            },
            "changes": [{"type": "patch_workload", "workload_type": "Deployment", "workload_name": "grafana"}],
        }
        followups = server._derive_followup_plans(plan, "storage volume permission denied")
        self.assertEqual(followups[0]["changes"][0]["type"], "patch_workload_runtime_security")
        init = followups[0]["changes"][0]["patch"]["spec"]["template"]["spec"]["initContainers"][0]
        self.assertIn("472:472", " ".join(init["command"]))

    def test_99_percent_slo_has_one_percent_budget(self):
        budget = evaluate_error_budget({
            "id": "svc",
            "service": "svc",
            "target_percent": 99,
            "window_days": 30,
            "observed_minutes": 43200,
            "downtime_minutes": 216,
        })
        self.assertEqual(budget["error_budget_percent"], 1.0)
        self.assertEqual(budget["allowed_downtime_minutes"], 432.0)
        self.assertAlmostEqual(budget["consumed_ratio"], 0.5)
        self.assertFalse(budget["freeze_changes"])

    def test_exhausted_budget_freezes_changes(self):
        budget = evaluate_error_budget({
            "service": "svc",
            "target_percent": 99,
            "window_days": 30,
            "observed_minutes": 43200,
            "downtime_minutes": 500,
        })
        self.assertEqual(budget["state"], "exhausted")
        self.assertTrue(budget["freeze_changes"])

    def test_store_persists_objective_and_release_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reliability.json"
            store = ReliabilityStore(str(path))
            saved = store.upsert_objective({"service": "checkout", "target_percent": 99.9, "window_days": 30})
            release = store.add_release({"service": "checkout", "status": "awaiting_approval"})
            restored = ReliabilityStore(str(path))
            self.assertEqual(restored.objectives()[0]["id"], saved["id"])
            self.assertEqual(restored.release(release["id"])["status"], "awaiting_approval")

    def test_store_falls_back_when_primary_path_is_not_writable(self):
        with tempfile.TemporaryDirectory() as directory:
            fallback = Path(directory) / "fallback" / "reliability.json"
            old = os.environ.get("RELIABILITY_STORE_FALLBACK_PATH")
            os.environ["RELIABILITY_STORE_FALLBACK_PATH"] = str(fallback)
            try:
                store = ReliabilityStore("/proc/luxyai/reliability.json")
                release = store.add_release({"service": "checkout", "status": "awaiting_approval"})
                self.assertEqual(store.path, fallback)
                self.assertEqual(ReliabilityStore(str(fallback)).release(release["id"])["service"], "checkout")
            finally:
                if old is None:
                    os.environ.pop("RELIABILITY_STORE_FALLBACK_PATH", None)
                else:
                    os.environ["RELIABILITY_STORE_FALLBACK_PATH"] = old

    def test_store_uses_emergency_path_when_primary_and_fallback_are_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            emergency = Path(directory) / "emergency" / "reliability.json"
            old_fallback = os.environ.get("RELIABILITY_STORE_FALLBACK_PATH")
            old_emergency = os.environ.get("RELIABILITY_STORE_EMERGENCY_PATH")
            os.environ["RELIABILITY_STORE_FALLBACK_PATH"] = "/proc/luxyai-fallback/reliability.json"
            os.environ["RELIABILITY_STORE_EMERGENCY_PATH"] = str(emergency)
            try:
                store = ReliabilityStore("/proc/luxyai-primary/reliability.json")
                store.add_release({"service": "checkout", "status": "awaiting_approval"})
                self.assertEqual(store.path, emergency)
                self.assertFalse(store.storage_status()["durable"])
            finally:
                if old_fallback is None:
                    os.environ.pop("RELIABILITY_STORE_FALLBACK_PATH", None)
                else:
                    os.environ["RELIABILITY_STORE_FALLBACK_PATH"] = old_fallback
                if old_emergency is None:
                    os.environ.pop("RELIABILITY_STORE_EMERGENCY_PATH", None)
                else:
                    os.environ["RELIABILITY_STORE_EMERGENCY_PATH"] = old_emergency


class ObservableExecutionTests(unittest.IsolatedAsyncioTestCase):
    def _request(self):
        return Request({
            "type": "http",
            "method": "POST",
            "path": "/api/ops/jobs/ops-test/approve-step",
            "headers": [(b"x-auth-request-user", b"unit-test")],
            "client": ("127.0.0.1", 12345),
        })

    async def test_stage_emits_heartbeat(self):
        heartbeats = []

        async def slow_result():
            await asyncio.sleep(0.08)
            return "ok"

        result = await run_with_heartbeat(
            slow_result(),
            stage="probe",
            timeout_seconds=1,
            heartbeat_seconds=0.02,
            on_heartbeat=lambda elapsed, remaining: self._record(heartbeats, elapsed, remaining),
        )
        self.assertEqual(result, "ok")
        self.assertGreaterEqual(len(heartbeats), 1)

    async def test_stage_hard_timeout(self):
        async def never_finishes():
            await asyncio.sleep(5)

        with self.assertRaises(StageTimeoutError):
            await run_with_heartbeat(
                never_finishes(),
                stage="probe",
                timeout_seconds=0.05,
                heartbeat_seconds=0.01,
            )

    async def test_recovery_verification_stops_immediately_on_terminal_failure(self):
        terminal = {
            "status": "completed",
            "recovered": False,
            "message": "still failing",
            "terminal_unresolved": [{"name": "grafana-abc", "category": "storage_config", "phase": "Running"}],
        }
        old_grace = os.environ.get("OPS_VERIFY_INITIAL_GRACE_SECONDS")
        os.environ["OPS_VERIFY_INITIAL_GRACE_SECONDS"] = "0"
        try:
            with patch.object(server, "_probe_plan_recovery", AsyncMock(return_value=terminal)) as probe:
                result = await asyncio.wait_for(
                    server._verify_plan_recovery({"changes": [{"type": "patch_workload"}]}, [{"status": "completed"}]),
                    timeout=0.05,
                )
            self.assertEqual(result["status"], "needs_followup")
            self.assertEqual(probe.await_count, 1)
        finally:
            if old_grace is None:
                os.environ.pop("OPS_VERIFY_INITIAL_GRACE_SECONDS", None)
            else:
                os.environ["OPS_VERIFY_INITIAL_GRACE_SECONDS"] = old_grace

    async def _record(self, target, elapsed, remaining):
        target.append((elapsed, remaining))

    async def test_diagnosis_only_job_reaches_terminal_state(self):
        job_id = "ops-test-terminal"
        server.OPS_JOBS[job_id] = {
            "id": job_id, "status": "running", "stage": "starting", "events": [],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        result = {
            "status": "diagnostic_completed", "executed": False, "steps": [], "results": [],
            "alternative_plans": [], "message": "证据不足",
        }
        try:
            with patch.object(server, "_execute_ops_plan_once", AsyncMock(return_value=result)), patch.object(
                server, "_llm_ops_summary", AsyncMock(return_value={"source": "test", "content": "证据不足", "followup_plans": []})
            ):
                await server._run_ops_job(job_id, {"title": "diagnosis", "steps": [{"title": "read evidence"}], "changes": []}, False, asyncio.Event())
            self.assertEqual(server.OPS_JOBS[job_id]["status"], "unresolved")
            self.assertEqual(server.OPS_JOBS[job_id]["stage"], "needs_operator")
        finally:
            server.OPS_JOBS.pop(job_id, None)

    async def test_autonomous_job_continues_diagnostic_followup_instead_of_stopping(self):
        job_id = "ops-test-diagnostic-followup"
        server.OPS_JOBS[job_id] = {
            "id": job_id, "status": "running", "stage": "starting", "events": [],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        first_result = {
            "status": "diagnostic_completed",
            "executed": False,
            "steps": [],
            "results": [],
            "verification": {"recovered": None, "message": "需要继续取证"},
            "alternative_plans": [{
                "id": "deep-dive-logs",
                "title": "继续取证：重建后读取 previous logs",
                "summary": "当前没有变更，但需要继续读取新 Pod 的失败证据。",
                "steps": [{"id": "previous-logs", "title": "读取 previous logs"}],
                "changes": [],
                "source": "evidence_replan",
            }],
            "message": "证据不足，需要继续取证",
        }
        second_result = {
            "status": "completed",
            "executed": False,
            "steps": [],
            "results": [],
            "verification": {"recovered": True, "message": "目标已恢复"},
            "alternative_plans": [],
            "message": "完成",
        }
        try:
            runner = AsyncMock(side_effect=[first_result, second_result])
            with patch.object(server, "_execute_ops_plan_once", runner), patch.object(
                server, "_llm_ops_summary", AsyncMock(return_value={"source": "test", "content": "完成", "followup_plans": []})
            ):
                await server._run_ops_job(
                    job_id,
                    {"title": "initial diagnosis", "steps": [{"title": "查看事件"}], "changes": []},
                    True,
                    asyncio.Event(),
                )
            self.assertEqual(runner.await_count, 2)
            self.assertEqual(server.OPS_JOBS[job_id]["stage"], "recovered")
            self.assertEqual(server.OPS_JOBS[job_id]["status"], "completed")
        finally:
            server.OPS_JOBS.pop(job_id, None)

    async def test_failed_change_switches_to_different_strategy_when_execution_plane_is_healthy(self):
        job_id = "ops-test-change-followup"
        server.OPS_JOBS[job_id] = {
            "id": job_id, "status": "running", "stage": "starting", "events": [],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        next_plan = {
            "id": "alternative-runtime-security",
            "title": "改用受控 initContainer 修复目录属主",
            "target": "Deployment/orders-api",
            "namespace": "prod",
            "steps": [{"title": "核对新的失败 Pod"}],
            "changes": [{
                "type": "patch_workload_runtime_security",
                "namespace": "prod",
                "workload_type": "Deployment",
                "workload_name": "orders-api",
                "patch": {"spec": {"template": {"spec": {"initContainers": [{"name": "prepare-volume"}]}}}},
            }],
            "stepwise_confirmation": True,
        }
        first_result = {
            "status": "failed",
            "executed": False,
            "results": [{"status": "failed", "result": {"error": "patch validation did not converge"}}],
            "verification": {"recovered": False, "message": "new pod still fails"},
            "alternative_plans": [next_plan],
        }
        second_result = {
            "status": "completed", "executed": True, "results": [],
            "verification": {"recovered": True, "message": "target recovered"},
            "alternative_plans": [],
        }
        initial = {
            "title": "先尝试 fsGroup",
            "target": "Deployment/orders-api",
            "namespace": "prod",
            "changes": [{
                "type": "patch_workload",
                "namespace": "prod",
                "workload_type": "Deployment",
                "workload_name": "orders-api",
                "patch": {"spec": {"template": {"spec": {"securityContext": {"fsGroup": 1000}}}}},
            }],
        }
        try:
            runner = AsyncMock(side_effect=[first_result, second_result])
            with patch.object(server, "_execute_ops_plan_once", runner), patch.object(
                server, "_llm_ops_summary", AsyncMock(return_value={"source": "test", "content": "恢复", "followup_plans": []})
            ):
                await server._run_ops_job(job_id, initial, True, asyncio.Event())
            self.assertEqual(runner.await_count, 2)
            self.assertEqual(server.OPS_JOBS[job_id]["status"], "completed")
            self.assertEqual(server.OPS_JOBS[job_id]["stage"], "recovered")
            self.assertEqual(len(server.OPS_JOBS[job_id]["history"]), 2)
        finally:
            server.OPS_JOBS.pop(job_id, None)

    async def test_permission_failure_stops_with_operator_steps_instead_of_looping(self):
        job_id = "ops-test-permission-boundary"
        server.OPS_JOBS[job_id] = {
            "id": job_id, "status": "running", "stage": "starting", "events": [],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        failed_result = {
            "status": "failed",
            "executed": False,
            "results": [{
                "status": "failed",
                "result": {
                    "error": "HTTP 403 Forbidden",
                    "permission_guidance": {"do_this": ["绑定所需 ClusterRole 后重新执行。"]},
                },
            }],
            "verification": {"recovered": False, "message": "change API rejected"},
            "alternative_plans": [{"title": "不应自动执行", "steps": [{"title": "retry"}], "changes": []}],
        }
        try:
            runner = AsyncMock(return_value=failed_result)
            with patch.object(server, "_execute_ops_plan_once", runner), patch.object(
                server, "_llm_ops_summary", AsyncMock(return_value={"source": "test", "content": "权限阻断", "followup_plans": []})
            ):
                await server._run_ops_job(
                    job_id,
                    {"title": "patch", "target": "Deployment/orders", "changes": [{"type": "patch_workload"}]},
                    True,
                    asyncio.Event(),
                )
            self.assertEqual(runner.await_count, 1)
            self.assertEqual(server.OPS_JOBS[job_id]["status"], "unresolved")
            self.assertEqual(server.OPS_JOBS[job_id]["stage"], "needs_operator")
            self.assertIn("绑定所需 ClusterRole", server.OPS_JOBS[job_id]["result"]["operator_steps"][0])
        finally:
            server.OPS_JOBS.pop(job_id, None)

    def test_workload_permission_denied_is_not_misclassified_as_rbac_blocker(self):
        result = {
            "status": "failed",
            "results": [{
                "status": "failed",
                "result": {"error": "patch validation did not converge"},
            }],
            "verification": {
                "recovered": False,
                "message": "new pod is still failing",
                "unresolved": [{
                    "name": "orders-api-next",
                    "logs": "mkdir: can't create directory '/data/cache': Permission denied",
                }],
            },
        }
        self.assertFalse(server._operator_blocking_execution_failure(result))

    def test_executor_timeout_is_treated_as_indeterminate_execution_boundary(self):
        result = {
            "status": "failed",
            "results": [{
                "status": "failed",
                "result": {"error": "Kubernetes change timed out", "timeout": True},
            }],
        }
        self.assertTrue(server._operator_blocking_execution_failure(result))

    def test_strategy_fingerprint_ignores_reworded_reason_but_keeps_patch_difference(self):
        base = {
            "changes": [{
                "type": "patch_workload", "namespace": "prod", "workload_name": "orders",
                "patch": {"spec": {"template": {"spec": {"securityContext": {"fsGroup": 1000}}}}},
                "reason": "第一次说明",
            }],
        }
        reworded = {"changes": [{**base["changes"][0], "reason": "模型换了一种说法"}]}
        different = {"changes": [{
            **base["changes"][0],
            "patch": {"spec": {"template": {"spec": {"securityContext": {"fsGroup": 2000}}}}},
        }]}
        self.assertEqual(server._change_fingerprint(base), server._change_fingerprint(reworded))
        self.assertNotEqual(server._change_fingerprint(base), server._change_fingerprint(different))

    def test_manual_followup_keeps_failed_strategy_lineage_across_jobs(self):
        failed_plan = {
            "title": "fsGroup 修复",
            "target": "Deployment/orders",
            "changes": [{
                "type": "patch_workload", "namespace": "prod", "workload_name": "orders",
                "patch": {"spec": {"template": {"spec": {"securityContext": {"fsGroup": 1000}}}}},
            }],
        }
        failed_fingerprint = server._change_fingerprint(failed_plan)
        failed_change_fingerprint = server._change_item_fingerprint(failed_plan["changes"][0])
        followup = {
            "title": "改用 initContainer 修复目录属主",
            "target": "Deployment/orders",
            "changes": [{
                "type": "patch_workload_runtime_security", "namespace": "prod", "workload_name": "orders",
                "patch": {"spec": {"template": {"spec": {"initContainers": [{"name": "prepare-volume"}]}}}},
            }],
        }
        result = {
            "status": "unresolved",
            "verification": {"recovered": False, "message": "new pod still reports permission denied"},
            "alternative_plans": [followup],
        }
        history = [{
            "attempt": 1,
            "strategy": failed_plan["title"],
            "fingerprint": failed_fingerprint,
            "actions": ["patch_workload"],
            "change_fingerprints": [failed_change_fingerprint],
            "result": result,
        }]
        attached = server._attach_ops_continuation_context(
            "ops-parent", failed_plan, result, {failed_fingerprint}, history,
        )
        prepared = server._apply_ops_continuation_context(attached["alternative_plans"][0])
        self.assertEqual(prepared["_lineage_id"], "ops-parent")
        self.assertIn(failed_fingerprint, prepared["_attempted_strategy_fingerprints"])
        self.assertIn(failed_change_fingerprint, prepared["_attempted_change_fingerprints"])
        self.assertIn("permission denied", prepared["_last_failure"]["outcome"])
        self.assertEqual(prepared["_prior_attempts"][0]["strategy"], "fsGroup 修复")

    def test_lineage_attempted_strategy_cannot_be_selected_again(self):
        repeated = {
            "title": "same patch, reworded",
            "target": "Deployment/orders",
            "steps": [{"title": "retry"}],
            "changes": [{
                "type": "patch_workload", "namespace": "prod", "workload_name": "orders",
                "patch": {"spec": {"template": {"spec": {"securityContext": {"fsGroup": 1000}}}}},
                "reason": "new wording only",
            }],
        }
        attempted = {server._change_fingerprint(repeated)}
        self.assertIsNone(server._select_next_ops_plan([repeated], attempted, autonomous=False))

    async def test_step_approval_survives_audit_sink_failure(self):
        job_id = "ops-test-approval"
        approval_event = asyncio.Event()
        server.OPS_JOBS[job_id] = {
            "id": job_id,
            "status": "awaiting_approval",
            "stage": "awaiting_change_approval",
            "message": "等待确认",
            "pending_approval": {
                "change_index": 1,
                "changes_total": 1,
                "action": "create_pvc",
                "target": "PVC/data-missing",
            },
            "events": [],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        server.OPS_JOB_STEP_APPROVAL_EVENTS[job_id] = approval_event
        try:
            with patch.object(server, "_audit_event", side_effect=OSError("audit sink down")):
                result = await server.approve_ops_job_step(
                    job_id,
                    server.OpsStepApprovalRequest(change_index=1, confirm=True, comment="确认执行"),
                    self._request(),
                )
            self.assertEqual(result["status"], "running")
            self.assertEqual(result["stage"], "change_approval_received")
            self.assertTrue(approval_event.is_set())
            self.assertTrue(any(event.get("stage") == "audit_warning" for event in server.OPS_JOBS[job_id]["events"]))
        finally:
            server.OPS_JOBS.pop(job_id, None)
            server.OPS_JOB_STEP_APPROVAL_EVENTS.pop(job_id, None)

    async def test_live_pvc_evidence_cancels_stale_recreate_and_requires_new_approval(self):
        plan = {
            "title": "generic recovery",
            "cluster": "nonprod",
            "cluster_id": "c-nonprod",
            "source": "rancher",
            "namespace": "k8s-agent",
            "target": "Deployment/k8s-agent-loki",
            "pod_name": "k8s-agent-loki-abc",
            "summary": "FailedScheduling",
            "steps": [{"id": "events", "title": "查看事件"}],
            "changes": [{
                "type": "recreate_pod",
                "namespace": "k8s-agent",
                "pod_name": "k8s-agent-loki-abc",
                "workload_type": "Deployment",
                "workload_name": "k8s-agent-loki",
            }],
        }
        evidence = {
            "pod": {
                "name": "k8s-agent-loki-abc",
                "namespace": "k8s-agent",
                "workload": {"kind": "Deployment", "name": "k8s-agent-loki"},
            },
            "events": [{
                "type": "Warning",
                "reason": "FailedScheduling",
                "message": "0/10 nodes are available: pod has unbound immediate PersistentVolumeClaims.",
            }],
            "storage": [{
                "pvc": "loki-data",
                "pvc_phase": "Pending",
                "requested": "10Gi",
                "access_modes": ["ReadWriteMany"],
                "storage_class": "nfs-static",
            }],
            "logs": {},
            "workload": {},
            "services": [],
        }
        old_server = os.environ.get("AUTO_OPS_STATIC_PV_NFS_SERVER")
        old_path = os.environ.get("AUTO_OPS_STATIC_PV_NFS_BASE_PATH")
        os.environ["AUTO_OPS_STATIC_PV_NFS_SERVER"] = "10.0.0.10"
        os.environ["AUTO_OPS_STATIC_PV_NFS_BASE_PATH"] = "/exports"
        try:
            with patch.object(server, "_collect_plan_deep_evidence", AsyncMock(return_value=evidence)), patch.object(
                server, "_execute_change", AsyncMock()
            ) as execute_change:
                result = await server._execute_ops_plan_once(plan, summarize=False)
            self.assertEqual(result["status"], "planned")
            self.assertFalse(result["executed"])
            execute_change.assert_not_awaited()
            replacement = result["alternative_plans"][0]
            self.assertEqual(replacement["changes"][0]["type"], "create_pv")
            self.assertTrue(replacement["requires_high_risk_confirmation"])
            self.assertEqual(replacement["cluster_id"], "c-nonprod")
            self.assertEqual(replacement["source"], "rancher")
        finally:
            if old_server is None:
                os.environ.pop("AUTO_OPS_STATIC_PV_NFS_SERVER", None)
            else:
                os.environ["AUTO_OPS_STATIC_PV_NFS_SERVER"] = old_server
            if old_path is None:
                os.environ.pop("AUTO_OPS_STATIC_PV_NFS_BASE_PATH", None)
            else:
                os.environ["AUTO_OPS_STATIC_PV_NFS_BASE_PATH"] = old_path

    async def test_emergency_restart_translates_to_restart_action(self):
        enqueue = AsyncMock(return_value={"id": "ops-emergency", "status": "queued"})
        release = {
            "id": "rel-emergency", "service": "checkout", "cluster": "local", "namespace": "prod",
            "workload_kind": "Deployment", "workload_name": "checkout", "release_mode": "existing",
            "change_channel": "emergency_recovery", "emergency_action": "restart_component",
            "emergency_reason": "组件故障，需要恢复服务", "approved_by": "operator",
        }
        with patch.object(server, "_enqueue_ops_job", enqueue):
            await server._submit_release_job(release, "operator")
        plan = enqueue.await_args.args[0]
        self.assertEqual(plan["change_class"], "emergency_recovery")
        self.assertEqual(plan["changes"][0]["type"], "restart")

    async def test_emergency_rollback_translates_to_image_patch(self):
        enqueue = AsyncMock(return_value={"id": "ops-rollback", "status": "queued"})
        release = {
            "id": "rel-rollback", "service": "checkout", "cluster": "local", "namespace": "prod",
            "workload_kind": "Deployment", "workload_name": "checkout", "release_mode": "existing",
            "change_channel": "emergency_recovery", "emergency_action": "rollback",
            "container_name": "app", "image": "registry.local/checkout:v1.2.2", "approved_by": "operator",
        }
        with patch.object(server, "_enqueue_ops_job", enqueue):
            await server._submit_release_job(release, "operator")
        change = enqueue.await_args.args[0]["changes"][0]
        self.assertEqual(change["type"], "patch_workload")
        self.assertEqual(change["patch"]["spec"]["template"]["spec"]["containers"][0]["image"], "registry.local/checkout:v1.2.2")

    async def test_emergency_restore_config_translates_to_expected_patch(self):
        enqueue = AsyncMock(return_value={"id": "ops-restore", "status": "queued"})
        patch_body = {"spec": {"template": {"metadata": {"annotations": {"restored": "true"}}}}}
        release = {
            "id": "rel-restore", "service": "checkout", "cluster": "local", "namespace": "prod",
            "workload_kind": "Deployment", "workload_name": "checkout", "release_mode": "existing",
            "change_channel": "emergency_recovery", "emergency_action": "restore_config",
            "patch": patch_body, "approved_by": "operator",
        }
        with patch.object(server, "_enqueue_ops_job", enqueue):
            await server._submit_release_job(release, "operator")
        change = enqueue.await_args.args[0]["changes"][0]
        self.assertEqual(change["type"], "patch_workload")
        self.assertEqual(change["patch"], patch_body)


class ReleaseAndBenchmarkTests(unittest.TestCase):
    def test_skill_memory_does_not_prepend_execution_steps(self):
        plan = {"steps": [{"id": "ai-step", "title": "AI 动态诊断"}], "changes": []}
        skill = {
            "id": "storage-skill",
            "name": "存储权限专家",
            "category": "storage",
            "summary": "处理目录权限",
            "risk": "medium",
            "success_criteria": ["Pod Ready"],
            "allowed_actions": ["patch_workload"],
            "enabled": True,
        }
        with patch.object(server.OPS_SKILL_REGISTRY, "match", return_value={"matches": [{"skill": skill, "confidence": 0.9, "score": 0.9}]}), patch.object(
            server.OPS_SKILL_REGISTRY,
            "steps_from_matches",
            return_value=[{"id": "skill-step", "title": "Skill 建议步骤"}],
        ):
            enriched = server._attach_operator_skills_to_plan(plan, {"question": "permission denied"})
        self.assertEqual(enriched["steps"][0]["id"], "ai-step")
        self.assertEqual(enriched["skill_suggested_steps"][0]["id"], "skill-step")

    def test_external_traffic_filters_observed_ebpf_flows_by_workload(self):
        payload = build_external_traffic_payload(
            [],
            observed_flows=[
                {
                    "source_system": "ebpf_beyla",
                    "direction": "egress",
                    "source": {"cluster": "c-prod", "namespace": "pay", "kind": "Deployment", "name": "orders-api", "pod": "orders-api-1"},
                    "destination": {"type": "external_domain", "name": "elk.example.local", "address": "elk.example.local", "port": 443},
                    "evidence": ["beyla network_flow orders-api -> elk.example.local"],
                },
                {
                    "source_system": "ebpf_beyla",
                    "direction": "egress",
                    "source": {"cluster": "c-prod", "namespace": "pay", "kind": "Deployment", "name": "billing-api", "pod": "billing-api-1"},
                    "destination": {"type": "external_domain", "name": "kafka.example.local", "address": "kafka.example.local", "port": 9092},
                    "evidence": ["beyla network_flow billing-api -> kafka.example.local"],
                },
            ],
            scope={"cluster": "c-prod", "namespace": "pay", "workload": "orders-api"},
        )
        self.assertEqual(payload["summary"]["total"], 1)
        self.assertEqual(payload["summary"]["ebpf_observed"], 1)
        self.assertEqual(payload["flows"][0]["source"]["name"], "orders-api")

    def test_chat_selected_fourth_workload_does_not_fall_back_to_ranked_first(self):
        pods = [
            {"name": "first-api-a", "workload_name": "first-api", "ready": False},
            {"name": "second-api-a", "workload_name": "second-api", "ready": False},
            {"name": "third-agent-a", "workload_name": "third-agent", "ready": False},
            {"name": "chosen-daemon-x", "workload_name": "chosen-daemon", "ready": False},
        ]
        req = server.ChatRequest(
            message="修复这个 DaemonSet",
            cluster_id="c-prod",
            namespace="logging",
            deployment="chosen-daemon",
            workload_type="DaemonSet",
        )
        selected = server._select_chat_target_pod(pods, req)
        self.assertEqual(selected["name"], "chosen-daemon-x")

    def test_chat_target_binding_rejects_cross_workload_action(self):
        req = server.ChatRequest(
            message="修复我选择的对象",
            cluster="nonprod",
            cluster_id="c-nonprod",
            namespace="prod",
            deployment="orders-api",
            workload_type="Deployment",
            target_id="c-nonprod|prod|Deployment|orders-api",
        )
        data = {
            "answer": "candidate",
            "raw": {
                "alert": {},
                "diagnosis": {
                    "proposed_changes": [],
                    "remediation_plan": {
                        "changes": [{
                            "type": "restart",
                            "namespace": "prod",
                            "workload_type": "Deployment",
                            "workload_name": "ranked-first-api",
                        }],
                    },
                },
                "decision": {"proposed_changes": []},
            },
        }
        bound = server._enforce_chat_target_binding(req, data)
        raw = bound["raw"]
        self.assertEqual(raw["alert"]["workload_name"], "orders-api")
        self.assertEqual(raw["diagnosis"]["remediation_plan"]["target"], "Deployment/orders-api")
        self.assertEqual(raw["diagnosis"]["remediation_plan"]["changes"], [])
        self.assertEqual(raw["target_binding"]["rejected_cross_target_actions"][0]["target"], "ranked-first-api")

    def test_release_manifest_is_validated_and_normalized(self):
        manifest, report = _validate_release_manifest(
            """apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: prod
spec:
  replicas: 2
  selector:
    matchLabels: {app: checkout}
  template:
    metadata:
      labels: {app: checkout}
    spec:
      automountServiceAccountToken: false
      containers:
        - name: app
          image: registry.local/checkout:v1.2.3
          securityContext:
            allowPrivilegeEscalation: false
""",
            {"release_mode": "new", "namespace": "prod", "workload_kind": "Deployment", "workload_name": ""},
        )
        self.assertEqual(manifest["metadata"]["name"], "checkout")
        self.assertTrue(report["immutable_images"])
        self.assertEqual(len(report["digest"]), 16)

    def test_frontier_sre_score_explains_every_dimension(self):
        score = _score_benchmark_answer(
            "根因候选：OOMKilled。证据来自 previous logs、Events 和 Deployment spec。先人工审批并 dry-run，"
            "patch resources 后 rollout；持续观察 Pod Ready、restart_count、P95 和错误率 15 分钟。未恢复则回滚并重新取证依赖拓扑。",
            {"findings": [{"name": "checkout", "namespace": "prod", "category": "crashloop"}]},
            1800,
            {"total_tokens": 1200},
        )
        self.assertEqual(sum(item["weight"] for item in score["criteria"]), 100)
        self.assertEqual(len(score["criteria"]), 6)
        self.assertIn(score["grade"], {"S", "A", "B", "C", "D"})
        self.assertTrue(all("evidence" in item and "missing" in item for item in score["criteria"]))

    def test_emergency_recovery_can_bypass_budget_freeze_with_audit(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ReliabilityStore(str(Path(directory) / "reliability.json"))
            store.upsert_objective({
                "service": "checkout", "target_percent": 99.9, "window_days": 30,
                "observed_minutes": 43200, "downtime_minutes": 120,
            })

            async def submit(release, actor):
                return {"id": "ops-emergency", "status": "queued", "actor": actor}

            app = FastAPI()
            app.include_router(build_reliability_router(ReliabilityDependencies(
                store=store,
                gate_evaluator=lambda *args: {"verdict": "pass", "risk": {"risk_score": 0.2}},
                submit_release=submit,
            )))
            client = TestClient(app)
            response = client.post("/api/releases", json={
                "service": "checkout", "cluster": "local", "namespace": "prod",
                "workload_kind": "Deployment", "workload_name": "checkout",
                "release_mode": "existing", "change_channel": "emergency_recovery",
                "emergency_action": "restart_component",
                "emergency_reason": "当前组件故障导致业务不可用，需要受控重启恢复服务",
            })
            self.assertEqual(response.status_code, 200, response.text)
            release = response.json()["release"]
            self.assertEqual(release["status"], "awaiting_approval")
            self.assertTrue(release["emergency_audit"]["budget_freeze_bypassed"])
            approved = client.post(f"/api/releases/{release['id']}/approve", json={"confirm": True, "comment": "已复核影响范围和回退条件"})
            self.assertEqual(approved.status_code, 200, approved.text)
            executed = client.post(f"/api/releases/{release['id']}/execute")
            self.assertEqual(executed.status_code, 200, executed.text)

    def test_standard_release_returns_operator_readable_report(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ReliabilityStore(str(Path(directory) / "reliability.json"))
            store.upsert_objective({"service": "checkout", "target_percent": 99.9, "window_days": 30})

            app = FastAPI()
            app.include_router(build_reliability_router(ReliabilityDependencies(
                store=store,
                gate_evaluator=lambda *args: {
                    "verdict": "pass",
                    "reason": "候选策略位于错误预算安全包络内。",
                    "risk": {"diff_risk": 0.12, "amplification_factor": 0.35},
                    "selected_strategy": {"first_ratio": 0.01, "step_ratio": 0.02, "max_ratio": 0.1, "observation_window_min": 20, "batches": 5},
                    "candidate_strategies": [{"within_envelope": True}],
                    "safety_envelope": {"budget_cost_limit": 0.02},
                    "blast_radius": {
                        "impact_level": "low",
                        "amplification_factor": 0.35,
                        "blast_radius": {"impacted_services": [], "impacted_pods": [], "related_dependencies": [], "critical_paths": []},
                    },
                    "algorithm": {"name": "SemanticGrayReleaseGate"},
                },
                submit_release=lambda release, actor: {"id": "ops-release", "status": "queued"},
            )))
            client = TestClient(app)
            response = client.post("/api/releases", json={
                "service": "checkout", "cluster": "local", "namespace": "prod",
                "workload_kind": "Deployment", "workload_name": "checkout",
                "release_mode": "existing", "change_channel": "standard",
                "container_name": "app", "image": "registry.local/checkout:v1.2.3",
                "change_summary": "升级 checkout 到 v1.2.3",
            })
            self.assertEqual(response.status_code, 200, response.text)
            report = response.json()["release"]["report"]
            self.assertIn("灰度", report["allowed_scope"])
            self.assertIn("镜像", report["image_check"])
            self.assertGreaterEqual(len(report["evidence"]), 4)

    def test_standard_release_blocks_high_risk_image_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ReliabilityStore(str(Path(directory) / "reliability.json"))
            store.upsert_objective({"service": "checkout", "target_percent": 99.9, "window_days": 30})
            app = FastAPI()
            app.include_router(build_reliability_router(ReliabilityDependencies(
                store=store,
                gate_evaluator=lambda *args: {"verdict": "pass", "risk": {"diff_risk": 0.1}, "reason": "灰度策略可行"},
                submit_release=lambda release, actor: {"id": "ops-release", "status": "queued"},
            )))
            client = TestClient(app)
            with patch("backend.app.api.reliability._scan_release_images", AsyncMock(return_value={
                "status": "ok",
                "summary": "发现 1 个 high 漏洞。",
                "risk_level": "high",
                "high": 1,
                "images": ["registry.local/checkout:v1.2.3"],
            })):
                response = client.post("/api/releases", json={
                    "service": "checkout", "cluster": "local", "namespace": "prod",
                    "workload_kind": "Deployment", "workload_name": "checkout",
                    "release_mode": "existing", "change_channel": "standard",
                    "container_name": "app", "image": "registry.local/checkout:v1.2.3",
                    "change_summary": "升级 checkout 到 v1.2.3",
                })
            self.assertEqual(response.status_code, 200, response.text)
            release = response.json()["release"]
            self.assertEqual(release["status"], "blocked")
            self.assertEqual(release["gate"]["action"], "block_image_risk")
            self.assertEqual(release["report"]["image_scan"]["risk_level"], "high")


if __name__ == "__main__":
    unittest.main()
