import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  Activity,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Database,
  GitBranch,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Network,
  PackageSearch,
  Play,
  RefreshCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
  Workflow,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

type DemoMode = "inspection" | "skills" | "topology";

const navItems = [
  { key: "chat", label: "SRE Chat", group: "Core", icon: MessageSquareText },
  { key: "inspection", label: "AI Inspection", group: "Core", icon: Search },
  { key: "topology", label: "Topology Impact", group: "Core", icon: Network },
  { key: "dashboard", label: "Runtime Overview", group: "Operations Loop", icon: LayoutDashboard },
  { key: "opsHub", label: "Resource Events", group: "Operations Loop", icon: PackageSearch },
  { key: "skills", label: "Skill Library", group: "Operations Loop", icon: BrainCircuit },
  { key: "reliability", label: "Release Governance", group: "Operations", icon: ShieldCheck },
  { key: "effectiveness", label: "Operations Effectiveness", group: "Operations", icon: Activity },
  { key: "platform", label: "Platform Capabilities", group: "Platform", icon: Settings2 },
] as const;

const skills = [
  ["PVC/PV Static Provisioning", "storage", "Pending PVC, unbound PV, or StorageClass mismatch", "create_pv · bind_pvc"],
  ["Volume Permission Repair", "runtime", "mkdir permission denied or mount directory not writable", "patch_security_context"],
  ["CrashLoop Root Cause Deep Dive", "runtime", "Container exits repeatedly or previous logs show errors", "collect_logs · patch_workload"],
  ["Image Architecture Check", "supply-chain", "exec format error or arm/amd64 architecture mismatch", "inspect_image_manifest"],
  ["ImagePullBackOff Credential Repair", "registry", "Private registry pull failure or missing Secret", "patch_pull_secret"],
  ["Empty Service Endpoint Routing", "network", "Service has no backends or selector drift", "patch_service_selector"],
  ["NetworkPolicy Egress Diagnosis", "network", "Cross-cluster calls fail or external dependencies are unreachable", "trace_egress_flow"],
  ["Ingress TLS Certificate Rotation", "edge", "Certificate expired or SNI mismatch", "rotate_tls_secret"],
  ["Node DiskPressure Isolation", "node", "Node disk pressure or eviction risk", "cordon_node · cleanup_image"],
  ["OOMKill Resource Profiling", "capacity", "Insufficient memory or limit configured too low", "resize_resources"],
  ["HPA Stabilization", "capacity", "Frequent replica scaling or metric spikes", "patch_hpa_behavior"],
  ["ConfigMap Drift Recovery", "config", "Configuration accidentally deleted or environment variable changes not released", "restore_configmap"],
  ["Kafka Lag Rapid Mitigation", "middleware", "Consumer backlog or partition imbalance", "rebalance_consumer"],
  ["Database Connection Storm", "database", "Connection pool saturation or slow SQL amplification", "throttle_connections"],
  ["VM High I/O Diagnosis", "virtual-machine", "Virtual machine disk latency or application I/O jitter", "inspect_vm_io"],
  ["Canary Release Gate", "release", "Pre-release risk assessment and error-budget protection", "release_gate"],
  ["Cross-Cluster Data Flow Tracing", "ebpf", "East-west or north-south traffic anomalies", "trace_flow_topology"],
  ["Emergency Rollback", "release", "Emergency rollback or recovery from accidental configuration deletion", "rollback_workload"],
];

function useDemoProgress(durationMs: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    let frame = 0;
    const updateFromRecorder = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail === "number") setElapsed(Math.max(0, Math.min(1, detail)) * durationMs);
    };
    window.addEventListener("luxyai-demo-progress", updateFromRecorder);
    const tick = () => {
      const recorderProgress = (window as any).__luxyaiDemoProgress;
      if (typeof recorderProgress === "number") {
        setElapsed(Math.max(0, Math.min(1, recorderProgress)) * durationMs);
      } else {
        setElapsed(Math.min(durationMs, performance.now() - startedAt));
      }
      if (performance.now() - startedAt < durationMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("luxyai-demo-progress", updateFromRecorder);
    };
  }, [durationMs]);
  return elapsed / durationMs;
}

function easeBetween(progress: number, start: number, end: number) {
  return smoothstep(start, end, progress);
}

function interpolate(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function easeOutCubic(t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) ** 3;
}

function humanPoint(
  t: number,
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  wobble = 0,
) {
  const u = 1 - t;
  const x = (u ** 3) * p0[0] + 3 * (u ** 2) * t * p1[0] + 3 * u * (t ** 2) * p2[0] + (t ** 3) * p3[0];
  const y = (u ** 3) * p0[1] + 3 * (u ** 2) * t * p1[1] + 3 * u * (t ** 2) * p2[1] + (t ** 3) * p3[1];
  return [
    x + Math.sin(t * Math.PI * 5) * wobble * (1 - Math.abs(t - 0.5)),
    y + Math.cos(t * Math.PI * 4) * wobble * 0.55,
  ];
}

