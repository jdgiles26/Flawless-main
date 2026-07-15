import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, Loader2, ShieldCheck, Square, TerminalSquare } from "lucide-react";

import { apiGet, apiPost, asList } from "../lib/api";


export type OpsPlan = {
  id?: string;
  title?: string;
  target?: string;
  summary?: string;
  steps?: any[];
  changes?: any[];
  success_criteria?: any[];
  [key: string]: any;
};


function classNames(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval", "cancelling"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "unresolved", "blocked"]);
const ACTIVE_EVENT_STAGES = new Set([
  "queued", "starting", "attempt", "collecting_evidence", "step_start", "step_waiting",
  "change_start", "change_waiting", "change_approval_received", "verifying", "replanning", "summarizing", "strategy_switch",
]);
const EXECUTION_PHASES = ["Collect Evidence", "Diagnose Root Cause", "Apply Changes", "Verify Recovery"];
const HIGH_RISK_ACTIONS = new Set([
  "create_workload", "expand_pvc", "create_pvc", "create_pv", "patch_workload_volume",
  "patch_workload_runtime_security",
  "cordon_node", "evict_pod", "uncordon_node", "rollback_workload", "patch_service",
  "create_configmap", "patch_pdb",
]);

function formatTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function stageLabel(stage: unknown) {
  const key = String(stage || "");
  const labels: Record<string, string> = {
    queued: "Queued",
    starting: "Starting",
    attempt: "Strategy Attempt",
    release_gate: "Risk Gate",
    release_blocked: "Blocked by Gate",
    collecting_evidence: "Collecting Evidence",
    collecting_evidence_done: "Evidence Collected",
    step_waiting: "Diagnosis in Progress",
    step_start: "Diagnosis Started",
    step_done: "Diagnosis Complete",
    change_waiting: "Waiting for Change Result",
    change_start: "Applying Change",
    change_done: "Change Result Received",
    awaiting_change_approval: "Awaiting Step Approval",
    change_approval_received: "Approval Received",
    change_approved: "Step Approved",
    stage_timeout: "Stage Timed Out",
    verifying: "Verifying Recovery",
    verification_done: "Verification Complete",
    replanning: "Replanning Strategy",
    summarizing: "Generating Summary",
    strategy_switch: "Switching Strategy",
    recovered: "Recovery Complete",
    needs_operator: "Waiting for Operator",
    execution_failed: "Execution Failed",
    failed: "Terminated with Error",
    cancelled: "Cancelled",
    exhausted: "Attempts Exhausted",
    deduplicated: "Duplicate Strategy",
  };
  return labels[key] || key || "Running";
}

function statusTone(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (["completed", "success", "recovered"].includes(value)) return "success";
  if (["failed", "error"].includes(value)) return "danger";
  if (["blocked", "unresolved", "warning", "cancelled", "awaiting_approval"].includes(value)) return "warning";
  if (["running", "queued", "cancelling"].includes(value)) return "running";
  return "";
}

function compactJson(value: unknown, limit = 1600) {
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...` : text;
}

function eventIcon(event: any, active: boolean) {
  const tone = event?.level || statusTone(event?.change_status || event?.step_status || event?.stage);
  if (active && ACTIVE_EVENT_STAGES.has(String(event?.stage))) return <Loader2 className="spin" size={12} />;
  if (tone === "error" || tone === "danger") return <AlertTriangle size={12} />;
  if (tone === "warning") return <AlertTriangle size={12} />;
  if (tone === "success") return <CheckCircle2 size={12} />;
  return <Clock3 size={12} />;
}

function phaseIndex(stage: unknown) {
  const value = String(stage || "");
  if (["queued", "starting", "attempt", "release_gate", "collecting_evidence", "collecting_evidence_done"].includes(value)) return 0;
  if (["step_start", "step_waiting", "step_done", "replanning", "strategy_switch"].includes(value)) return 1;
  if (["awaiting_change_approval", "change_approval_received", "change_approved", "change_start", "change_waiting", "change_done"].includes(value)) return 2;
  return 3;
}

function permissionGuidance(value: any) {
  if (value?.permission_guidance) return value.permission_guidance;
  if (value?.result?.permission_guidance) return value.result.permission_guidance;
  if (value?.operator_steps?.summary) return value.operator_steps;
  return null;
}

function changeLabel(change: any) {
  const labels: Record<string, string> = {
    create_pvc: "Create Missing PVC", create_pv: "Create Static PV", expand_pvc: "Expand PVC",
    patch_workload_volume: "Fix Volume Reference", patch_workload: "Update Workload Configuration",
    recreate_pod: "Recreate Unhealthy Pod", restart: "Rolling Restart", cordon_node: "Cordon Node",
    patch_workload_runtime_security: "Fix Runtime Permissions",
    patch_service_account: "Correct ServiceAccount", create_configmap: "Restore ConfigMap",
    db_restart_instance: "Restart Database Instance", db_kill_session: "Terminate Database Session",
    db_expand_storage: "Expand Database Storage", db_failover: "Trigger Database Failover",
    db_apply_parameter: "Adjust Database Parameters", vm_restart_service: "Restart Host Service",
    vm_reboot: "Reboot Virtual Machine", vm_expand_disk: "Expand VM Disk",
    vm_run_approved_script: "Run Approved Host Script", vm_snapshot: "Create VM Snapshot",
    middleware_rebalance: "Rebalance Middleware", storage_expand_volume: "Expand Enterprise Storage Volume",
    infra_run_approved_action: "Approved Infrastructure Action",
  };
  return labels[String(change?.type || "")] || change?.type || "Infrastructure Change";
}

function PermissionCard({ guidance }: { guidance: any }) {
  if (!guidance) return null;
  return <div className="ops-permission-card">
    <b>Blocked by permissions, not a stalled diagnosis</b>
    <p>{guidance.summary || "The current identity does not have the permissions required to submit this Kubernetes change."}</p>
    {asList(guidance.do_this).map((item: any, index: number) => <span key={`${item}-${index}`}><i>{index + 1}</i>{String(item)}</span>)}
    {asList(guidance.minimal_resources).length > 0 && <small>Minimum resource scope: {asList(guidance.minimal_resources).join(", ")}</small>}
  </div>;
}

function progressPercent(job: any) {
  const status = String(job?.status || "");
  if (["completed"].includes(status)) return 100;
  if (["failed", "cancelled", "unresolved", "blocked"].includes(status)) return 100;
  const events = asList(job?.events);
  const weighted = events.reduce((total, event) => {
    const stage = String(event?.stage || "");
    if (stage.endsWith("_done") || stage === "recovered") return total + 14;
    if (stage === "change_start" || stage === "step_start" || stage === "verifying") return total + 8;
    return total + 4;
  }, 4);
  return Math.max(8, Math.min(96, weighted));
}

function renderEventDetails(event: any) {
  const evidence = event?.evidence_summary;
  const stepResult = event?.step_result;
  const change = event?.change;
  const changeResult = event?.change_result;
  const verification = event?.verification;
  const releaseGate = event?.release_gate;
  const guidance = permissionGuidance(changeResult);
  const logs = asList(stepResult?.logs_tail);
  return (
    <>
      {evidence && (
        <div className="ops-event-chips">
          <span>logs {evidence.logs ?? 0}</span><span>events {evidence.events ?? 0}</span><span>svc {evidence.services ?? 0}</span><span>storage {evidence.storage ?? 0}</span>{evidence.node && <span>node {evidence.node}</span>}
          {evidence.error && <span className="hot">Evidence Error</span>}
        </div>
      )}
      {releaseGate && (
        <div className="ops-event-chips">
          <span>Risk {releaseGate.risk_score ?? releaseGate.risk_level ?? "-"}</span>
          <span>{releaseGate.allowed === false ? "Blocked by Gate" : "Passed Gate"}</span>
        </div>
      )}
      {stepResult && (
        <div className="ops-event-details">
          <span>{stepResult.status || "completed"} · {stepResult.finished_at ? formatTime(stepResult.finished_at) : "Just now"}</span>
          {asList(stepResult.artifacts).length > 0 && <small>Evidence: {asList(stepResult.artifacts).join(" / ")}</small>}
          {logs.length > 0 && <pre>{logs.join("\n")}</pre>}
        </div>
      )}
      {change && (
        <div className="ops-event-details">
          <span>{change.type || "change"} · {change.target || change.namespace || "-"}</span>
          {change.patch && <pre>{compactJson(change.patch, 900)}</pre>}
        </div>
      )}
      {changeResult && (
        <div className="ops-event-details">
          <span>{changeResult.status || "completed"}</span>
          {changeResult.error && <small className="danger-text">{changeResult.error}</small>}
          <PermissionCard guidance={guidance} />
          {changeResult.result_preview && <details><summary>View Raw API Response</summary><pre>{changeResult.result_preview}</pre></details>}
        </div>
      )}
      {verification && (
        <div className="ops-event-details">
          <span>{verification.status || "verified"} · {verification.recovered === false ? "Not Recovered" : verification.recovered === true ? "Recovered" : "Diagnosis Complete"}</span>
          <small>{verification.message || verification.proof || "Verification Complete"}</small>
        </div>
      )}
      {event?.alternative_plan_count !== undefined && <div className="ops-event-chips"><span>Candidate Strategies {event.alternative_plan_count}</span></div>}
      {event?.waiting_on && (
        <div className="ops-event-chips">
          <span>Waiting on: {event.waiting_on}</span>
          <span>Elapsed {Math.round(Number(event.elapsed_seconds || 0))}s</span>
          <span>Circuit breaks in {Math.max(0, Math.round(Number(event.remaining_seconds || 0)))}s</span>
        </div>
      )}
      {event?.timed_out_stage && <div className="ops-event-chips"><span className="danger-text">Stopped slow call: {event.timed_out_stage}</span></div>}
    </>
  );
}

export function OpsJobProgress({
  job,
  onCancel,
  compact = false,
}: {
  job: any;
  onCancel?: () => void | Promise<void>;
  compact?: boolean;
}) {
  const [liveJob, setLiveJob] = useState(job);
  const [pollFailures, setPollFailures] = useState(0);
  const [followupJob, setFollowupJob] = useState<any>(null);
  const [followupError, setFollowupError] = useState("");
  const [followupApprovals, setFollowupApprovals] = useState<Record<string, boolean>>({});
  const [stepApprovalChecked, setStepApprovalChecked] = useState(false);
  const [stepApprovalBusy, setStepApprovalBusy] = useState(false);
  const [stepApprovalError, setStepApprovalError] = useState("");
  const eventListRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const currentJob = liveJob || job;
  const active = ACTIVE_STATUSES.has(String(currentJob?.status || ""));
  const events = asList(currentJob?.events);
  const result = currentJob?.result || {};
  const continuation = result?.continuation_context || {};
  const lineageAttempts = asList(continuation?.attempts);
  const steps = asList(result.steps);
  const changes = asList(result.results);
  const nextSteps = useMemo(
    () => asList(result?.next_steps || result?.verification?.next_steps || result?.ai_summary?.next_steps)
      .map((item: any) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 6),
    [result?.next_steps, result?.verification?.next_steps, result?.ai_summary?.next_steps],
  );
	  const followups = useMemo(() => {
	    const seen = new Set<string>();
	    return [...asList(result?.alternative_plans), ...asList(result?.ai_summary?.followup_plans)].filter((plan: any) => {
	      const fingerprint = JSON.stringify({ target: plan?.target, changes: plan?.changes, title: plan?.title });
	      const hasNextStep = asList(plan?.changes).length || asList(plan?.steps).length || asList(plan?.operator_steps).length;
	      if (!hasNextStep || seen.has(fingerprint)) return false;
	      seen.add(fingerprint);
	      return true;
	    }).slice(0, 3);
  }, [result?.alternative_plans, result?.ai_summary?.followup_plans]);
  const latestEvents = events.slice(compact ? -10 : -24);
  const percent = progressPercent(currentJob);
  const statusClass = statusTone(currentJob?.status);
  const currentPhase = phaseIndex(currentJob?.stage || latestEvents.at(-1)?.stage);
  const pendingApproval = currentJob?.pending_approval;

  useEffect(() => {
    setLiveJob(job);
    setPollFailures(0);
  }, [job?.id]);

  useEffect(() => {
    setStepApprovalChecked(false);
    setStepApprovalError("");
  }, [pendingApproval?.change_index]);

  useEffect(() => {
    const list = eventListRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: active ? "smooth" : "auto" });
    bottomRef.current?.scrollIntoView({ block: "nearest", behavior: active ? "smooth" : "auto" });
  }, [latestEvents.length, currentJob?.stage, currentJob?.status, pendingApproval?.change_index, active]);

  useEffect(() => {
    if (!active || !currentJob?.id) return;
    const timer = window.setTimeout(async () => {
      try {
        setLiveJob(await apiGet(`/api/ops/jobs/${encodeURIComponent(currentJob.id)}`));
        setPollFailures(0);
      } catch (error: any) {
        setPollFailures((count) => {
          const next = count + 1;
          if (next >= 3) {
            setLiveJob((current: any) => ({
              ...current,
              status: "failed",
              stage: "failed",
              message: `Failed to read execution status ${next} times in a row. Live polling has stopped: ${error.message}`,
              updated_at: new Date().toISOString(),
              result: current?.result || {
                status: "failed",
                executed: false,
                message: "The final backend task state could not be confirmed, so the system will not misreport an unknown state as successful.",
              },
              events: [...asList(current?.events), {
                timestamp: new Date().toISOString(),
                stage: "failed",
                level: "error",
                message: `Task status endpoint unreachable: ${error.message}`,
              }],
            }));
          }
          return next;
        });
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [active, currentJob?.id, currentJob?.updated_at, currentJob?.events?.length, pollFailures]);

  async function runFollowup(plan: any, highRisk: boolean, approvalKey: string) {
    setFollowupError("");
    const enrichedPlan = {
      ...plan,
      cluster: plan.cluster || currentJob?.cluster,
      cluster_id: plan.cluster_id || currentJob?.cluster_id,
      namespace: plan.namespace || currentJob?.namespace,
      target: plan.target || currentJob?.target,
      source: plan.source || currentJob?.source,
      high_risk_confirmed: highRisk ? Boolean(followupApprovals[approvalKey]) : Boolean(plan.high_risk_confirmed),
      operator_force_execute: true,
      operator_override_reason: highRisk ? "The operator reviewed the alternative strategy and explicitly confirmed execution despite the high risk." : "The operator confirmed the alternative strategy in the execution results.",
      continuation_context: plan.continuation_context || result.continuation_context || {},
    };
    try {
      setFollowupJob(await apiPost("/api/ops/jobs", {
        plan: enrichedPlan,
        confirm: true,
        autonomous: false,
        high_risk_confirmed: Boolean(enrichedPlan.high_risk_confirmed || highRisk),
        operator_force_execute: true,
        allow_high_risk_after_confirmation: true,
        operator_override_reason: enrichedPlan.operator_override_reason || "The operator confirmed execution of the alternative strategy.",
      }));
    } catch (error: any) {
      setFollowupError(error.message);
    }
  }

  async function approveStep() {
    if (!currentJob?.id || !pendingApproval?.change_index || !stepApprovalChecked) return;
    setStepApprovalBusy(true);
    setStepApprovalError("");
    try {
      setLiveJob(await apiPost(`/api/ops/jobs/${encodeURIComponent(currentJob.id)}/approve-step`, {
        change_index: pendingApproval.change_index,
        confirm: true,
        comment: "The operator reviewed this step's target, diff, risk, and rollback approach.",
      }));
    } catch (error: any) {
      setStepApprovalError(error.message);
    } finally {
      setStepApprovalBusy(false);
    }
  }

  return (
    <div className={classNames("ops-job", compact && "compact")}>
      <div className="ops-job-status">
        <span className={classNames("job-dot", active && "active", statusClass)} />
        <div>
          <strong>{currentJob?.message || stageLabel(currentJob?.stage)}</strong>
          <small>{currentJob?.status || "running"} · {stageLabel(currentJob?.stage)} · Failure-chain attempt {currentJob?.lineage_attempt || currentJob?.attempt || 0} · Task limit {currentJob?.max_attempts || 1} attempts</small>
        </div>
        {active && onCancel && <button className="ghost tiny" onClick={onCancel}><Square size={13} />Cancel</button>}
      </div>
      <div className="ops-live-progress" aria-label={`Execution progress ${percent}%`}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="ops-phase-track" aria-label="Operations execution phases">
        {EXECUTION_PHASES.map((label, index) => {
          const finished = index < currentPhase || (TERMINAL_STATUSES.has(String(currentJob?.status)) && index <= currentPhase);
          return <div className={classNames(finished && "done", index === currentPhase && active && "active")} key={label}>
            <i>{finished ? <CheckCircle2 size={11} /> : index + 1}</i><span>{label}</span>
          </div>;
        })}
      </div>
      {pendingApproval && currentJob?.status === "awaiting_approval" && <div className="ops-step-approval-card">
        <header><span>Step {pendingApproval.change_index}/{pendingApproval.changes_total}</span><strong>{changeLabel({ type: pendingApproval.action })}</strong><em>{pendingApproval.risk || "medium"}</em></header>
        <div className="ops-step-approval-target"><span>Will modify</span><b>{pendingApproval.target}</b></div>
        <p>{pendingApproval.reason || "Waiting for operator approval for this step."}</p>
        <div className="ops-step-rollback"><span>Rollback</span><b>{pendingApproval.rollback || "Restore the previous configuration"}</b></div>
        {(pendingApproval.patch || pendingApproval.manifest) && <details><summary>View this step's configuration diff</summary><pre>{compactJson(pendingApproval.patch || pendingApproval.manifest, 1800)}</pre></details>}
        <label><input type="checkbox" checked={stepApprovalChecked} onChange={(event) => setStepApprovalChecked(event.target.checked)} />I have reviewed this step's target, diff, risk, and rollback approach.</label>
        <button className="primary" onClick={approveStep} disabled={!stepApprovalChecked || stepApprovalBusy}><ShieldCheck size={14} />{stepApprovalBusy ? "Submitting approval..." : `Approve step ${pendingApproval.change_index}`}</button>
        {stepApprovalError && <div className="error-box">{stepApprovalError}</div>}
      </div>}
      <div className="ops-live-grid">
        <div><span>Target</span><strong>{currentJob?.target || currentJob?.id || "-"}</strong></div>
        <div><span>Cluster/Namespace</span><strong>{currentJob?.cluster || "-"} / {currentJob?.namespace || "-"}</strong></div>
        <div><span>Operator</span><strong>{currentJob?.operator || "system"}</strong></div>
        <div><span>Updated</span><strong>{formatTime(currentJob?.updated_at)}</strong></div>
      </div>
      {lineageAttempts.length > 0 && <details className="ops-lineage-history">
        <summary>{lineageAttempts.length} attempts have run in the same failure chain. View failed strategies and the rationale for switching.</summary>
        <div>{lineageAttempts.map((attempt: any, index: number) => <span key={`${attempt.fingerprint || attempt.strategy}-${index}`}>
          <i>{attempt.attempt || index + 1}</i>
          <b>{attempt.strategy || `Strategy ${index + 1}`}</b>
          <em className={statusTone(attempt.recovered === true ? "completed" : attempt.status)}>{attempt.recovered === true ? "Recovered" : attempt.status || "Not Recovered"}</em>
          <small>{attempt.outcome || "No recovery evidence was obtained in this attempt."}</small>
          {asList(attempt.actions).length > 0 && <code>{asList(attempt.actions).join(" · ")}</code>}
        </span>)}</div>
      </details>}
      <div className="ops-event-list" ref={eventListRef}>
        {latestEvents.map((event: any, index: number) => {
          const isCurrent = active && index === latestEvents.length - 1;
          return (
            <div className={classNames("ops-event", event.level, isCurrent && "current")} key={`${event.timestamp}-${event.stage}-${index}`}>
              <span className="ops-event-dot">{eventIcon(event, isCurrent)}</span>
              <div>
                <header><strong>{stageLabel(event.stage)}</strong><small>{formatTime(event.timestamp)}</small></header>
                <p>{event.message || "-"}</p>
                {renderEventDetails(event)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {(steps.length > 0 || changes.length > 0 || result.verification) && (
        <div className="ops-result-grid">
          {steps.length > 0 && (
            <section className="ops-result-section">
              <h4><TerminalSquare size={13} />Diagnostic Evidence</h4>
              {steps.map((step: any, index: number) => (
                <article key={`${step.id || step.title}-${index}`}>
                  <b>{step.title || step.name || `Step ${index + 1}`}</b><span className={statusTone(step.status)}>{step.status || "completed"}</span>
                  {asList(step.logs).length > 0 && <pre>{asList(step.logs).slice(-8).join("\n")}</pre>}
                </article>
              ))}
            </section>
          )}
          {changes.length > 0 && (
            <section className="ops-result-section">
              <h4><FileText size={13} />Change Results</h4>
              {changes.map((item: any, index: number) => (
                <article key={`${item.status || "change"}-${index}`}>
                  <b>{changeLabel(item.change)} · {item.change?.workload_type || item.change?.kind || "resource"}/{item.change?.workload_name || item.change?.name || item.change?.pvc_name || "-"}</b>
                  <span className={statusTone(item.status)}>{item.status || "completed"}</span>
                  <p>{item.change?.reason || (item.status === "failed" ? "The Kubernetes API did not accept this change." : "The Kubernetes API returned a result for this change.")}</p>
                  <PermissionCard guidance={permissionGuidance(item)} />
                  {item.result && <details><summary>View Raw API Response</summary><pre>{compactJson(item.result, 1100)}</pre></details>}
                </article>
              ))}
            </section>
          )}
          {result.verification && (
            <section className="ops-result-section ops-verification">
              <h4><CheckCircle2 size={13} />Recovery Verification</h4>
              <article>
                <b>{result.verification.status || "verified"}</b>
                <span className={result.verification.recovered === false ? "warning" : "success"}>{result.verification.recovered === false ? "Not Recovered" : "Complete"}</span>
                <p>{result.verification.message || result.verification.proof || "Verification Complete"}</p>
              </article>
            </section>
          )}
        </div>
      )}
      {result?.ai_summary?.content && <div className="ops-conclusion"><b>AI Execution Summary</b><p>{result.ai_summary.content}</p></div>}
      {nextSteps.length > 0 && (
        <div className="ops-next-steps">
          <b>Recommended Next Steps</b>
          {nextSteps.map((item, index) => <span key={`${item}-${index}`}><i>{index + 1}</i>{item}</span>)}
        </div>
      )}
      {(result?.blocked_reason || asList(result?.operator_steps).length > 0) && (
        <div className="ops-blocked-guidance">
          <b>{result.executed ? "Why recovery has not happened yet in this attempt" : "Why no change was executed in this attempt"}</b>
          <p>{result.blocked_reason || result?.verification?.blocked_reason || "No change evidence met the safety gate requirements."}</p>
          {asList(result.operator_steps || result?.verification?.operator_steps).map((item: any, index: number) => <span key={`${item}-${index}`}><i>{index + 1}</i>{String(item)}</span>)}
        </div>
      )}
      {followups.length > 0 && !followupJob && (
        <div className="ops-followups">
          <b>Available Confirmable Next Strategies</b>
	          {followups.map((plan: any, index: number) => {
	            const planChanges = asList(plan.changes);
	            const highRisk = planChanges.some((change: any) => change.risk === "high" || change.auto_allowed === false || change.requires_high_risk_confirmation);
	            const risk = planChanges.length ? highRisk ? "High Risk" : "Controlled" : "Read-Only Diagnosis";
	            const approvalKey = String(plan.id || plan.title || index);
	            const previousAttempt = plan.previous_attempt || plan.continuation_context?.last_failure || continuation?.last_failure;
	            return (
	              <article key={`${plan.title || "followup"}-${index}`}>
	                <div><strong>{plan.title || `Alternative Strategy ${index + 1}`}</strong><span>{risk} · {planChanges.length} changes</span></div>
	                <p>{plan.summary || plan.reason || "A differentiated remediation strategy generated from the evidence gathered in the previous attempt."}</p>
	                {previousAttempt && <div className="ops-followup-difference"><b>Why switch strategies</b><span>Previous attempt: {previousAttempt.strategy || "Previous strategy"}</span><small>{previousAttempt.outcome || "Recovery verification did not pass, so this attempt must change the action, target parameters, or root-cause hypothesis."}</small></div>}
	                {planChanges.length > 0 ? <div className="ops-followup-change-list">{planChanges.map((change: any, changeIndex: number) => <span key={`${change.type}-${changeIndex}`}><i>{changeIndex + 1}</i><b>{changeLabel(change)}</b><em>{change.workload_type || change.kind || "resource"}/{change.workload_name || change.name || change.pvc_name || plan.target || "-"}</em><small>{change.reason || "Verify against the recovery criteria after execution."}</small></span>)}</div> : <div className="ops-followup-verification"><b>Next diagnostic step</b>{asList(plan.steps || plan.operator_steps).slice(0, 4).map((step: any, stepIndex: number) => <span key={`${step?.title || step}-${stepIndex}`}><i>{stepIndex + 1}</i>{String(step?.description || step?.title || step)}</span>)}</div>}
	                {asList(plan.verification_plan).length > 0 && <div className="ops-followup-verification"><b>Post-execution verification</b>{asList(plan.verification_plan).slice(0, 4).map((item: any, verifyIndex: number) => <span key={`${item}-${verifyIndex}`}><i>{verifyIndex + 1}</i>{String(item)}</span>)}</div>}
	                {highRisk && <label className="toggle danger-toggle"><input type="checkbox" checked={Boolean(followupApprovals[approvalKey])} onChange={(event) => setFollowupApprovals((current) => ({ ...current, [approvalKey]: event.target.checked }))} />Confirm execution even if it is high risk</label>}
	                <button className="primary" onClick={() => runFollowup(plan, highRisk, approvalKey)} disabled={highRisk && !followupApprovals[approvalKey]}><ShieldCheck size={13} />{planChanges.length ? "Confirm and Execute" : "Start the Next Diagnostic Round"}</button>
	              </article>
	            );
	          })}
        </div>
      )}
      {followupJob && <OpsJobProgress job={followupJob} compact={compact} />}
      {followupError && <div className="error-box">{followupError}</div>}
    </div>
  );
}


/**
 * Shared human-in-the-loop operation surface used by chat and inspection.
 * It only submits the normalized OpsPlan contract and never constructs a
 * Kubernetes command in the browser.
 */
export function OpsPlanPanel({ plan, autonomous = false }: { plan: OpsPlan; autonomous?: boolean }) {
  const [reviewed, setReviewed] = useState(false);
  const [forceApproved, setForceApproved] = useState(false);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverRequiresHighRisk, setServerRequiresHighRisk] = useState(false);
  const [stepwiseConfirmation, setStepwiseConfirmation] = useState(true);
  const active = job && ACTIVE_STATUSES.has(job.status);
  const changes = useMemo(() => asList(plan?.changes), [plan]);
  const hypotheses = useMemo(() => asList(plan?.root_cause_hypotheses).slice(0, 3), [plan]);
  const operatorSkills = useMemo(() => asList(plan?.operator_skills), [plan]);
  const requiresHighRisk = useMemo(
    () => serverRequiresHighRisk || Boolean(plan?.requires_high_risk_confirmation) || changes.some((change: any) => change.risk === "high" || change.auto_allowed === false || change.requires_high_risk_confirmation || HIGH_RISK_ACTIONS.has(String(change.type || change.action || ""))),
    [changes, plan?.requires_high_risk_confirmation, serverRequiresHighRisk],
  );
  const evidenceReason = plan?.evidence_gap || plan?.reason || plan?.message || "There is currently no direct evidence proving that a specific Kubernetes change is clearly better than the alternatives.";
  const riskPreview = changes.length
    ? `${changes.length} changes; highest risk ${requiresHighRisk ? "high, requires a second human confirmation" : "medium/low, can be executed in a controlled way"}`
    : "This attempt will not modify the cluster directly. It will first collect evidence from logs, Events, Workloads, Services, storage, and nodes, then replan.";

  async function execute() {
    setError("");
    if (!reviewed) {
      setError("Please complete step 1 first: review the target, diagnostic steps, and proposed changes.");
      return;
    }
    if (requiresHighRisk && !forceApproved) {
      setError("This plan includes high-risk actions. Please complete step 2 and check the red option to confirm execution even if it is high risk.");
      return;
    }
    setSubmitting(true);
    const executionPlan = {
      ...plan,
      stepwise_confirmation: changes.length > 0 && stepwiseConfirmation,
      high_risk_confirmed: requiresHighRisk ? forceApproved : Boolean(plan?.high_risk_confirmed),
      operator_force_execute: true,
      operator_override_reason: requiresHighRisk && forceApproved ? "The operator reviewed the risk preview and confirmed execution." : plan?.operator_override_reason,
    };
    try {
      setJob(await apiPost("/api/ops/jobs", {
        plan: executionPlan,
        confirm: true,
        autonomous,
        high_risk_confirmed: executionPlan.high_risk_confirmed,
        operator_force_execute: executionPlan.operator_force_execute,
        allow_high_risk_after_confirmation: Boolean(requiresHighRisk && forceApproved),
        operator_override_reason: executionPlan.operator_override_reason || "",
        stepwise_confirmation: executionPlan.stepwise_confirmation,
      }));
    }
    catch (executeError: any) {
      const message = executeError.message || "Failed to submit operations task";
      if (/(?:\u9ad8\u98ce\u9669|\u4e8c\u6b21\u786e\u8ba4|high.risk)/i.test(message)) {
        setServerRequiresHighRisk(true);
        setForceApproved(false);
        setError("The backend risk gate identified a high-risk action. Complete the red step 2 confirmation below, then click 'Confirm Again and Execute Changes'.");
      } else setError(message);
    } finally { setSubmitting(false); }
  }

  async function cancel() {
    if (!job?.id) return;
    try { setJob(await apiPost(`/api/ops/jobs/${encodeURIComponent(job.id)}/cancel`, {})); }
    catch (cancelError: any) { setError(cancelError.message); }
  }

  return <div className="ops-plan-card">
    <div className="ops-plan-heading"><div><span>Controlled Operations Plan</span><strong>{plan.title || plan.target}</strong>{plan.planning_engine && <small>{plan.step_source === "llm_evidence_expert" ? "Dynamic AI Expert Path" : "Deterministic Runbook Fallback"} · {plan.planning_engine}</small>}</div><span className={classNames("severity", changes.length ? "hot" : "")}>{changes.length ? `${changes.length} changes` : "Read-Only Diagnosis"}</span></div>
    <p className="ops-plan-summary">{plan.summary}</p>
    {plan.preview_mode === "live_evidence_ai" && <div className="ops-live-preview-proof">
      <div><span>Preview Source</span><strong>Live Evidence + Dynamic AI Planning + Skill Memory</strong></div>
      <div><span>Evidence Coverage</span><strong>{Number(plan.evidence_summary?.events || 0)} Events · {Number(plan.evidence_summary?.log_streams || 0)} Log Streams · {Number(plan.evidence_summary?.storage_objects || 0)} Storage Objects</strong></div>
      <div><span>Primary Root Cause</span><strong>{asList(plan.root_cause_hypotheses)[0]?.title || plan.planning?.selected_runbook || "Evidence is still being narrowed down"}</strong></div>
      <div><span>Target Lock</span><strong>{plan.target} · Cross-object changes are not allowed</strong></div>
    </div>}
    <div className={classNames("ops-risk-note", requiresHighRisk && "hot")}>
      <b>{changes.length ? "Algorithmic Change Preview" : "Why no direct change is being made yet"}</b>
      <span>{changes.length ? `Will modify ${changes.map((change: any) => `${change.workload_type || change.kind || "resource"}/${change.workload_name || change.name || plan.target}`).join(", ")}. ${riskPreview}. After execution, the system will continue verifying readiness, restart counts, Events, and error rate.` : `${evidenceReason} Principle: the SRE gate requires a closed loop of "root-cause evidence -> minimal change -> rollbackability -> verifiability." When evidence is insufficient, changing configuration directly expands the blast radius, so the system performs deeper diagnosis and replans first.`}</span>
    </div>
    {operatorSkills.length > 0 && <div className="ops-skill-strip">
      <b>Matched Operations Skills</b>
      {operatorSkills.map((skill: any) => <span key={skill.id}><strong>{skill.name}</strong><small>{Math.round(Number(skill.confidence || 0) * 100)}% · {skill.category} · {skill.risk}</small></span>)}
    </div>}
    {hypotheses.length > 0 && <div className="ops-decision-basis">
      <b>Auditable Decision Basis</b>
      <small>Shows evidence, confidence, and action rationale without exposing or fabricating any internal model chain of thought.</small>
      {hypotheses.map((hypothesis: any, index: number) => <div key={`${hypothesis.id || hypothesis.title || "hypothesis"}-${index}`}>
        <i>{index + 1}</i><span><strong>{hypothesis.title || hypothesis.root_cause || hypothesis.name || "Candidate Root Cause"}</strong><small>{hypothesis.reason || asList(hypothesis.matched_evidence).join(" · ") || "Supported jointly by the current logs, Events, and resource state."}</small></span><em>{Math.round(Number(hypothesis.confidence || 0) * 100)}%</em>
      </div>)}
    </div>}
    <div className="ops-plan-columns">
      <div><b>Execution Flow</b>{asList(plan.steps).map((step: any, index: number) => <div className="ops-plan-step" key={`${step.id || "step"}-${index}`}><i>{index + 1}</i><span><strong>{step.title || step.name || step}</strong><small>{step.description || step.detail || "Collect evidence and record the results"}</small>{step.probe && <em>Evidence Probe · {step.probe}</em>}{step.decision_rule && <small className="ops-step-decision">Decision: {step.decision_rule}</small>}</span></div>)}</div>
      <div><b>Proposed Changes</b>{changes.length ? changes.map((change: any, index: number) => <div className="change-preview" key={`${change.type}-${index}`}><strong>{change.type || change.action || "patch"}</strong><span>{change.workload_type || change.kind || "resource"}/{change.workload_name || change.name || plan.target}</span><code>{JSON.stringify(change.patch || change.value || change.storage || change.replicas || {}, null, 2)}</code></div>) : <div className="quiet-empty">This attempt only collects logs, events, and configuration evidence without modifying the cluster.</div>}</div>
    </div>
    {asList(plan.success_criteria).length > 0 && <div className="success-criteria"><b>Recovery Criteria</b>{asList(plan.success_criteria).map((item: any) => <span key={String(item)}><CheckCircle2 size={13} />{typeof item === "string" ? item : item.description || item.name}</span>)}</div>}
    {!job && <div className="ops-approval">
      <div className="ops-approval-steps">
        <label className={classNames("ops-approval-step", reviewed && "checked")}><i>1</i><input type="checkbox" checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); setError(""); }} /><span><b>Confirm Target and Changes</b><small>I have reviewed {plan.target || "the target object"}, the execution steps, the configuration diff, and the recovery criteria.</small></span></label>
        {requiresHighRisk && <label className={classNames("ops-approval-step high-risk", forceApproved && "checked")}><i>2</i><input type="checkbox" checked={forceApproved} onChange={(event) => { setForceApproved(event.target.checked); setError(""); }} /><span><b>Second Confirmation for High Risk</b><small>I understand this action may affect rollouts, storage, or traffic, and I still confirm execution despite the risk.</small></span></label>}
      </div>
      {changes.length > 0 && <label className="ops-stepwise-option"><input type="checkbox" checked={stepwiseConfirmation} onChange={(event) => setStepwiseConfirmation(event.target.checked)} /><span><b>Step-by-Step Confirmation Mode</b><small>Read-only diagnosis completes automatically. Before each real Kubernetes write operation is submitted, execution pauses and shows the target, diff, risk, and rollback approach for my confirmation.</small></span></label>}
      {error && <div className="ops-submit-error"><AlertTriangle size={14} /><span>{error}</span></div>}
      <button className="primary ops-execute-button" onClick={execute} disabled={submitting}><ShieldCheck size={15} />{submitting ? "Submitting operations task..." : changes.length ? requiresHighRisk ? "Confirm Again and Execute Changes" : "Confirm and Execute Changes" : "Start Deep Diagnosis and Replan"}</button>
    </div>}
    {job && <OpsJobProgress job={job} onCancel={active ? cancel : undefined} />}
    {job && error && <div className="error-box">{error}</div>}
  </div>;
}