function DemoShell({ mode, phase = "", children }: { mode: DemoMode; phase?: string; children: React.ReactNode }) {
  const title = mode === "inspection" ? "AI Inspection" : mode === "skills" ? "Skill Library" : "Topology Impact";

  useEffect(() => {
    document.body.dataset.theme = "dark";
    document.body.classList.add("demo-video-body");
    return () => {
      document.body.classList.remove("demo-video-body");
    };
  }, []);

  return (
    <div className={`app-shell demo-video-shell demo-${mode} ${phase}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Flawless</div>
          <div>
            <strong>SRE Console</strong>
            <span>2026-07-production-console-v8</span>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isFirstInGroup = index === 0 || navItems[index - 1].group !== item.group;
            return (
              <React.Fragment key={item.key}>
                {isFirstInGroup && <span className="demo-nav-group">{item.group}</span>}
                <button className={`nav-button ${item.key === mode ? "active" : ""}`}>
                  <Icon size={17} />
                  <strong>{item.label}</strong>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="side-card">
          <div className="side-row"><span>Agents</span><strong>9/11</strong></div>
          <div className="health-dots">
            {Array.from({ length: 9 }).map((_, index) => <span key={index} className="health-dot ok" />)}
            <span className="health-dot warn" />
            <span className="health-dot warn" />
          </div>
          <button className="ghost tiny"><RefreshCcw size={14} />Refresh Status</button>
        </div>
        <div className="author-watermark"><span>Built by</span><strong>the maintainer</strong></div>
      </aside>
      <main className="main demo-main">
        <div className="topbar demo-topbar">
          <div>
            <h1>{title}</h1>
            <p>{mode === "topology" ? "Data flow, blast radius, and release impact in one consolidated view" : mode === "skills" ? "Turn expert experience into reusable operational capabilities" : "Risk detection, AI preview, human approval, and automated verification in a closed loop"}</p>
          </div>
          <div className="top-actions">
            <select aria-label="model">
              <option>primary</option>
              <option>deepseek-ops</option>
            </select>
            <button className="ghost tiny">Light</button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}

function Kpi({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`demo-kpi ${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function InspectionDemo() {
  const progress = useDemoProgress(26000);
  const phase =
    progress < 0.12 ? "phase-scan" :
    progress < 0.24 ? "phase-rank" :
    progress < 0.50 ? "phase-plan" :
    progress < 0.86 ? "phase-execute" :
    "phase-verify";
  const discovered = progress < 0.12 ? "Scanning" : progress < 0.24 ? "218" : "476";
  const p1 = progress < 0.12 ? "--" : progress < 0.24 ? "61" : progress < 0.90 ? "152" : "151";
  const plans = progress < 0.24 ? "Generating" : progress < 0.90 ? "476" : "Converged";
  const skillRoutes = progress < 0.24 ? "Matching" : "476";
  const cursorMove = easeBetween(progress, 0.48, 0.545);
  const [inspectionX, inspectionY] = humanPoint(cursorMove, [-420, -45], [-310, 34], [-118, -16], [6, -3], 7);
  const cursorClick = progress >= 0.545 && progress <= 0.575 ? 0.84 : 1;
  const confirmState =
    progress < 0.545 ? "confirm-ready" :
    progress < 0.59 ? "confirm-pressed" :
    progress < 0.90 ? "confirm-running" :
    "confirm-done";
  const confirmText =
    progress < 0.545 ? "Confirm and Execute" :
    progress < 0.59 ? "Confirmed" :
    progress < 0.90 ? "Executing..." :
    "Execution Complete";
  const inspectionCursorStyle: React.CSSProperties = {
    animation: "none",
    opacity: progress >= 0.47 && progress <= 0.62 ? 1 : 0,
    transform: `translate(${inspectionX}px, ${inspectionY}px) scale(${cursorClick})`,
  };
  const findings = [
    ["P1", "k8s-agent-alloy-4t8hf", "CrashLoop/OOM with abnormal mount-directory permissions", "DaemonSet/k8s-agent-alloy"],
    ["P1", "k8s-agent-loki-58bd7", "PVC exists but is not bound to a PV, blocking scheduling", "Deployment/k8s-agent-loki"],
    ["P2", "grafana-6d5544", "Image architecture may be incompatible with the node platform", "Deployment/k8s-agent-grafana"],
    ["P2", "tempo-ingester", "Restart count is rising and external storage writes are delayed", "StatefulSet/k8s-agent-tempo"],
  ];
  const evidence = ["previous logs", "Kubernetes Events", "Workload YAML", "PVC/PV", "Node runtime"];
  const planSteps = [
    ["1", "Lock the Affected Target", "Trace back from the Pod to the DaemonSet, ReplicaSet, Node, and mounted volumes to avoid fixing anything other than the top-ranked target."],
    ["2", "Collect Multi-Source Evidence", "Collect current/previous logs, Events, describe output, YAML, PVC/PV data, and node runtime status."],
    ["3", "Consolidate Root Cause", "Group permission denied and read-only file system under the mount-permission chain instead of misclassifying them as application code errors."],
    ["4", "Generate Candidate Plans", "Produce four plan types—fsGroup, initContainer chown, PV permission repair, and rollback path—and rank them by risk."],
    ["5", "Choose the Minimal Change", "Patch only securityContext.fsGroup and fsGroupChangePolicy without expanding image or business configuration changes."],
    ["6", "Require Human Approval", "Generate the diff, impact scope, and rollback commands, then enter controlled execution only after approval."],
    ["7", "Roll Rebuild and Observe", "After rollout, wait for the new Pod to schedule, mount, and start, while reading new and old logs in real time."],
    ["8", "Recovery Verification", "Verify readiness, restart count, Events, write probes, and business probes; if verification fails, proceed to the next plan."],
  ];
  const opSteps = [
    ["Collect Evidence", "events/logs/yaml/pvc/node"],
    ["Diagnose Root Cause", "permission denied + volume mount"],
    ["Apply Change", "patch securityContext + rollout"],
    ["Wait for New Pod", "Scheduling, mounting, container startup"],
    ["Verify Recovery", "Ready 1/1 + no new BackOff"],
  ];
  const executionProgress = easeBetween(progress, 0.59, 0.92);
  const activeOp = Math.min(opSteps.length - 1, Math.floor(executionProgress * opSteps.length));
  const opStatus = (index: number) => {
    if (progress < 0.59) return "pending";
    if (progress >= 0.92) return "done";
    if (index < activeOp) return "done";
    if (index === activeOp) return "loading";
    return "pending";
  };

  return (
    <DemoShell mode="inspection" phase={phase}>
      <section className="demo-grid demo-inspection-layout">
        <div className="panel demo-scope-panel">
          <div className="panel-title">
            <span><Search size={16} />Inspection Scope</span>
            <button className="primary"><Play size={15} />Inspect Now</button>
          </div>
          <div className="demo-form-row">
            <label>Cluster<select><option>All Clusters</option></select></label>
            <label>Namespace<select><option>All Namespaces</option></select></label>
            <label>Scheduled Inspection<select><option>Every 2 Hours</option></select></label>
          </div>
          <div className="demo-toggle-row">
            <span className="demo-check on" />Production Mode
            <span className="demo-check" />Automated Operations
            <span className="demo-check on" />Human Approval
          </div>
          <div className="demo-scan-line"><i /></div>
        </div>
        <Kpi label="Issues Found" value={discovered} />
        <Kpi label="P0/P1" value={p1} tone="danger" />
        <Kpi label="Executable Plans" value={plans} tone="good" />
        <Kpi label="Skill Routing" value={skillRoutes} />
      </section>

      <section className="panel demo-finding-panel">
        <div className="panel-title">
          <span><ShieldCheck size={16} />Anomaly Queue</span>
          <small>{progress < 0.34 ? "Collecting Events, logs, YAML, and topology evidence" : "Automatically ranked by business impact, blast radius, and evidence strength"}</small>
        </div>
        <div className="demo-findings">
          {findings.map((item, index) => (
            <article className={`demo-finding-card finding-${index + 1} ${index === 0 && progress >= 0.90 ? "recovered" : ""}`} key={item[1]}>
              <b>{index === 0 && progress >= 0.90 ? "OK" : item[0]}</b>
              <div>
                <strong>[nonprod-wgq-s2-system] Pod {item[1]}</strong>
                <p>{index === 0 && progress >= 0.90 ? "Ready 1/1, restartCount stable, with no further BackOff or write failures" : item[2]} · Owned by {item[3]}</p>
                <span>k8s-agent</span><span>{index === 0 && progress >= 0.90 ? "recovered" : "evidence-ready"}</span><span>{index === 0 && progress >= 0.90 ? "verified" : "skill-matched"}</span>
              </div>
              <button className="ghost tiny">{index === 0 && progress >= 0.90 ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}{index === 0 && progress >= 0.90 ? "Recovered" : "AI Preview"}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel demo-preview-panel">
        <div className="panel-title">
          <span><Zap size={16} />Live AI Operations Preview</span>
          <strong className="demo-badge">{progress < 0.24 ? "Collecting" : progress < 0.54 ? "Generating Plan" : progress < 0.59 ? "Awaiting Approval" : progress < 0.90 ? "Executing" : "Recovered"}</strong>
        </div>
        <div className="demo-phase-strip">
          <span className={progress >= 0.12 ? "on" : ""}>Anomaly Detection</span>
          <span className={progress >= 0.24 ? "on" : ""}>AI Plan Generation</span>
          <span className={progress >= 0.54 ? "on" : ""}>Human Approval</span>
          <span className={progress >= 0.86 ? "on" : ""}>Verify Recovery</span>
        </div>
        <div className="demo-preview-head">
          <div><small>Controlled Operations Plan</small><strong>Volume permission recovery</strong></div>
          <div><small>Evidence Chain</small><strong>{evidence.join(" · ")}</strong></div>
          <div><small>Target Chain</small><strong>DaemonSet/k8s-agent-alloy → Pod</strong></div>
        </div>
        <div className="demo-ai-plan">
          <div className="demo-ai-plan-title">
            <strong>Complete Operations Plan Generated by AI</strong>
            <span>8-step closed loop · rollback-ready · automatically moves to the next plan on failure</span>
          </div>
          <div className="demo-ai-plan-grid">
            {planSteps.map((step, index) => (
              <article key={step[0]} className={progress >= 0.24 + index * 0.026 ? "visible" : ""}>
                <b>{step[0]}</b>
                <div>
                  <strong>{step[1]}</strong>
                  <p>{step[2]}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="demo-confirm-row">
          <div>
            <strong>Human Approval</strong>
            <p>AI has generated a rollback-ready change. After approval, it enters the execution flow with full traceability.</p>
          </div>
          <button className={`primary demo-confirm-button ${confirmState}`}>
            {confirmState === "confirm-running" ? <Wrench size={15} /> : <CheckCircle2 size={15} />}
            {confirmText}
          </button>
          <span className="demo-cursor demo-inspection-cursor" style={inspectionCursorStyle} />
        </div>
        <div className="demo-execution">
          <div className="demo-step-rail demo-op-timeline">
            {opSteps.map((step, index) => {
              const status = opStatus(index);
              return (
                <span key={step[0]} className={`op-${status}`}>
                  {status === "loading" ? <Loader2 className="spin" size={14} /> : status === "done" ? <CheckCircle2 size={14} /> : <i>{index + 1}</i>}
                  <strong>{index + 1}. {step[0]}</strong>
                  <small>{step[1]}</small>
                </span>
              );
            })}
          </div>
          <div className="demo-terminal">
            <p>[INIT] Review Events and previous logs</p>
            <p>[LOG] mkdir data-alloy: read-only file system</p>
            <p>[RCA] Mount-directory permissions do not match fsGroup; this is not an application code issue</p>
            <p>[PATCH] securityContext.fsGroup=1000 + rollout restart</p>
            <p>[VERIFY] Wait for the new Pod to become Ready while continuously checking Events and business probes</p>
            <p>[DONE] new pod Ready 1/1，restartCount stable，Events no backoff</p>
          </div>
          <div className="demo-patch-card">
            <strong>Change Details</strong>
            <pre>{`securityContext:
  fsGroup: 1000
  fsGroupChangePolicy: OnRootMismatch
rollout:
  waitSeconds: 15
  verify: Ready && no new BackOff`}</pre>
          </div>
        </div>
        <div className="demo-recovery-row">
          {["pod_ready", "events_no_backoff", "restart_stable", "write_errors_absent", "business_probe_ok"].map((item) => (
            <span key={item}><CheckCircle2 size={13} />{item}</span>
          ))}
        </div>
      </section>
    </DemoShell>
  );
}

function SkillsDemo() {
  const progress = useDemoProgress(16500);
  const phase = progress < 0.32 ? "phase-browse" : progress < 0.58 ? "phase-inject" : progress < 0.8 ? "phase-match" : "phase-ready";
  const skillName = progress < 0.58 ? "PVC Pending Static PV Recovery" : "Network Plugin Version Compatibility Analysis";
  const skillDesc = progress < 0.58
    ? "When a PVC remains Pending for a long time and no PV is available, automatically validate the StorageClass, capacity, and access mode, then generate a static PV binding plan."
    : "When application logs lack direct errors but the data plane is abnormal, collect CNI, Service, Endpoint, and eBPF traffic evidence along the topology impact path to identify network plugin compatibility issues.";
  const scrollPct =
    progress < 0.10 ? 0 :
    progress < 0.24 ? interpolate(0, 25, easeOutCubic(easeBetween(progress, 0.10, 0.24))) :
    progress < 0.34 ? interpolate(25, 21, easeOutCubic(easeBetween(progress, 0.24, 0.34))) :
    progress < 0.47 ? 21 :
    progress < 0.58 ? interpolate(21, 39, easeOutCubic(easeBetween(progress, 0.47, 0.58))) :
    progress < 0.68 ? interpolate(39, 35, easeOutCubic(easeBetween(progress, 0.58, 0.68))) :
    progress < 0.80 ? 35 :
    progress < 0.91 ? interpolate(35, 48, easeOutCubic(easeBetween(progress, 0.80, 0.91))) :
    interpolate(48, 45, easeOutCubic(easeBetween(progress, 0.91, 1)));
  const thumbPx = scrollPct * 5.9;
  const skillsCursorOpacity = progress >= 0.1 && progress <= 0.9 ? 1 : 0;
  const wheelT = easeBetween(progress, 0.1, 0.88);
  const [skillCursorX, skillCursorY] = humanPoint(wheelT, [-452, 164], [-486, 232], [-416, 286], [-462, 330], 8);
  const skillsCursorStyle: React.CSSProperties = {
    animation: "none",
    opacity: skillsCursorOpacity,
    transform: `translate(${skillCursorX}px, ${skillCursorY}px)`,
  };
  const wheelPulseStyle: React.CSSProperties = {
    opacity: progress > 0.16 && progress < 0.84 ? 1 : 0,
    transform: `translate(${skillCursorX + 12}px, ${skillCursorY + 8}px)`,
  };
  return (
    <DemoShell mode="skills" phase={phase}>
      <section className="demo-skills-layout">
        <div className="panel demo-skill-editor">
          <div className="panel-title">
            <span><BrainCircuit size={16} />Operations Skill Injection</span>
            <button className="ghost tiny">Import Skill</button>
          </div>
          <div className="demo-form-row two">
            <label>Skill Name<input value={skillName} readOnly /></label>
            <label>Category<select><option>{progress < 0.58 ? "Storage" : "Network"}</option></select></label>
          </div>
          <label>One-Line Description<textarea value={skillDesc} readOnly /></label>
          <div className="demo-choice-grid">
            <span>Applies to: Pod</span><span>Deployment</span><span>StatefulSet</span><span>PersistentVolumeClaim</span>
            <span>Required Evidence: Events</span><span>YAML</span><span>StorageClass</span><span>Node capacity</span>
          </div>
          <div className="demo-skill-note"><GitBranch size={15} />Compatible with the open Agent Skills specification and portable to other agent runtimes.</div>
          <button className="primary">{progress < 0.8 ? "Save and Generate Skill Package" : "Added to the Enterprise Skill Library"}</button>
        </div>
        <div className="panel demo-skill-match">
          <div className="panel-title"><span><Sparkles size={16} />Match Test</span></div>
          <textarea value="Pod CrashLoopBackOff, previous logs show permission denied, and startup fails after mounting the PVC" readOnly />
          <button className="primary">Test Match</button>
          <div className="demo-match-result">
            <strong>Match Results</strong>
            <span>Volume Permission Repair 98%</span>
            <span>CrashLoop Root Cause Deep Dive 92%</span>
            <span>PVC/PV Static Provisioning 84%</span>
          </div>
        </div>
      </section>

      <section className="panel demo-skills-bank">
        <div className="panel-title">
          <span><Database size={16} />Skill Library</span>
          <small>The more it is used, the more it accumulates and approaches the enterprise's own expert system</small>
        </div>
        <div className="demo-skill-scroll">
          <span className="demo-scroll-thumb" style={{ animation: "none", transform: `translateY(${thumbPx}px)` }} />
          <span className="demo-cursor demo-skills-cursor" style={skillsCursorStyle} />
          <span className="demo-wheel-pulse" style={wheelPulseStyle} />
          <div className="demo-skill-track" style={{ animation: "none", transform: `translateY(-${scrollPct}%)` }}>
            {[...skills, ...skills].map((skill, index) => (
              <article className="demo-skill-card" key={`${skill[0]}-${index}`}>
                <div>
                  <strong>{skill[0]}</strong>
                  <small>{skill[1]}</small>
                </div>
                <p>{skill[2]}</p>
                <span>{skill[3]}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </DemoShell>
  );
}

type TopologyNode = {
  id: string;
  label: string;
  sub: string;
  position: [number, number, number];
  color: number;
  risk?: boolean;
  size?: number;
};

const topologyNodes: TopologyNode[] = [
  { id: "external", label: "External", sub: "Customer Entry / UAAS", position: [-20, 0, 4], color: 0x2b77ff, size: 1.8 },
  { id: "ingress", label: "Ingress", sub: "edge-gateway", position: [-11, 6, -4], color: 0x4d99ff, size: 1.55 },
  { id: "orders", label: "orders-api", sub: "canary v2.4.1", position: [-1, 1, 1], color: 0x46b7ff, risk: true, size: 1.9 },
  { id: "svc", label: "Service", sub: "orders-svc", position: [7, -3, 2], color: 0x56d8ff, size: 1.45 },
  { id: "kafka", label: "Kafka", sub: "middleware cluster", position: [14, 7, -5], color: 0x8b72ff, risk: true, size: 1.75 },
  { id: "cbs", label: "CBS", sub: "Financial Path", position: [20, 0, 3], color: 0xff6f8e, risk: true, size: 1.65 },
  { id: "ecp", label: "ECP", sub: "Customs Integration", position: [13, -9, 6], color: 0x66d3aa, risk: true, size: 1.45 },
  { id: "elk", label: "ELK", sub: "logging flow", position: [-9, -10, -8], color: 0x5ad7ff, size: 1.45 },
  { id: "uaas", label: "UAAS", sub: "account center", position: [-19, -8, -8], color: 0x66d3aa, size: 1.2 },
  { id: "control", label: "SCCT", sub: "control tower", position: [4, 10, 8], color: 0xffcf6b, risk: true, size: 1.25 },
];

const topologyEdges = [
  ["external", "ingress", false],
  ["ingress", "orders", true],
  ["orders", "svc", true],
  ["orders", "kafka", true],
  ["svc", "cbs", true],
  ["orders", "ecp", true],
  ["kafka", "elk", true],
  ["uaas", "orders", false],
  ["control", "orders", false],
  ["svc", "elk", false],
] as const;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeLabelTexture(label: string, sub: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "rgba(16, 25, 40, 0.84)");
  gradient.addColorStop(1, "rgba(18, 31, 56, 0.72)");
  ctx.fillStyle = gradient;
  ctx.strokeStyle = "rgba(126, 202, 255, 0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(18, 22, 476, 118, 22);
  ctx.fill();
  ctx.stroke();
  ctx.font = "700 38px Inter, Arial, sans-serif";
  ctx.fillStyle = "#f4f8ff";
  ctx.textAlign = "center";
  ctx.fillText(label, 256, 76);
  ctx.font = "24px Inter, Arial, sans-serif";
  ctx.fillStyle = "#a9d7ff";
  ctx.fillText(sub, 256, 112);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function TopologyThreeScene() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020712, 0.018);

    const camera = new THREE.PerspectiveCamera(54, host.clientWidth / Math.max(1, host.clientHeight), 0.1, 1200);
    camera.position.set(0, 20, 56);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x94b8ff, 0.62));
    const key = new THREE.PointLight(0x66d3ff, 110, 120);
    key.position.set(-10, 18, 22);
    scene.add(key);
    const warm = new THREE.PointLight(0xff7f9a, 80, 100);
    warm.position.set(22, 10, 8);
    scene.add(warm);

    const nodeById = new Map(topologyNodes.map((node) => [node.id, node]));
    const nodeMeshes: Array<{ node: TopologyNode; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; halo: THREE.Mesh }> = [];
    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    topologyNodes.forEach((node, index) => {
      const geometry = node.id === "svc"
        ? new THREE.OctahedronGeometry(node.size || 1.4, 1)
        : node.id === "orders"
          ? new THREE.IcosahedronGeometry(node.size || 1.6, 1)
          : new THREE.SphereGeometry(node.size || 1.35, 32, 24);
      const material = new THREE.MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: node.risk ? 0.55 : 0.28,
        roughness: 0.26,
        metalness: 0.18,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...node.position);
      nodeGroup.add(mesh);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry((node.size || 1.35) * 1.82, 32, 24),
        new THREE.MeshBasicMaterial({
          color: node.risk ? 0xff7f9a : 0x5ad7ff,
          transparent: true,
          opacity: node.risk ? 0.1 : 0.06,
          depthWrite: false,
        }),
      );
      halo.position.copy(mesh.position);
      nodeGroup.add(halo);

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeLabelTexture(node.label, node.sub),
        transparent: true,
        opacity: 0.96,
        depthTest: false,
        depthWrite: false,
      }));
      sprite.position.copy(mesh.position).add(new THREE.Vector3(0, (node.size || 1.4) + 2.1, 0));
      sprite.scale.set(8.2, 2.9, 1);
      if (index % 2) sprite.position.x += 1.2;
      nodeGroup.add(sprite);
      nodeMeshes.push({ node, mesh, material, halo });
    });

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions[i * 3] = (Math.random() - 0.5) * 120;
      starPositions[i * 3 + 1] = (Math.random() - 0.5) * 80;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x9ccfff, size: 0.08, transparent: true, opacity: 0.62 }));
    scene.add(stars);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x2bd8ff, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(18, 0.035, 8, 160), ringMaterial.clone());
    ringA.rotation.x = Math.PI / 2.7;
    ringA.rotation.z = -0.32;
    ringA.position.set(-2, 0, 0);
    scene.add(ringA);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(30, 0.025, 8, 180), ringMaterial.clone());
    ringB.rotation.x = Math.PI / 2.4;
    ringB.rotation.z = 0.34;
    scene.add(ringB);

    const curves: Array<{ curve: THREE.QuadraticBezierCurve3; risk: boolean; mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }> = [];
    const particles: Array<{ mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; risk: boolean; speed: number; offset: number }> = [];

    topologyEdges.forEach(([from, to, risk], edgeIndex) => {
      const start = new THREE.Vector3(...(nodeById.get(from)?.position || [0, 0, 0]));
      const end = new THREE.Vector3(...(nodeById.get(to)?.position || [0, 0, 0]));
      const mid = start.clone().lerp(end, 0.5);
      mid.y += risk ? 8 + (edgeIndex % 3) * 1.2 : 5 + (edgeIndex % 2);
      mid.z += risk ? (edgeIndex % 2 ? 5 : -4) : (edgeIndex % 2 ? -3 : 3);
      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      const tube = new THREE.TubeGeometry(curve, 84, risk ? 0.045 : 0.028, 8, false);
      const material = new THREE.MeshBasicMaterial({
        color: risk ? 0xff8a76 : 0x54d8ff,
        transparent: true,
        opacity: risk ? 0 : 0.3,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tube, material);
      scene.add(mesh);
      curves.push({ curve, risk, mesh, material });
      const particleCount = risk ? 5 : 3;
      for (let i = 0; i < particleCount; i += 1) {
        const particle = new THREE.Mesh(
          new THREE.SphereGeometry(risk ? 0.18 : 0.13, 16, 12),
          new THREE.MeshBasicMaterial({
            color: risk ? 0xffd36b : 0x8ff7ff,
            transparent: true,
            opacity: risk ? 0 : 0.78,
            depthWrite: false,
          }),
        );
        scene.add(particle);
        particles.push({ mesh: particle, curve, risk, speed: risk ? 0.19 + i * 0.01 : 0.11 + i * 0.006, offset: i / particleCount });
      }
    });

    const resize = () => {
      if (!host) return;
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const startedAt = performance.now();
    let frame = 0;
    const animate = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const recorderProgress = (window as any).__luxyaiDemoProgress;
      const phase = typeof recorderProgress === "number" ? Math.max(0, Math.min(1, recorderProgress)) : Math.min(1, elapsed / 22);
      const reveal = smoothstep(0.25, 0.48, phase);
      const isolate = smoothstep(0.38, 0.68, phase);

      const angle = -0.72 + phase * 0.95;
      camera.position.set(Math.sin(angle) * 50, 20 + Math.sin(phase * Math.PI) * 5, Math.cos(angle) * 50);
      camera.lookAt(0, 0, 0);

      stars.rotation.y += 0.0008;
      ringA.rotation.z += 0.002;
      ringB.rotation.z -= 0.0012;
      nodeGroup.rotation.y = Math.sin(elapsed * 0.22) * 0.08;

      curves.forEach(({ risk, material }) => {
        material.opacity = risk ? 0.08 + reveal * 0.78 : 0.34 * (1 - isolate) + 0.06;
      });
      nodeMeshes.forEach(({ node, mesh, material, halo }, index) => {
        const pulse = 1 + Math.sin(elapsed * 2.2 + index) * 0.035;
        mesh.scale.setScalar(node.risk ? pulse + reveal * 0.13 : pulse);
        material.emissiveIntensity = node.risk ? 0.42 + reveal * 1.15 : 0.26;
        const haloMaterial = halo.material as THREE.MeshBasicMaterial;
        haloMaterial.opacity = node.risk ? 0.06 + reveal * 0.22 : 0.05 * (1 - isolate);
      });
      particles.forEach(({ mesh, curve, risk, speed, offset }) => {
        const particleMaterial = mesh.material as THREE.MeshBasicMaterial;
        particleMaterial.opacity = risk ? reveal : 0.78 * (1 - isolate) + 0.12;
        const point = curve.getPoint((elapsed * speed + offset) % 1);
        mesh.position.copy(point);
        mesh.scale.setScalar(risk ? 1 + reveal * 0.8 : 1);
      });

      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else if (material) material.dispose();
      });
    };
  }, []);

  return <div ref={hostRef} className="topology-canvas-wrap demo-three-canvas" />;
}

function TopologyDemo() {
  const progress = useDemoProgress(22000);
  const phase = progress < 0.28 ? "phase-flow" : progress < 0.5 ? "phase-release" : progress < 0.75 ? "phase-impact" : "phase-gate";
  const impactNodes = progress < 0.32 ? "Scanning" : progress < 0.55 ? "11" : "18";
  const criticalPaths = progress < 0.44 ? "Calculating" : "3";
  const amp = progress < 0.54 ? "--" : "4.7";
  const topologyCursorMove = easeBetween(progress, 0.3, 0.48);
  const [topologyX, topologyY] = humanPoint(topologyCursorMove, [520, -260], [330, -212], [156, -48], [56, 8], 7);
  const topologyClick = progress >= 0.46 && progress <= 0.5 ? 0.86 : 1;
  const topologyCursorStyle: React.CSSProperties = {
    animation: "none",
    opacity: progress >= 0.27 && progress <= 0.53 ? 1 : 0,
    transform: `translate(${topologyX}px, ${topologyY}px) scale(${topologyClick})`,
  };
  return (
    <DemoShell mode="topology" phase={phase}>
      <section className="demo-topology-layout">
        <div className="panel demo-topology-panel">
          <div className="demo-topology-toolbar">
            <div className="segmented">
              <button><Workflow size={14} />Dependency Graph</button>
              <button className="active"><Network size={14} />3D World</button>
            </div>
            <select><option>nonprod-wgq-s2-system</option></select>
            <select><option>cattle-neuvector-system</option><option>orders</option></select>
            <select><option>Deployment/orders-api</option></select>
            <button className="ghost tiny"><ZoomIn size={14} />Zoom In</button>
            <button className="ghost tiny"><ZoomOut size={14} />Zoom Out</button>
            <button className="ghost tiny"><RefreshCcw size={14} />Reset</button>
            <div className="topology-legend-inline"><span className="workload">Workload</span><span className="pod">Pod</span><span className="service">Service</span><span className="data">Data</span><span className="risk">Risk</span></div>
          </div>
          <div className="demo-flow-stage demo-three-stage">
            <TopologyThreeScene />
            <div className="demo-release-chip"><GitBranch size={14} />Submitted change: orders-api v2.4.1 · 5% canary</div>
            <button className="demo-node-focus-hotspot">
              <span>Deployment/orders-api</span>
              <small>Click to view the change data flow</small>
            </button>
            <span className="demo-cursor demo-topology-cursor" style={topologyCursorStyle} />
            <div className="demo-selected-flow-card">
              <strong>Selected: orders-api</strong>
              <p>After simulating the change, data flows related to the order entry, Kafka, CBS, and ECP are highlighted in red.</p>
            </div>
            <div className="demo-three-status">
              <span className={progress >= 0.25 ? "on" : ""}>Capture eBPF Data Flow</span>
              <span className={progress >= 0.45 ? "hot" : ""}>Impact Path Isolation</span>
              <span className={progress >= 0.72 ? "on" : ""}>Gate Recommendation Generated</span>
            </div>
          </div>
        </div>

        <aside className="panel demo-impact-panel">
          <div className="panel-title">
            <span><BrainCircuit size={16} />AI Impact Analysis</span>
            <button className="primary"><Play size={14} />Analyze</button>
          </div>
          <div className="insight-stack">
            <div className="metric"><span>Topology Nodes</span><strong>30</strong></div>
            <div className="metric"><span>Relationship Edges</span><strong>54</strong></div>
            <div className="metric"><span>CMDB Status</span><strong>ok</strong></div>
          </div>
          <div className="analysis-card selected-node">
            <span>workload · nonprod-wgq-s2-system</span>
            <strong>Deployment/orders-api</strong>
            <p>orders namespace · Risk Status {progress >= 0.55 ? "high" : "normal"}</p>
          </div>
          <div className="analysis-card">
            <div className="score-grid">
              <span>Level {progress >= 0.55 ? "high" : "Calculating"}</span>
              <span>score {progress >= 0.55 ? "0.82" : "--"}</span>
              <span>Amp {amp}</span>
              <span>Paths {criticalPaths}</span>
            </div>
            <div className="demo-selected-node-panel">
              <strong>Selected Node: Deployment/orders-api</strong>
              <span>Inbound: External / Ingress / UAAS</span>
              <span>Outbound: Kafka / CBS / ECP / ELK</span>
            </div>
          </div>
          <div className="demo-impact-story">
            <strong>Canary Release Gate Conclusion</strong>
            <p>Recommend approving a 5% canary first and observing the three critical paths: the order entry, the Kafka middleware cluster, and the CBS financial path. If SLO error-budget consumption is abnormal for 10 consecutive minutes, automatically freeze further rollout.</p>
          </div>
          <div className="demo-impact-list">
            <span className="hot">orders-api → Kafka → ELK</span>
            <span className="hot">orders-api → CBS</span>
            <span>orders-api → ECP</span>
            <span>External ingress → orders-api</span>
          </div>
        </aside>
      </section>
    </DemoShell>
  );
}

export function DemoVideoApp({ mode }: { mode?: string | null }) {
  if (mode === "skills") return <SkillsDemo />;
  if (mode === "topology") return <TopologyDemo />;
  return <InspectionDemo />;
}
