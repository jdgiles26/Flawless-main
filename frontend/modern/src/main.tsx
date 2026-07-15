import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BookOpen,
  Bot,
  Boxes,
  BrainCircuit,
  Beaker,
  ChevronRight,
  CheckCircle2,
  CircleDot,
  Cable,
  Database,
  Eye,
  FileUp,
  Gauge,
  GitBranch,
  KeyRound,
  LineChart,
  LayoutDashboard,
  Loader2,
  MessageSquareText,
  Moon,
  Network,
  PackageSearch,
  Play,
  RefreshCcw,
  Copy,
  Save,
  Search,
  Send,
  Square,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  TerminalSquare,
  Wrench,
  Workflow,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { Topology2D } from "./Topology2D";
import { DemoVideoApp } from "./DemoVideos";
import { OpsJobProgress, OpsPlanPanel } from "./components/OpsPlanPanel";
import { useAsync } from "./hooks/useAsync";
import {
  ApiState,
  adminAuthHeaders,
  apiGet,
  apiPost,
  asList,
  clearAdminCredentials,
  makeId,
  markdownToHtml,
  preloadApplicationResources,
  setAdminCredentials,
} from "./lib/api";
import {
  AlgorithmsPage,
  AssistantDock,
  DashboardPage,
  InfrastructurePage,
  IntegrationsPage,
  OpsSkillsPage,
  OperationsPage,
  ResourcesPage,
  SignalsPage,
} from "./UnifiedPages";
import "./styles.css";

type PageKey = "chat" | "inspection" | "topology" | "dashboard" | "opsHub" | "skills" | "reliability" | "effectiveness" | "platform";
type Theme = "light" | "dark";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "streaming" | "done" | "stopped" | "error";
  activity?: Array<string | { stage?: string; message: string }>;
  data?: any;
  target?: ChatTarget;
};

type ChatTarget = {
  cluster: string;
  cluster_id: string;
  namespace: string;
  workload_type: string;
  workload_name: string;
  pod_name?: string;
  target_id: string;
};

type ModelProfile = {
  id: string;
  provider: string;
  model: string;
  base_url: string;
  auth_type: string;
  role?: string;
  enabled?: boolean;
  description?: string;
};

const navItems = [
  { key: "chat", label: "SRE Chat", group: "Core", icon: MessageSquareText },
  { key: "inspection", label: "AI Inspection", group: "Core", icon: Search },
  { key: "topology", label: "Topology Impact", group: "Core", icon: Network },
  { key: "dashboard", label: "Runtime Overview", group: "Ops Loop", icon: LayoutDashboard },
  { key: "opsHub", label: "Resources & Events", group: "Ops Loop", icon: PackageSearch },
  { key: "skills", label: "Skill Library", group: "Ops Loop", icon: BrainCircuit },
  { key: "reliability", label: "Release Governance", group: "Operations", icon: ShieldCheck },
  { key: "effectiveness", label: "Ops Effectiveness", group: "Operations", icon: LineChart },
  { key: "platform", label: "Platform Capabilities", group: "Platform", icon: Settings2 }
] as const;

const quickPrompts = [
  "Shift inspection: show all P0/P1 anomalies first",
  "Find the root cause of the CrashLoop and generate an executable fix",
  "Check the blast radius of anomalies after the latest release"
];

const highRiskOpsActions = new Set([
  "create_workload", "expand_pvc", "create_pvc", "create_pv", "patch_workload_volume",
  "cordon_node", "evict_pod", "uncordon_node", "rollback_workload", "patch_service",
  "create_configmap", "patch_pdb",
  "db_restart_instance", "db_kill_session", "db_expand_storage", "db_failover", "db_apply_parameter",
  "vm_reboot", "vm_expand_disk", "vm_run_approved_script", "middleware_rebalance",
  "storage_expand_volume", "infra_run_approved_action",
]);

function planNeedsHumanApproval(plan: any) {
  return Boolean(plan?.requires_high_risk_confirmation) || asList(plan?.changes).some((change: any) =>
    change?.risk === "high" || change?.auto_allowed === false || highRiskOpsActions.has(String(change?.type || change?.action || "")),
  );
}

function cx(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(" ");
}

function prettyNumber(value: unknown) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

function markdownish(text: string) {
  return markdownToHtml(text);
}

function App() {
  const [page, setPage] = useState<PageKey>("chat");
  const [visited, setVisited] = useState<Set<PageKey>>(() => new Set<PageKey>(["chat"]));
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("luxyai-theme") as Theme) || "light");
  const [health, refreshHealth] = useAsync<any>(() => apiGet("/api/health"), []);
  const [build] = useAsync<any>(() => apiGet("/api/build"), []);
  const [session, refreshSession] = useAsync<any>(() => apiGet(`/api/session?ts=${Date.now()}`), []);
  const [registry, refreshRegistry] = useAsync<any>(() => apiGet("/api/model-registry"), []);
  const [activeModelId, setActiveModelId] = useState(() => localStorage.getItem("luxyai-active-model") || "");
  const [adminDialog, setAdminDialog] = useState(false);
  const [adminUser, setAdminUser] = useState("admin");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("luxyai-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.body.dataset.admin = session.data?.role === "admin" ? "true" : "false";
  }, [session.data?.role]);

  useEffect(() => {
    preloadApplicationResources();
  }, []);

  useEffect(() => {
    setVisited((current) => current.has(page) ? current : new Set([...current, page]));
  }, [page]);

  useEffect(() => {
    const next = registry.data?.active_profile_id || registry.data?.profiles?.[0]?.id || "";
    if (next && !activeModelId) setActiveModelId(next);
  }, [registry.data, activeModelId]);

  async function activateModel(profileId: string) {
    setActiveModelId(profileId);
    localStorage.setItem("luxyai-active-model", profileId);
    try {
      await apiPost("/api/model-registry/active", { profile_id: profileId });
      refreshRegistry();
    } catch {
      // Keep the UI usable for read-only deployments; the request body still carries the selected profile id.
    }
  }

  async function enterAdminMode() {
    setAdminBusy(true);
    setAdminError("");
    setAdminCredentials(adminUser.trim(), adminPassword);
    try {
      const verified = await apiGet<any>(`/api/session?verify=${Date.now()}`);
      if (verified.role !== "admin") throw new Error(verified.admin_mode ? "Incorrect username or password" : "Server-side CONSOLE_ADMIN_MODE is not enabled");
      setAdminPassword("");
      setAdminDialog(false);
      refreshSession();
      refreshRegistry();
    } catch (error: any) {
      clearAdminCredentials();
      setAdminError(error.message || "Admin authentication failed");
    } finally {
      setAdminBusy(false);
    }
  }

  function leaveAdminMode() {
    clearAdminCredentials();
    refreshSession();
    refreshRegistry();
  }

  const serviceCount = useMemo(() => {
    const services = health.data?.services || {};
    const total = Object.keys(services).length;
    const up = Object.values(services).filter((item: any) => item?.status === "up").length;
    return { up, total };
  }, [health.data]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">Flawless</div>
          <div>
            <strong>SRE Console</strong>
            <span>{build.data?.version || "production control plane"}</span>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            return (
              <React.Fragment key={item.key}>
                {(index === 0 || navItems[index - 1].group !== item.group) && <span className="nav-section-label">{item.group}</span>}
                <button
                  className={cx("nav-button", page === item.key && "active")}
                  onClick={() => React.startTransition(() => setPage(item.key as PageKey))}
                  aria-label={item.label}
                  title={item.label}
                >
                  <Icon size={17} />
                  <strong>{item.label}</strong>
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="side-card">
          <div className="side-row">
            <span>Agents</span>
            <strong>{health.loading ? "--" : `${serviceCount.up}/${serviceCount.total}`}</strong>
          </div>
          <div className="health-dots">
            {Object.entries(health.data?.services || {}).slice(0, 8).map(([name, value]: [string, any]) => (
              <span key={name} className={cx("health-dot", value?.status === "up" ? "ok" : "warn")} title={name} />
            ))}
          </div>
          <button className="ghost tiny" onClick={refreshHealth}><RefreshCcw size={13} />Refresh status</button>
        </div>
        <div className="author-watermark" title="Created by the maintainer">
          <span>Created by</span>
          <strong>the maintainer</strong>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{navItems.find((x) => x.key === page)?.label}</h1>
          <div className="top-actions">
            <label className="top-model">
              <span>Current model</span>
              <select value={activeModelId} onChange={(e) => activateModel(e.target.value)}>
                {asList(registry.data?.profiles).filter((p: ModelProfile) => p.enabled !== false).map((profile: ModelProfile) => (
                  <option key={profile.id} value={profile.id}>{profile.id}</option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}> 
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Light" : "Dark"}
            </button>
            <button
              className={cx("ghost", session.data?.role === "admin" && "admin-active")}
              onClick={() => session.data?.role === "admin" ? leaveAdminMode() : setAdminDialog(true)}
              title={session.data?.role === "admin" ? "Exit admin configuration mode" : "Enter admin configuration mode"}
            >
              <KeyRound size={16} />
              {session.data?.role === "admin" ? "Admin enabled" : "Admin"}
            </button>
          </div>
        </header>
        <div className="page-stack">
          {visited.has("chat") && <div className={cx("page-layer", page === "chat" && "active")}><ChatPage activeModelId={activeModelId} /></div>}
          {visited.has("dashboard") && <div className={cx("page-layer", page === "dashboard" && "active")}><DashboardPage /></div>}
          {visited.has("inspection") && <div className={cx("page-layer", page === "inspection" && "active")}><InspectionPage activeModelId={activeModelId} /></div>}
          {visited.has("topology") && <div className={cx("page-layer", page === "topology" && "active")}><TopologyPage /></div>}
          {visited.has("opsHub") && <div className={cx("page-layer", page === "opsHub" && "active")}><OpsHubPage /></div>}
          {visited.has("skills") && <div className={cx("page-layer", page === "skills" && "active")}><OpsSkillsPage /></div>}
          {visited.has("reliability") && <div className={cx("page-layer", page === "reliability" && "active")}><ReliabilityPage /></div>}
          {visited.has("effectiveness") && <div className={cx("page-layer", page === "effectiveness" && "active")}><EffectivenessPage /></div>}
          {visited.has("platform") && <div className={cx("page-layer", page === "platform" && "active")}><PlatformPage activeModelId={activeModelId} onActivate={activateModel} refreshRegistry={refreshRegistry} registry={registry} /></div>}
        </div>
      </main>
      <AssistantDock page={navItems.find((item) => item.key === page)?.label || page} />
      {adminDialog && <div className="admin-dialog-backdrop" role="presentation" onMouseDown={() => setAdminDialog(false)}>
        <section className="admin-dialog" role="dialog" aria-modal="true" aria-label="Admin configuration mode" onMouseDown={(event) => event.stopPropagation()}>
          <header><KeyRound size={18} /><div><strong>Admin configuration mode</strong><span>Credentials are stored only in this browser session and are not written to frontend config or the repository.</span></div></header>
          <label>Username<input value={adminUser} onChange={(event) => setAdminUser(event.target.value)} autoComplete="username" /></label>
          <label>Password<input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" onKeyDown={(event) => { if (event.key === "Enter") void enterAdminMode(); }} /></label>
          {adminError && <div className="inline-error">{adminError}</div>}
          <footer><button className="ghost" onClick={() => setAdminDialog(false)}>Cancel</button><button className="primary" disabled={adminBusy || !adminUser || !adminPassword} onClick={enterAdminMode}>{adminBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}Verify and enter</button></footer>
        </section>
      </div>}
    </div>
  );
}

function OpsHubPage() {
  const [tab, setTab] = useState<"resources" | "operations">("resources");
  return (
    <section className="hub-page">
      <div className="hub-tabs">
        <button className={tab === "resources" ? "active" : ""} onClick={() => setTab("resources")}><PackageSearch size={15} />Resource Browser</button>
        <button className={tab === "operations" ? "active" : ""} onClick={() => setTab("operations")}><Wrench size={15} />Events & Tools</button>
      </div>
      {tab === "resources" ? <ResourcesPage /> : <OperationsPage />}
    </section>
  );
}

function PlatformPage({
  activeModelId,
  onActivate,
  refreshRegistry,
  registry,
}: {
  activeModelId: string;
  onActivate: (profileId: string) => Promise<void>;
  refreshRegistry: () => void;
  registry: ApiState<any>;
}) {
  const [tab, setTab] = useState<"models" | "knowledge" | "observability" | "algorithms" | "infrastructure" | "integrations">("models");
  return (
    <section className="hub-page">
      <div className="hub-tabs platform-tabs">
        <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}><Beaker size={15} />Model Lab</button>
        <button className={tab === "knowledge" ? "active" : ""} onClick={() => setTab("knowledge")}><BookOpen size={15} />Knowledge Base</button>
        <button className={tab === "observability" ? "active" : ""} onClick={() => setTab("observability")}><Activity size={15} />Observability</button>
        <button className={tab === "algorithms" ? "active" : ""} onClick={() => setTab("algorithms")}><Workflow size={15} />Algorithm Decisions</button>
        <button className={tab === "infrastructure" ? "active" : ""} onClick={() => setTab("infrastructure")}><Database size={15} />Full-Stack Resources</button>
        <button className={tab === "integrations" ? "active" : ""} onClick={() => setTab("integrations")}><Cable size={15} />Integrations</button>
      </div>
      {tab === "models" && <ModelLabPage activeModelId={activeModelId} onActivate={onActivate} refreshRegistry={refreshRegistry} registry={registry} />}
      {tab === "knowledge" && <KnowledgePage activeModelId={activeModelId} />}
      {tab === "observability" && <SignalsPage />}
      {tab === "algorithms" && <AlgorithmsPage />}
      {tab === "infrastructure" && <InfrastructurePage activeModelId={activeModelId} />}
      {tab === "integrations" && <IntegrationsPage />}
    </section>
  );
}

function ChatPage({ activeModelId }: { activeModelId: string }) {
  const [input, setInput] = useState("");
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [workload, setWorkload] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [riskRankLoading, setRiskRankLoading] = useState(false);
  const [riskRankOrder, setRiskRankOrder] = useState<string[]>([]);
  const [riskRankRationales, setRiskRankRationales] = useState<Record<string, string>>({});
  const [riskRankSource, setRiskRankSource] = useState("");
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const streamControllerRef = useRef<AbortController | null>(null);
  const [inventory, refreshInventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [], inventory: [] })), []);
  const clusters = asList(inventory.data?.clusters);
  const selectedCluster = clusters.find((item: any) => cluster === item.id || cluster === item.name);
  const selectedClusterLabel = cluster === "all" ? "All clusters" : selectedCluster?.name || selectedCluster?.id || cluster;
  const scopedInventory = useMemo(() => cluster === "all" ? asList(inventory.data?.inventory) : asList(inventory.data?.inventory).filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name), [cluster, inventory.data]);
  const namespaces = useMemo(() => Array.from(new Set(scopedInventory.flatMap((item: any) => asList(item.namespaces).map((entry: any) => String(entry.name))))).sort(), [scopedInventory]);
  const workloads = useMemo(() => scopedInventory.flatMap((scope: any) => asList(scope.workloads).map((item: any) => ({
    ...item,
    cluster: item.cluster || scope.cluster?.name || scope.cluster?.id || "local-cluster",
    cluster_id: item.cluster_id || scope.cluster?.id || item.cluster || "local",
  }))).filter((item: any) => namespace === "all" || item.namespace === namespace), [namespace, scopedInventory]);
  const workloadIdentity = (item: any) => `${item.cluster_id || item.cluster}|${item.namespace || "default"}|${item.kind || "Workload"}|${item.name}`;
  const selectedWorkload = useMemo(() => workloads.find((item: any) => workloadIdentity(item) === workload), [workload, workloads]);
  const selectedWorkloadName = selectedWorkload?.name || "";
  const workloadInScope = (pod: any) => !selectedWorkloadName
    || pod.workload_name === selectedWorkloadName
    || pod.workload?.name === selectedWorkloadName
    || pod.owner_name === selectedWorkloadName
    || String(pod.name || "").startsWith(`${selectedWorkloadName}-`);
  const problemPods = useMemo(() => scopedInventory
    .flatMap((item: any) => asList(item.pods).map((pod: any) => ({ ...pod, cluster: pod.cluster || item.cluster?.name || item.cluster?.id })))
    .filter((pod: any) => {
      const phase = String(pod.phase || "");
      const completed = phase === "Succeeded" || phase === "Completed";
      return (namespace === "all" || pod.namespace === namespace)
        && workloadInScope(pod)
        && !completed
        && (pod.issue || !pod.ready || Number(pod.restart_count || 0) > 5);
    }), [namespace, scopedInventory, selectedWorkloadName]);
  const riskyWorkloads = useMemo(() => workloads
    .filter((item: any) => !selectedWorkloadName || item.name === selectedWorkloadName)
    .filter((item: any) => {
      const replicas = Number(item.replicas || 0);
      return replicas > 0 && Number(item.ready_replicas || 0) < replicas;
    }), [selectedWorkloadName, workloads]);
  const topRisks = useMemo(() => {
    const rank: Record<string, number> = { P0: 500, critical: 480, P1: 400, high: 380, P2: 300, medium: 280, P3: 200, low: 100 };
    const grouped = new Map<string, any>();
    const severityOf = (value: any, fallback = "P2") => {
      const text = String(value || fallback);
      return /^p[0-3]$/i.test(text) ? text.toUpperCase() : text.toLowerCase();
    };
    const upsert = (item: any) => {
      const existing = grouped.get(item.key);
      if (!existing) { grouped.set(item.key, item); return; }
      existing.score = Math.max(existing.score, item.score);
      existing.restart_count = Math.max(existing.restart_count || 0, item.restart_count || 0);
      existing.reasons = Array.from(new Set([...asList(existing.reasons), ...asList(item.reasons)])).slice(0, 3);
      existing.pods = Array.from(new Set([...asList(existing.pods), ...asList(item.pods)])).slice(0, 8);
      if ((rank[item.severity] || 0) > (rank[existing.severity] || 0)) existing.severity = item.severity;
    };

    riskyWorkloads.forEach((item: any) => {
      const replicas = Number(item.replicas || 0);
      const ready = Number(item.ready_replicas || 0);
      const severity = severityOf(item.issue?.severity, ready === 0 && replicas > 0 ? "P1" : "P2");
      upsert({
        key: `workload:${item.cluster}:${item.namespace}:${item.kind}:${item.name}`,
        type: "workload",
        cluster: item.cluster,
        cluster_id: item.cluster_id,
        namespace: item.namespace || "default",
        kind: item.kind || "Workload",
        name: item.name,
        severity,
        ready_replicas: ready,
        replicas,
        restart_count: 0,
        reasons: [`${ready}/${replicas} Ready`],
        pods: [],
        score: (rank[severity] || 0) + Math.max(0, replicas - ready) * 18,
      });
    });

    problemPods.forEach((pod: any) => {
      const kind = String(pod.workload_kind || pod.workload?.kind || "Workload");
      const owner = String(pod.workload_name || pod.workload?.name || pod.owner_name || "");
      const hasWorkload = Boolean(owner) && kind.toLowerCase() !== "pod";
      const severity = severityOf(pod.issue?.severity, /crash|oom|imagepull/i.test(String(pod.issue?.reason || pod.phase || "")) ? "P1" : "P2");
      const reason = String(pod.issue?.reason || pod.phase || "NotReady");
      const restartCount = Number(pod.restart_count || 0);
      upsert({
        key: hasWorkload ? `workload:${pod.cluster}:${pod.namespace}:${kind}:${owner}` : `pod:${pod.cluster}:${pod.namespace}:${pod.name}`,
        type: hasWorkload ? "workload" : "pod",
        cluster: pod.cluster,
        cluster_id: pod.cluster_id || pod.cluster,
        namespace: pod.namespace || "default",
        kind: hasWorkload ? kind : "Pod",
        name: hasWorkload ? owner : pod.name,
        severity,
        ready_replicas: hasWorkload ? 0 : undefined,
        replicas: hasWorkload ? 1 : undefined,
        restart_count: restartCount,
        reasons: [reason],
        pods: [pod.name],
        score: (rank[severity] || 0) + Math.min(80, restartCount * 4) + (!pod.ready ? 20 : 0),
      });
    });
    return Array.from(grouped.values()).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, 6);
  }, [problemPods, riskyWorkloads]);
  const displayedRisks = useMemo(() => {
    if (!riskRankOrder.length) return topRisks;
    const byKey = new Map(topRisks.map((item: any) => [String(item.key), item]));
    const ordered = riskRankOrder.map((key) => byKey.get(key)).filter(Boolean);
    const orderedKeys = new Set(riskRankOrder);
    return [...ordered, ...topRisks.filter((item: any) => !orderedKeys.has(String(item.key)))];
  }, [riskRankOrder, topRisks]);

  useEffect(() => {
    setRiskRankOrder([]);
    setRiskRankRationales({});
    setRiskRankSource("");
  }, [cluster, namespace, selectedWorkloadName]);

  async function rerankRisks() {
    if (!topRisks.length || riskRankLoading) return;
    setRiskRankLoading(true);
    try {
      const response: any = await apiPost("/api/chat/risk-rank", {
        cluster,
        namespace,
        model_profile_id: activeModelId,
        risks: topRisks.map((item: any) => ({
          key: item.key,
          type: item.type,
          cluster: item.cluster,
          namespace: item.namespace,
          kind: item.kind,
          name: item.name,
          severity: item.severity,
          score: item.score,
          replicas: item.replicas,
          ready_replicas: item.ready_replicas,
          restart_count: item.restart_count,
          reasons: item.reasons,
          pods: item.pods,
        })),
      });
      setRiskRankOrder(asList(response.ordered_keys).map(String));
      setRiskRankRationales(response.rationales || {});
      setRiskRankSource(response.source || "evidence_ranker");
    } catch (error: any) {
      setRiskRankSource(`Ranking failed: ${error.message}`);
    } finally {
      setRiskRankLoading(false);
    }
  }

  function diagnoseRisk(item: any) {
    const target: ChatTarget = {
      cluster: item.cluster || selectedClusterLabel,
      cluster_id: item.cluster_id || item.cluster || cluster,
      namespace: item.namespace || "default",
      workload_type: item.type === "workload" ? item.kind : "Pod",
      workload_name: item.type === "workload" ? item.name : "",
      pod_name: item.type === "pod" ? item.name : asList(item.pods)[0] || "",
      target_id: item.key,
    };
    if (item.type === "workload") {
      const podEvidence = asList(item.pods).length ? `, related abnormal Pods: ${asList(item.pods).join(", ")}` : "";
      send(`Please diagnose the high-risk issue affecting ${item.kind}/${item.name} in cluster ${item.cluster || selectedClusterLabel}, namespace ${item.namespace}${podEvidence}. First trace all related Pods, logs, Events, rollout history, configuration, storage, and dependencies, then match the most appropriate operations Skill and provide a repair plan that can be reviewed and executed.`, target);
      return;
    }
    send(`Please diagnose Pod ${item.name}, which has no upstream Workload, in cluster ${item.cluster || cluster}, namespace ${item.namespace}. First read the logs, Events, Pod configuration, and node status, then match the most appropriate operations Skill and provide a repair plan that can be reviewed and executed.`, target);
  }

  useEffect(() => {
    requestAnimationFrame(() => {
      if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    });
  }, [messages]);

  async function send(text = input, explicitTarget?: ChatTarget) {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    const selectedTarget: ChatTarget | undefined = explicitTarget || (selectedWorkload ? {
      cluster: selectedWorkload.cluster || selectedClusterLabel,
      cluster_id: selectedWorkload.cluster_id || cluster,
      namespace: selectedWorkload.namespace || namespace,
      workload_type: selectedWorkload.kind || "Workload",
      workload_name: selectedWorkload.name,
      pod_name: "",
      target_id: workloadIdentity(selectedWorkload),
    } : undefined);
    const requestCluster = selectedTarget?.cluster_id || cluster;
    const requestNamespace = selectedTarget?.namespace || namespace;
    setInput("");
    const user: ChatMessage = { id: makeId(), role: "user", text: prompt, target: selectedTarget };
    const assistant: ChatMessage = { id: makeId(), role: "assistant", text: "", status: "streaming", activity: [], target: selectedTarget };
    setMessages((old) => [...old, user, assistant]);
    setStreaming(true);
    const controller = new AbortController();
    streamControllerRef.current = controller;
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        signal: controller.signal,
        body: JSON.stringify({
          message: prompt,
          original_message: prompt,
          model_profile_id: activeModelId,
          cluster: selectedTarget?.cluster || requestCluster,
          cluster_id: requestCluster,
          namespace: requestNamespace,
          deployment: selectedTarget?.workload_name || "",
          workload_type: selectedTarget?.workload_type || "Workload",
          pod: selectedTarget?.pod_name || "",
          target_id: selectedTarget?.target_id || "",
          severity: "P2",
          auto_healing_enabled: false
        })
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "delta") {
            setMessages((old) => old.map((m) => (m.id === assistant.id ? { ...m, text: m.text + event.text } : m)));
          }
          if (event.type === "status") {
            setMessages((old) => old.map((m) => m.id === assistant.id ? { ...m, activity: [...(m.activity || []), { stage: event.stage, message: event.message }].slice(-8) } : m));
          }
          if (event.type === "final") {
            setMessages((old) => old.map((m) => m.id === assistant.id ? { ...m, data: event.data } : m));
          }
          if (event.type === "error") throw new Error(event.message);
        }
      }
      setMessages((old) => old.map((m) => (m.id === assistant.id ? { ...m, status: "done" } : m)));
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === "AbortError") {
        setMessages((old) => old.map((m) => (m.id === assistant.id ? { ...m, status: "stopped", text: m.text || "You stopped this response.", activity: [] } : m)));
      } else {
        setMessages((old) => old.map((m) => (m.id === assistant.id ? { ...m, status: "error", text: m.text || `Request failed: ${error.message}` } : m)));
      }
    } finally {
      if (streamControllerRef.current === controller) streamControllerRef.current = null;
      setStreaming(false);
    }
  }

  function stopStreaming() {
    streamControllerRef.current?.abort();
  }

  return (
    <section className={cx("chat-layout", messages.length === 0 ? "chat-empty-state" : "chat-active-state") }>
      <div className={cx("chat-content-grid", messages.length > 0 && "with-risk-rail")}>
      <div className="conversation" ref={conversationRef}>
        {messages.length === 0 ? <div className="welcome-panel">
          <div className="welcome-orbit"><Bot size={24} /></div>
          <h2>What needs attention today?</h2>
          <p>Describe the symptom or goal. I will read real cluster evidence first, then provide a remediation plan that can be rehearsed, approved, and verified.</p>
          <div className="ops-scope-bar">
            <div className="ops-scope-selects">
              <label><span>Cluster</span><select value={cluster} onChange={(e) => { setCluster(e.target.value); setNamespace("all"); setWorkload(""); }}>
                <option value="all">All clusters</option>
                {clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
              </select></label>
              <label><span>Namespace</span><select value={namespace} onChange={(e) => { setNamespace(e.target.value); setWorkload(""); }} disabled={inventory.loading}>
                <option value="all">All namespaces</option>
                {namespaces.map((item) => <option key={item} value={item}>{item}</option>)}
              </select></label>
              <label><span>Workload</span><select value={workload} onChange={(e) => setWorkload(e.target.value)} disabled={inventory.loading}>
                <option value="">All Workloads</option>
                {workloads.map((item: any) => <option key={workloadIdentity(item)} value={workloadIdentity(item)}>{item.kind}/{item.name}</option>)}
              </select></label>
            </div>
            <button className="ghost tiny" onClick={refreshInventory} disabled={inventory.loading}>
              {inventory.loading ? <Loader2 className="spin" size={13} /> : <RefreshCcw size={13} />}
              Refresh anomaly counts
            </button>
          </div>
          <div className={cx("ops-brief", inventory.loading && "loading")}>
            <div><span>Current scope</span><strong>{inventory.loading ? "Loading" : selectedClusterLabel}</strong><small>{namespace === "all" ? "All namespaces" : namespace}{selectedWorkload ? ` / ${selectedWorkload.kind}/${selectedWorkload.name}` : ""}</small></div>
            <div><span>Problem Pods</span><strong>{inventory.loading ? <Loader2 className="spin" size={17} /> : problemPods.length}</strong><small>NotReady / Restarts / Events</small></div>
            <div><span>Problem Workloads</span><strong>{inventory.loading ? <Loader2 className="spin" size={17} /> : riskyWorkloads.length}</strong><small>Insufficient ready replicas</small></div>
          </div>
          {inventory.error && <div className="error-box">Failed to read cluster resources: {inventory.error}</div>}
          {!inventory.loading && displayedRisks.length === 0 && <div className="notice-box">No problem Pods or Workloads with insufficient ready replicas were found in the current scope.</div>}
          {displayedRisks.length > 0 && <div className="ops-hotlist">
            {displayedRisks.map((item: any) => <button key={item.key} onClick={() => diagnoseRisk(item)} disabled={streaming}>
              <span>{item.severity} · {asList(item.reasons)[0] || "High risk"}</span>
              <strong>{item.type === "workload" ? `${item.kind}/${item.name}` : `Pod/${item.name}`}</strong>
              <small>{item.cluster || cluster} / {item.namespace}{asList(item.pods).length ? ` · ${asList(item.pods).length}  problem Pods` : ""}</small>
            </button>)}
          </div>}
          <div className="prompt-grid">
            {quickPrompts.map((prompt) => (
              <button key={prompt} onClick={() => send(prompt)}>{prompt}<ChevronRight size={15} /></button>
            ))}
          </div>
        </div> : messages.map((message) => <MessageBubble key={message.id} message={message} />)}
      </div>
      {messages.length > 0 && <aside className="chat-risk-rail">
        <div className="risk-rail-head"><div><span>High risk in current scope</span><strong>{selectedClusterLabel}</strong><small>{namespace === "all" ? "All namespaces" : namespace} · Top {displayedRisks.length}/6</small></div><button className="row-icon-button" onClick={refreshInventory} disabled={inventory.loading} title="Refresh risks">{inventory.loading ? <Loader2 className="spin" size={14} /> : <RefreshCcw size={14} />}</button></div>
        <div className="risk-rail-stats"><span><b>{problemPods.length}</b>Problem Pods</span><span><b>{riskyWorkloads.length}</b>Problem Workloads</span></div>
        <div className="risk-rail-list">
          {displayedRisks.length ? displayedRisks.map((item: any, index: number) => <button key={item.key} onClick={() => diagnoseRisk(item)} disabled={streaming}>
            <i>{index + 1}</i><div><span>{item.severity} · {item.type === "workload" ? "Workload" : "Standalone Pod"}</span><strong>{item.type === "workload" ? `${item.kind}/${item.name}` : item.name}</strong><small>{riskRankRationales[item.key] || asList(item.reasons).join(" · ")}{item.restart_count ? ` · restart ${item.restart_count}` : ""}</small></div><ChevronRight size={14} />
          </button>) : <div className="radar-empty">{inventory.loading ? "Loading risks..." : "No high-risk resources in the current scope"}</div>}
        </div>
        {riskRankSource && <small className="risk-rank-source">{riskRankSource === "llm_constrained_ranking" ? "Re-ranked by the AI business impact model" : riskRankSource === "deterministic_fallback" ? "Re-ranked by evidence score" : riskRankSource}</small>}
        <button className="ghost risk-ai-rank" onClick={rerankRisks} disabled={riskRankLoading || !topRisks.length}>{riskRankLoading ? <Loader2 className="spin" size={14} /> : <Sparkles size={14} />}{riskRankLoading ? "Re-ranking..." : "AI re-rank"}</button>
      </aside>}
      </div>
      <div className="composer-wrap">
        <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
          placeholder="Describe cluster symptoms, business impact, a Pod name, or the action you want to take..."
        />
        <div className="composer-footer">
          <div className="scope">
            <select value={cluster} onChange={(e) => { setCluster(e.target.value); setNamespace("all"); setWorkload(""); }}>
              <option value="all">All clusters</option>
              {clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}
            </select>
            <select value={namespace} onChange={(e) => { setNamespace(e.target.value); setWorkload(""); }}><option value="all">All namespaces</option>{namespaces.map((item) => <option key={item} value={item}>{item}</option>)}</select>
            <select value={workload} onChange={(e) => setWorkload(e.target.value)}><option value="">All Workloads</option>{workloads.map((item: any) => <option key={workloadIdentity(item)} value={workloadIdentity(item)}>{item.kind}/{item.name}</option>)}</select>
          </div>
          <button className={cx("chat-send", streaming && "stop")} onClick={streaming ? stopStreaming : () => send()} disabled={!streaming && !input.trim()} title={streaming ? "Stop response" : "Send"}>
            {streaming ? <Square size={14} fill="currentColor" /> : <Send size={17} />}
          </button>
        </div>
        </div>
        <small className="composer-note">AI can make mistakes; all cluster changes go through risk gates and human confirmation.</small>
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const plan = useMemo(() => chatPlanFromResponse(message.data), [message.data]);
  const [copied, setCopied] = useState(false);
  const activities = asList(message.activity).map((item: any) => typeof item === "string" ? { message: item } : item);
  const latestActivity = activities.at(-1)?.message;
  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(message.text || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { setCopied(false); }
  }
  return (
    <article className={cx("message", message.role, message.status === "streaming" && "streaming")}>
      <div className="avatar">{message.role === "assistant" ? <Bot size={16} /> : "You"}</div>
      <div className="bubble">
        <div className="message-meta">{message.role === "assistant" ? "Flawless SRE" : "You"} {message.status === "streaming" && <span>Generating</span>}{message.status === "stopped" && <span>Stopped</span>}</div>
        {message.target && <div className="message-target"><CircleDot size={11} /><span>{message.target.cluster} / {message.target.namespace}</span><b>{message.target.workload_name ? `${message.target.workload_type}/${message.target.workload_name}` : `Pod/${message.target.pod_name}`}</b></div>}
        {message.role === "assistant" && activities.length > 0 && (
          <details className="agent-activity" open={message.status === "streaming"}>
            <summary>{message.status === "streaming" ? <Loader2 className="spin" size={13} /> : <CheckCircle2 size={13} />}<span>{message.status === "streaming" ? latestActivity : `Completed ${activities.length} analysis stages`}</span></summary>
            <div>{activities.map((item: any, index: number) => <span key={`${item.stage || "stage"}-${index}`}><i>{index + 1}</i>{item.message}</span>)}</div>
          </details>
        )}
        {message.text ? <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownish(message.text) }} /> : message.status === "streaming" ? <div className="response-waiting"><i /><i /><i /></div> : null}
        {message.role === "assistant" && message.text && message.status !== "streaming" && <div className="message-actions"><button className="row-icon-button" onClick={copyAnswer} title="Copy answer">{copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}</button></div>}
        {plan && message.status !== "streaming" && <OpsPlanPanel plan={plan} />}
      </div>
    </article>
  );
}

function chatPlanFromResponse(data: any) {
  const raw = data?.raw || {};
  if (raw.mode === "general_chat") return null;
  const diagnosis = raw.diagnosis || {};
  const decision = raw.decision || {};
  const remediation = diagnosis.remediation_plan || {};
  const alert = raw.alert || {};
  const changes = asList(remediation.changes).length ? remediation.changes : asList(decision.proposed_changes).length ? decision.proposed_changes : diagnosis.proposed_changes;
  const steps = asList(remediation.steps).length ? remediation.steps : asList(diagnosis.immediate_actions).map((item: any, index: number) => ({ id: `diagnostic-${index}`, title: typeof item === "string" ? item : item.title || item.action || `Diagnostic step ${index + 1}`, description: typeof item === "string" ? item : item.description || "" }));
  if (!steps.length && !asList(changes).length) return null;
  return {
    id: `chat-${makeId()}`,
    title: "SRE Chat Remediation Plan",
    cluster: alert.cluster || "all",
    cluster_id: alert.cluster_id || alert.cluster || "all",
    namespace: alert.namespace || "default",
    target: `${alert.workload_type || "Workload"}/${alert.workload_name || alert.deployment || "selected-target"}`,
    pod_name: alert.pod || "",
    summary: diagnosis.root_cause || diagnosis.summary || "Remediation plan generated from SRE chat evidence.",
    reason: remediation.reason || decision.reason || diagnosis.root_cause || "",
    evidence_gap: remediation.evidence_gap || diagnosis.evidence_gap || "",
    root_cause_hypotheses: remediation.hypotheses || diagnosis.root_cause_hypotheses || [],
    success_criteria: remediation.success_criteria || decision.success_criteria || [],
    steps,
    changes: asList(changes),
    operator_skills: remediation.operator_skills || diagnosis.operator_skills || [],
    skill_allowed_actions: remediation.skill_allowed_actions || [],
    planning_engine: remediation.planning_engine || remediation.engine || "",
    step_source: remediation.step_source || "",
    requires_high_risk_confirmation: Boolean(remediation.requires_high_risk_confirmation),
    requires_confirmation: asList(changes).length > 0,
    model_profile_id: diagnosis.diagnosis_metadata?.model_profile_id || "",
    source: raw.k8s_context?.source || (alert.cluster_id && !["all", "local", "local-cluster"].includes(alert.cluster_id) ? "rancher" : "sre_chat"),
  };
}

function InspectionPage({ activeModelId }: { activeModelId: string }) {
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [autoOps, setAutoOps] = useState(false);
  const [productionMode, setProductionMode] = useState(true);
  const [scheduled, setScheduled] = useState(false);
  const [schedulePreset, setSchedulePreset] = useState("120");
  const [customMinutes, setCustomMinutes] = useState("120");
  const [lastScheduledAt, setLastScheduledAt] = useState("");
  const [result, setResult] = useState<ApiState<any>>({ loading: false });
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [previewState, setPreviewState] = useState<ApiState<any>>({ loading: false });
  const [previewingId, setPreviewingId] = useState("");
  const [autoJobs, setAutoJobs] = useState<any[]>([]);
  const [pendingApprovalPlans, setPendingApprovalPlans] = useState<any[]>([]);
  const runLock = useRef(false);
  const [inventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [], inventory: [] })), []);
  const inspectionClusters = asList(inventory.data?.clusters);
  const inspectionNamespaces = useMemo(() => {
    const scoped = cluster === "all" ? asList(inventory.data?.inventory) : asList(inventory.data?.inventory).filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name);
    return Array.from(new Set(scoped.flatMap((item: any) => asList(item.namespaces).map((entry: any) => String(entry.name))))).sort();
  }, [cluster, inventory.data]);

  const scheduleMinutes = Math.max(30, Number(schedulePreset === "custom" ? customMinutes : schedulePreset) || 120);

  async function run(trigger: "manual" | "scheduled" = "manual") {
    if (runLock.current) return;
    runLock.current = true;
    setResult({ loading: true });
    setSelectedPlan(null);
    setPreviewState({ loading: false });
    setPreviewingId("");
    setAutoJobs([]);
    setPendingApprovalPlans([]);
    try {
      const data = await apiPost<any>("/api/inspection/run", { cluster, namespace, auto_ops: autoOps, production_mode: productionMode, model_profile_id: activeModelId });
      setResult({ loading: false, data });
      if (autoOps) {
        const plans = asList(data?.findings).map((item: any) => item.ops_plan).filter((plan: any) => plan && (asList(plan.steps).length || asList(plan.changes).length)).slice(0, 5);
        const approvalRequired = plans.filter(planNeedsHumanApproval);
        const autonomousPlans = plans.filter((plan: any) => !planNeedsHumanApproval(plan));
        setPendingApprovalPlans(approvalRequired);
        const submitted = await Promise.all(autonomousPlans.map(async (plan: any) => {
          try { return await apiPost("/api/ops/jobs", { plan, confirm: true, autonomous: true }); }
          catch (error: any) { return { id: `rejected-${makeId()}`, status: "blocked", message: error.message, target: plan.target, plan }; }
        }));
        setAutoJobs(submitted);
      }
      if (trigger === "scheduled") setLastScheduledAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    } catch (error: any) {
      setResult({ loading: false, error: error.message });
    } finally {
      runLock.current = false;
    }
  }

  useEffect(() => {
    if (!scheduled) return;
    const timer = window.setInterval(() => {
      if (!runLock.current) void run("scheduled");
    }, scheduleMinutes * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [scheduled, scheduleMinutes, cluster, namespace, autoOps, productionMode, activeModelId]);

  async function previewFinding(finding: any) {
    const findingId = String(finding?.id || "");
    if (!findingId) return;
    setPreviewingId(findingId);
    setSelectedPlan(null);
    setPreviewState({ loading: true });
    try {
      const data = await apiPost<any>("/api/inspection/preview", { finding_id: findingId, model_profile_id: activeModelId });
      setSelectedPlan(data.plan || null);
      setPreviewState({ loading: false, data });
    } catch (error: any) {
      setPreviewState({ loading: false, error: error.message });
    } finally {
      setPreviewingId("");
    }
  }

  useEffect(() => {
    const activeJobs = autoJobs.filter((job) => job.id && !String(job.id).startsWith("rejected-") && ["queued", "running", "cancelling"].includes(job.status));
    if (!activeJobs.length) return;
    const timer = window.setTimeout(async () => {
      const next = await Promise.all(autoJobs.map(async (job) => {
        if (!activeJobs.some((activeJob) => activeJob.id === job.id)) return job;
        try { return await apiGet(`/api/ops/jobs/${encodeURIComponent(job.id)}`); }
        catch (error: any) {
          const failures = Number(job.poll_failures || 0) + 1;
          if (failures < 3) return { ...job, poll_failures: failures };
          return {
            ...job,
            status: "failed",
            stage: "failed",
            poll_failures: failures,
            message: `Failed to read task status repeatedly; stopped waiting: ${error.message}`,
            updated_at: new Date().toISOString(),
            events: [...asList(job.events), { timestamp: new Date().toISOString(), stage: "failed", level: "error", message: `Task status API unreachable: ${error.message}` }],
          };
        }
      }));
      setAutoJobs(next);
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [autoJobs]);

  const findings = asList(result.data?.findings);
  const summary = result.data?.summary || {};
  return (
    <section className="workspace-grid inspection-workspace">
      <Panel className="control-panel">
        <PanelTitle icon={Search} title="Inspection scope" action={<button className="primary" onClick={() => run("manual")} disabled={result.loading}>{result.loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}Run inspection now</button>} />
        <div className="form-grid">
          <label>Cluster<select value={cluster} onChange={(e) => { setCluster(e.target.value); setNamespace("all"); }}><option value="all">All clusters</option>{inspectionClusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
          <label>Namespace<select value={namespace} onChange={(e) => setNamespace(e.target.value)}><option value="all">All namespaces</option>{inspectionNamespaces.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Scheduled inspection<select value={schedulePreset} onChange={(e) => setSchedulePreset(e.target.value)}><option value="30">Every 30 minutes</option><option value="60">Every 1 hour</option><option value="120">Every 2 hours</option><option value="360">Every 6 hours</option><option value="custom">Custom minutes</option></select></label>
          {schedulePreset === "custom" && <label>Custom minutes<input type="number" min={30} step={10} value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} /></label>}
          <label className="toggle"><input type="checkbox" checked={autoOps} onChange={(e) => setAutoOps(e.target.checked)} />Enable autonomous operations (only for plans that pass the gate)</label>
          <label className="toggle"><input type="checkbox" checked={productionMode} onChange={(e) => setProductionMode(e.target.checked)} />Production mode</label>
          <label className="toggle"><input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />Enable scheduled inspection (minimum 30 minutes)</label>
        </div>
        <div className="ops-event-chips">
          <span><RefreshCcw size={12} /> Interval {scheduleMinutes} minutes</span>
          <span>{scheduled ? "Schedule enabled" : "Schedule disabled"}</span>
          {lastScheduledAt && <span>Last automated inspection {lastScheduledAt}</span>}
        </div>
      </Panel>
      <div className="metric-strip">
        <Metric title="Issues found" value={summary.total ?? findings.length} />
        <Metric title="P0/P1" value={(findings.filter((f: any) => ["P0", "P1"].includes(f.severity)).length)} tone="danger" />
        <Metric title="Executable plans" value={findings.filter((f: any) => f.ops_plan).length} />
        <Metric title="Skill routing" value={summary.skill_routed || 0} />
      </div>
      <Panel className="span-all">
        <PanelTitle icon={ShieldCheck} title="Anomaly queue" subtitle="Each item shows root-cause evidence, rehearsal steps, change diffs, and recovery criteria" />
        {result.error && <div className="error-box">{result.error}</div>}
        {!findings.length && !result.loading ? <EmptyState text="No inspection has been run yet, or there are no new issues in the current scope." /> : (
          <div className="finding-list">
            {findings.map((f: any) => (
              <div className="finding" key={f.id || f.title}>
                <div>
                  <strong>{f.title || f.summary || "Issue"}</strong>
                  <p>{f.summary || f.reason || "Waiting for AI to add diagnosis."}</p>
                  <div className="chips"><span>{f.cluster || cluster}</span><span>{f.namespace || namespace}</span><span>{f.category || "runtime"}</span>{asList(f.matched_skills).slice(0, 2).map((skill: any) => <span key={skill.id}>Skill · {skill.name}</span>)}</div>
                </div>
                <div className="finding-actions"><span className={cx("severity", f.severity === "P0" || f.severity === "P1" ? "hot" : "")}>{f.severity || "P2"}</span><button className="ghost tiny" onClick={() => previewFinding(f)} disabled={previewState.loading}>{previewingId === String(f.id) ? <Loader2 className="spin" size={14} /> : <Eye size={14} />}{previewingId === String(f.id) ? "Live evidence" : "AI preview"}</button></div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {previewState.error && <Panel className="span-all inspection-plan-panel"><div className="error-box">AI preview failed: {previewState.error}</div></Panel>}
      {selectedPlan && <Panel className="span-all inspection-plan-panel"><PanelTitle icon={TerminalSquare} title="Real-time AI operations preview" subtitle="Live evidence has been re-read and Skills, root cause, actions, and recovery criteria have been validated; the cluster will not be modified before confirmation" /><OpsPlanPanel plan={selectedPlan} /></Panel>}
      {pendingApprovalPlans.length > 0 && <Panel className="span-all"><PanelTitle icon={ShieldCheck} title="High-risk plans awaiting confirmation" subtitle="Autonomous operations will not bypass high-risk gates; review and execute each plan one by one, and each real change step can still be paused for confirmation" /><div className="inspection-approval-queue">{pendingApprovalPlans.map((plan: any) => <OpsPlanPanel key={plan.id || plan.target} plan={plan} autonomous={false} />)}</div></Panel>}
      {autoJobs.length > 0 && <Panel className="span-all"><PanelTitle icon={Activity} title="Autonomous operations execution flow" subtitle="Tasks continue running after page switches and can be interrupted at any time" /><div className="auto-job-grid detailed">{autoJobs.map((job) => <OpsJobProgress key={job.id} job={job} compact onCancel={["queued", "running", "awaiting_approval", "cancelling"].includes(job.status) ? async () => { const next = await apiPost(`/api/ops/jobs/${encodeURIComponent(job.id)}/cancel`, {}); setAutoJobs((items) => items.map((item) => item.id === job.id ? next : item)); } : undefined} />)}</div></Panel>}
    </section>
  );
}

function flowDirectionLabel(direction: string) {
  if (direction === "ingress") return "Ingress";
  if (direction === "egress") return "Egress";
  if (direction === "cross_cluster") return "Cross-cluster";
  return direction || "Unknown";
}

function flowEndpointLabel(endpoint: any) {
  if (!endpoint) return "-";
  const name = endpoint.name || endpoint.address || "-";
  const prefix = endpoint.kind ? `${endpoint.kind}/` : "";
  const port = endpoint.port ? `:${endpoint.port}` : "";
  return `${prefix}${name}${port}`;
}

function ExternalTrafficPage() {
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [workload, setWorkload] = useState("");
  const [windowSize, setWindowSize] = useState("30m");
  const [source, setSource] = useState("auto");
  const [direction, setDirection] = useState("all");
  const [traffic, setTraffic] = useState<ApiState<any>>({ loading: false });
  const [inventory, refreshInventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [], inventory: [] })), []);
  const clusters = asList(inventory.data?.clusters);
  const scopedInventory = useMemo(() => cluster === "all" ? asList(inventory.data?.inventory) : asList(inventory.data?.inventory).filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name), [cluster, inventory.data]);
  const namespaces = useMemo(() => Array.from(new Set(scopedInventory.flatMap((item: any) => asList(item.namespaces).map((entry: any) => String(entry.name))))).sort(), [scopedInventory]);
  const workloads = useMemo(() => scopedInventory.flatMap((scope: any) => asList(scope.workloads).map((item: any) => ({
    id: `${item.cluster_id || scope.cluster?.id || scope.cluster?.name}:${item.namespace}:${item.kind}/${item.name}`,
    label: `${item.kind}/${item.name}`,
    name: item.name,
    namespace: item.namespace,
    cluster: item.cluster_id || scope.cluster?.id || scope.cluster?.name,
  }))).filter((item: any) => (namespace === "all" || item.namespace === namespace)), [scopedInventory, namespace]);

  const flows = useMemo(() => {
    const rows = asList(traffic.data?.flows);
    return direction === "all" ? rows : rows.filter((flow: any) => flow.direction === direction);
  }, [traffic.data, direction]);

  useEffect(() => {
    runTraffic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (namespace !== "all" && !namespaces.includes(namespace)) setNamespace("all");
  }, [namespace, namespaces]);

  async function runTraffic() {
    setTraffic({ loading: true });
    try {
      const selectedCluster = clusters.find((item: any) => cluster === item.id || cluster === item.name);
      const data = await apiPost("/api/network/external-flows", {
        cluster: cluster === "all" ? "all" : (selectedCluster?.name || cluster),
        cluster_id: cluster === "all" ? "" : (selectedCluster?.id || cluster),
        namespace,
        workload,
        window: windowSize,
        source,
        include_static_inference: true,
        include_cmdb: true,
      });
      setTraffic({ loading: false, data });
    } catch (error: any) {
      setTraffic({ loading: false, error: error.message });
    }
  }

  const summary = traffic.data?.summary || {};
  const graph = traffic.data?.graph || {};
  const sourceStatus = asList(traffic.data?.data_source_status);
  return (
    <section className="traffic-page">
      <Panel className="traffic-command">
        <PanelTitle icon={Cable} title="External Data Flows" subtitle="Show only flows outside the cluster boundary or across clusters, with direction, destination, and evidence presented separately." action={<button className="ghost" onClick={() => { refreshInventory(); runTraffic(); }}><RefreshCcw size={15} />Refresh</button>} />
        <div className="traffic-filters">
          <label>Cluster<select value={cluster} onChange={(e) => { setCluster(e.target.value); setNamespace("all"); setWorkload(""); }}>
            <option value="all">All clusters</option>
            {clusters.map((item: any) => <option value={item.id || item.name} key={item.id || item.name}>{item.name || item.id}</option>)}
          </select></label>
          <label>Namespace<select value={namespace} onChange={(e) => { setNamespace(e.target.value); setWorkload(""); }}>
            <option value="all">All namespaces</option>
            {namespaces.map((item) => <option value={item} key={item}>{item}</option>)}
          </select></label>
          <label>Workload<select value={workload} onChange={(e) => setWorkload(e.target.value)}>
            <option value="">All Workloads</option>
            {workloads.map((item: any) => <option value={item.name} key={item.id}>{item.label}</option>)}
          </select></label>
          <label>Window<select value={windowSize} onChange={(e) => setWindowSize(e.target.value)}>
            <option value="15m">15 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
          </select></label>
          <label>Source<select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="auto">Auto</option>
            <option value="observed">Prefer observed traffic</option>
            <option value="static">Configuration inference only</option>
          </select></label>
          <button className="primary" onClick={runTraffic} disabled={traffic.loading}>{traffic.loading ? <Loader2 className="spin" size={15} /> : <Play size={15} />}Analyze data flows</button>
        </div>
      </Panel>

      <div className="traffic-kpis">
        <Metric title="Boundary flows" value={traffic.loading ? "..." : summary.total || 0} />
        <Metric title="Ingress" value={summary.ingress || 0} />
        <Metric title="Egress" value={summary.egress || 0} />
        <Metric title="Cross-cluster" value={summary.cross_cluster || 0} />
        <Metric title="Observed" value={summary.observed || 0} tone={summary.observed ? "good" : undefined} />
        <Metric title="Inferred flows" value={summary.inferred || 0} />
      </div>

      {traffic.error && <div className="error-box">{traffic.error}</div>}

      <div className="traffic-layout">
        <Panel className="traffic-map-panel">
          <PanelTitle icon={Network} title="Direction radar" subtitle={traffic.data?.message || "Click Analyze to show inbound, outbound, and cross-cluster flows."} />
          <div className="traffic-radar">
            <div className="traffic-radar-center">
              <Network size={22} />
              <strong>Cluster Boundary</strong>
              <span>{cluster === "all" ? "all clusters" : cluster}</span>
            </div>
            <div className="traffic-lane ingress">
              <b>External inbound</b>
              {flows.filter((f: any) => f.direction === "ingress").slice(0, 6).map((flow: any) => <span key={flow.id}>{flowEndpointLabel(flow.source)} → {flowEndpointLabel(flow.destination)}</span>)}
            </div>
            <div className="traffic-lane egress">
              <b>Outbound</b>
              {flows.filter((f: any) => f.direction === "egress").slice(0, 6).map((flow: any) => <span key={flow.id}>{flowEndpointLabel(flow.source)} → {flowEndpointLabel(flow.destination)}</span>)}
            </div>
            <div className="traffic-lane cross">
              <b>Cross-cluster</b>
              {flows.filter((f: any) => f.direction === "cross_cluster").slice(0, 6).map((flow: any) => <span key={flow.id}>{flowEndpointLabel(flow.source)} → {flowEndpointLabel(flow.destination)}</span>)}
            </div>
          </div>
          <div className="traffic-source-strip">
            {sourceStatus.map((item: any) => <span key={item.id} className={cx("status-pill", item.status === "connected" || item.status === "ok" ? "ok" : item.status === "failed" ? "warn" : "muted")}><i />{item.id}: {item.status}</span>)}
          </div>
        </Panel>

        <Panel className="traffic-table-panel">
          <PanelTitle icon={Activity} title="Boundary flow list" subtitle={`${flows.length}  flows; use the direction filters to narrow them quickly.`} action={<div className="segmented"><button className={direction === "all" ? "active" : ""} onClick={() => setDirection("all")}>All</button><button className={direction === "ingress" ? "active" : ""} onClick={() => setDirection("ingress")}>Ingress</button><button className={direction === "egress" ? "active" : ""} onClick={() => setDirection("egress")}>Egress</button><button className={direction === "cross_cluster" ? "active" : ""} onClick={() => setDirection("cross_cluster")}>Cross-cluster</button></div>} />
          {traffic.loading ? <EmptyState text="Analyzing Pods, Services, Ingresses, Endpoints, CMDB data, and optional traffic observations..." /> : flows.length ? (
            <div className="traffic-flow-list">
              {flows.map((flow: any) => <article className={cx("traffic-flow-card", flow.direction)} key={flow.id}>
                <header>
                  <span>{flowDirectionLabel(flow.direction)}</span>
                  <strong>{flowEndpointLabel(flow.source)} <ChevronRight size={13} /> {flowEndpointLabel(flow.destination)}</strong>
                  <em>{Math.round(Number(flow.confidence || 0) * 100)}%</em>
                </header>
                <div className="traffic-flow-meta">
                  <span>{flow.source?.cluster || "-"} / {flow.source?.namespace || "-"}</span>
                  <span>{flow.protocol || "unknown"} {flow.port ? `:${flow.port}` : ""}</span>
                  <span>{flow.observed ? "Observed" : "Configuration inference"} · {flow.source_system}</span>
                  {(flow.bytes || flow.rps) && <span>{flow.bytes ? `${prettyNumber(flow.bytes)} bytes` : ""} {flow.rps ? `${prettyNumber(flow.rps)} rps` : ""}</span>}
                </div>
                <details>
                  <summary>View evidence</summary>
                  <div>{asList(flow.evidence).map((item: string, index: number) => <p key={`${flow.id}-${index}`}>{item}</p>)}</div>
                </details>
              </article>)}
            </div>
          ) : <EmptyState text="No external or cross-cluster data flows were found in the current scope. To view real traffic, connect Hubble, Kiali, or your in-house Flow Observation system. " />}
        </Panel>
      </div>

      <Panel className="traffic-graph-facts">
        <PanelTitle icon={GitBranch} title="Graph facts" subtitle="Reused by topology impact, blast radius, and subsequent AI SRE root-cause analysis." />
        <div className="traffic-fact-grid">
          <Metric title="Graph nodes" value={asList(graph.nodes).length} />
          <Metric title="Graph edges" value={asList(graph.edges).length} />
          <Metric title="External endpoints" value={summary.external_endpoints || 0} />
          <Metric title="Data sources" value={asList(traffic.data?.data_sources).join(" / ") || "-"} />
        </div>
      </Panel>
    </section>
  );
}

function ExternalTrafficEmbedded({ cluster, namespace, workload = "" }: { cluster: string; namespace: string; workload?: string }) {
  const [windowSize, setWindowSize] = useState("30m");
  const [source, setSource] = useState("auto");
  const [direction, setDirection] = useState("all");
  const [traffic, setTraffic] = useState<ApiState<any>>({ loading: false });

  const flows = useMemo(() => {
    const rows = asList(traffic.data?.flows);
    return direction === "all" ? rows : rows.filter((flow: any) => flow.direction === direction);
  }, [traffic.data, direction]);

  async function runTraffic() {
    setTraffic({ loading: true });
    try {
      const data = await apiPost("/api/network/external-flows", {
        cluster: cluster === "all" ? "all" : cluster,
        cluster_id: cluster === "all" ? "" : cluster,
        namespace,
        workload,
        window: windowSize,
        source,
        include_static_inference: true,
        include_cmdb: true,
      });
      setTraffic({ loading: false, data });
    } catch (error: any) {
      setTraffic({ loading: false, error: error.message });
    }
  }

  const summary = traffic.data?.summary || {};
  return (
    <div className="topology-traffic-embed">
      <div className="topology-traffic-head">
        <div>
          <span><Cable size={13} />External Data Flows</span>
          <strong>Cluster boundary and cross-cluster data flows</strong>
          <p>Aggregates only inbound, outbound, and cross-cluster relationships to help impact analysis determine whether a failure will propagate.</p>
        </div>
        <button className="ghost tiny" onClick={runTraffic} disabled={traffic.loading}>
          {traffic.loading ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
          Analyze boundary flows
        </button>
      </div>
      <div className="topology-traffic-controls">
        <select value={windowSize} onChange={(e) => setWindowSize(e.target.value)}>
          <option value="15m">15 minutes</option>
          <option value="30m">30 minutes</option>
          <option value="1h">1 hour</option>
          <option value="6h">6 hours</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="auto">Auto evidence</option>
          <option value="observed">Prefer observed</option>
          <option value="static">Configuration inference</option>
        </select>
        <div className="segmented compact">
          <button className={direction === "all" ? "active" : ""} onClick={() => setDirection("all")}>All</button>
          <button className={direction === "ingress" ? "active" : ""} onClick={() => setDirection("ingress")}>Ingress</button>
          <button className={direction === "egress" ? "active" : ""} onClick={() => setDirection("egress")}>Egress</button>
          <button className={direction === "cross_cluster" ? "active" : ""} onClick={() => setDirection("cross_cluster")}>Cross-cluster</button>
        </div>
      </div>
      <div className="topology-traffic-kpis">
        <Metric title="Boundary flows" value={traffic.loading ? "..." : summary.total || 0} />
        <Metric title="Ingress" value={summary.ingress || 0} />
        <Metric title="Egress" value={summary.egress || 0} />
        <Metric title="Cross-cluster" value={summary.cross_cluster || 0} />
        <Metric title="Observed" value={summary.observed || 0} tone={summary.observed ? "good" : undefined} />
      </div>
      {traffic.error && <div className="error-box">{traffic.error}</div>}
      {traffic.loading ? (
        <div className="topology-flow-empty">Aggregating Service, Ingress, Endpoint, CMDB, and observability traffic...</div>
      ) : flows.length ? (
        <div className="topology-flow-strip">
          {flows.slice(0, 6).map((flow: any) => (
            <article className={cx("topology-flow-card", flow.direction)} key={flow.id}>
              <span>{flowDirectionLabel(flow.direction)}</span>
              <strong>{flowEndpointLabel(flow.source)} <ChevronRight size={12} /> {flowEndpointLabel(flow.destination)}</strong>
              <small>{flow.observed ? "Observed" : "Configuration inference"} · {Math.round(Number(flow.confidence || 0) * 100)}%</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="topology-flow-empty">Click "Analyze boundary flows" to show external and cross-cluster data flows within this topology scope.</div>
      )}
    </div>
  );
}

function TrafficFlow3DPanel({ cluster, namespace, workload }: { cluster: string; namespace: string; workload: string }) {
  const [windowSize, setWindowSize] = useState("30m");
  const [source, setSource] = useState("auto");
  const [direction, setDirection] = useState("all");
  const [traffic, setTraffic] = useState<ApiState<any>>({ loading: false });

  const flows = useMemo(() => {
    const rows = asList(traffic.data?.flows);
    return direction === "all" ? rows : rows.filter((flow: any) => flow.direction === direction);
  }, [traffic.data, direction]);

  async function runTraffic() {
    setTraffic({ loading: true });
    try {
      const data = await apiPost("/api/network/external-flows", {
        cluster: cluster === "all" ? "all" : cluster,
        cluster_id: cluster === "all" ? "" : cluster,
        namespace,
        workload,
        window: windowSize,
        source,
        include_static_inference: true,
        include_cmdb: true,
      });
      setTraffic({ loading: false, data });
    } catch (error: any) {
      setTraffic({ loading: false, error: error.message });
    }
  }

  useEffect(() => {
    runTraffic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, namespace, workload]);

  const summary = traffic.data?.summary || {};
  const sourceStatus = asList(traffic.data?.data_source_status);
  return (
    <div className="flow-module">
      <div className="flow-module-head">
        <div>
          <span><Cable size={14} />eBPF Data Flows</span>
          <strong>{workload ? `Only show boundary flows for ${workload}` : "Cluster boundary ingress/egress/cross-cluster flows"}</strong>
          <p>Prefer real observations from eBPF / Hubble / Calico Flow / Beyla; fall back to CMDB and Kubernetes configuration inference when unavailable.</p>
        </div>
        <div className="flow-controls">
          <select value={windowSize} onChange={(event) => setWindowSize(event.target.value)}>
            <option value="15m">15 minutes</option>
            <option value="30m">30 minutes</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
          </select>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="auto">Auto evidence</option>
            <option value="observed">Prefer observed</option>
            <option value="static">Configuration inference</option>
          </select>
          <button className="primary tiny" onClick={runTraffic} disabled={traffic.loading}>
            {traffic.loading ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
            Reanalyze
          </button>
        </div>
      </div>
      <div className="flow-source-strip">
        {sourceStatus.map((item: any) => (
          <span key={item.id} className={cx("status-pill", item.status === "connected" || item.status === "ok" ? "ok" : item.status === "failed" ? "warn" : "muted")}>
            <i />{item.id}: {item.status}{typeof item.flows === "number" ? ` · ${item.flows}  flows` : ""}
          </span>
        ))}
      </div>
      <div className="flow-kpi-row">
        <Metric title="Boundary flows" value={traffic.loading ? "..." : summary.total || 0} />
        <Metric title="eBPF Observed" value={summary.ebpf_observed || 0} tone={summary.ebpf_observed ? "good" : undefined} />
        <Metric title="Ingress" value={summary.ingress || 0} />
        <Metric title="Egress" value={summary.egress || 0} />
        <Metric title="Cross-cluster" value={summary.cross_cluster || 0} />
        <Metric title="External endpoints" value={summary.external_endpoints || 0} />
      </div>
      {traffic.error && <div className="error-box">{traffic.error}</div>}
      <div className="flow-module-grid">
        <div className="flow-3d-shell">
          {traffic.loading ? (
            <EmptyState text="Reading eBPF, CMDB, Service, Ingress, and Endpoint evidence..." />
          ) : flows.length ? (
            <TrafficFlowCanvas graph={traffic.data?.graph || { nodes: [], edges: [] }} flows={flows} />
          ) : (
            <EmptyState text="No boundary data flows found in the current scope. To see real byte-level traffic, make sure the eBPF Collector is writing to Loki/Flow API." />
          )}
        </div>
        <div className="flow-trace-panel">
          <div className="segmented compact">
            <button className={direction === "all" ? "active" : ""} onClick={() => setDirection("all")}>All</button>
            <button className={direction === "ingress" ? "active" : ""} onClick={() => setDirection("ingress")}>Ingress</button>
            <button className={direction === "egress" ? "active" : ""} onClick={() => setDirection("egress")}>Egress</button>
            <button className={direction === "cross_cluster" ? "active" : ""} onClick={() => setDirection("cross_cluster")}>Cross-cluster</button>
          </div>
          <div className="flow-trace-list">
            {flows.slice(0, 18).map((flow: any) => (
              <article className={cx("flow-trace-card", flow.direction)} key={flow.id}>
                <header>
                  <span>{flowDirectionLabel(flow.direction)}</span>
                  <b>{flow.observed ? "Observed" : "Configuration inference"}</b>
                </header>
                <strong>{flowEndpointLabel(flow.source)} <ChevronRight size={13} /> {flowEndpointLabel(flow.destination)}</strong>
                <p>{flow.source?.cluster || "-"} / {flow.source?.namespace || "-"} · {flow.protocol || "unknown"} {flow.port ? `:${flow.port}` : ""} · {flow.source_system}</p>
                <details>
                  <summary>Trace evidence</summary>
                  {asList(flow.evidence).map((item: string, index: number) => <small key={`${flow.id}-${index}`}>{item}</small>)}
                </details>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrafficFlowCanvas({ graph, flows }: { graph: any; flows: any[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasError, setCanvasError] = useState("");

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return cleanup;
    setCanvasError("");

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;

      const nodes = asList(graph?.nodes);
      const edges = asList(graph?.edges);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x03101b);
      scene.fog = new THREE.FogExp2(0x03101b, 0.0011);
      const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2200);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 80;
      controls.maxDistance = 680;
      camera.position.set(0, 105, 320);
      controls.target.set(0, 0, 0);

      scene.add(new THREE.AmbientLight(0xc9e7ff, 0.7));
      const key = new THREE.DirectionalLight(0x8ed8ff, 1.15);
      key.position.set(120, 140, 160);
      scene.add(key);
      scene.add(new THREE.PointLight(0x31e6ff, 1.1, 360));

      const nodeMeshes = new Map<string, any>();
      const nodeById = new Map(nodes.map((node: any) => [String(node.id), node]));
      const total = Math.max(nodes.length, 1);
      const ringRadius = Math.min(170, Math.max(92, 36 + Math.sqrt(total) * 28));
      nodes.forEach((node: any, index: number) => {
        const external = Boolean(node.external) || /external|domain|ip/.test(String(node.type || "").toLowerCase());
        const angle = (index / total) * Math.PI * 2;
        const layer = external ? 1 : 0;
        const radius = ringRadius * (external ? 1.12 : 0.58);
        const y = external ? 18 * Math.sin(angle * 1.7) : -22 + 28 * Math.sin(angle * 1.3);
        const position = new THREE.Vector3(Math.cos(angle) * radius, y + layer * 12, Math.sin(angle) * radius);
        const material = new THREE.MeshStandardMaterial({
          color: external ? 0xffd36a : /service/.test(String(node.type || "")) ? 0x55d7ff : 0x75e6a8,
          emissive: external ? 0x6b3a00 : 0x06321f,
          emissiveIntensity: 0.45,
          metalness: 0.24,
          roughness: 0.36,
        });
        const geometry = external ? new THREE.OctahedronGeometry(6.8, 0) : new THREE.SphereGeometry(5.8, 22, 14);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        scene.add(mesh);
        nodeMeshes.set(String(node.id), mesh);
        const label = makeLabelSprite(THREE, String(node.title || node.name || node.id).slice(0, 36), external ? "#ffe5a8" : "#d8f7ff");
        label.position.copy(position.clone().add(new THREE.Vector3(0, 12, 0)));
        label.scale.set(external ? 36 : 30, external ? 10 : 8.4, 1);
        scene.add(label);
      });

      const flowGeometry = new THREE.SphereGeometry(1.2, 12, 10);
      const edgeObjects = edges.map((edge: any, index: number) => {
        const observedFlow = flows.find((flow: any) => flow.id === edge.id);
        const observed = Boolean(observedFlow?.observed);
        const direction = String(edge.direction || observedFlow?.direction || "");
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({
            color: observed ? 0x31f3ff : direction === "ingress" ? 0x8bffb3 : direction === "cross_cluster" ? 0xffd86a : 0x66a3ff,
            transparent: true,
            opacity: observed ? 0.86 : 0.46,
          })
        );
        scene.add(line);
        const particle = new THREE.Mesh(
          flowGeometry,
          new THREE.MeshBasicMaterial({ color: observed ? 0xffffff : 0x9fd8ff, transparent: true, opacity: 0.94 })
        );
        scene.add(particle);
        return { edge, line, particle, phase: (index * 0.19) % 1, observed };
      });

      const curveFor = (source: any, target: any) => {
        const midpoint = source.position.clone().add(target.position).multiplyScalar(0.5);
        midpoint.y += 35 + source.position.distanceTo(target.position) * 0.08;
        return new THREE.QuadraticBezierCurve3(source.position.clone(), midpoint, target.position.clone());
      };

      const resize = () => {
        const rect = host.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(host);
      resize();

      const animate = () => {
        controls.update();
        const elapsed = performance.now() * 0.00018;
        edgeObjects.forEach(({ edge, line, particle, phase, observed }) => {
          const source = nodeMeshes.get(String(edge.source));
          const target = nodeMeshes.get(String(edge.target));
          if (!source || !target) return;
          const curve = curveFor(source, target);
          line.geometry.setFromPoints(curve.getPoints(24));
          line.geometry.attributes.position.needsUpdate = true;
          particle.position.copy(curve.getPoint((elapsed * (observed ? 2.05 : 1.2) + phase) % 1));
        });
        nodeMeshes.forEach((mesh, id) => {
          const node = nodeById.get(id);
          const pulse = /external/.test(String(node?.type || "")) ? 0.04 : 0.025;
          const scale = 1 + Math.sin(performance.now() * 0.002 + id.length) * pulse;
          mesh.scale.setScalar(scale);
        });
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      animate();

      cleanup = () => {
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        scene.traverse((obj: any) => {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
          else obj.material?.dispose?.();
        });
      };
    })().catch((error) => {
      if (!disposed) setCanvasError(`3D data flow initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanup();
    };
  }, [graph, flows]);

  return <div className="flow-3d-wrap">
    <canvas ref={canvasRef} className="flow-3d-canvas" />
    {canvasError && <div className="topology-canvas-error">{canvasError}</div>}
  </div>;
}

type TopologyNode = {
  id: string;
  name: string;
  title: string;
  type: string;
  kind: string;
  cluster: string;
  namespace: string;
  risk?: string;
  raw: any;
};

type TopologyEdge = {
  source: string;
  target: string;
  type: string;
  traffic?: string;
  raw: any;
};

function normalizeTopologyGraph(data: any): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const rawNodes = asList(data?.nodes);
  const nodes = rawNodes.map((n: any, index: number) => {
    const id = String(n.id || n.name || n.title || `node-${index}`);
    const name = String(n.name || n.title || id);
    const phase = String(n.phase || n.status?.phase || n.status || "").toLowerCase();
    const completed = phase === "succeeded" || phase === "completed";
    return {
      id,
      name,
      title: String(n.title || name),
      type: String(n.type || n.category || n.kind || "node").toLowerCase(),
      kind: String(n.kind || n.type || ""),
      cluster: String(n.cluster || n.cluster_name || n.cluster_id || n.meta?.cluster || n.raw?.cluster || "local-cluster"),
      namespace: String(n.namespace || n.ns || n.meta?.namespace || n.raw?.namespace || ""),
      risk: completed ? "normal" : (n.risk || (typeof n.status === "string" ? n.status : n.health) || "normal"),
      raw: n,
    };
  });
  const known = new Set(nodes.map((n) => n.id));
  const edges = asList(data?.edges).map((e: any) => ({
    source: String(e.source || e.from || e.src || e.caller || ""),
    target: String(e.target || e.to || e.dst || e.callee || ""),
    type: String(e.type || e.protocol || "dependency"),
    traffic: e.traffic || e.qps || e.weight || "",
    raw: e,
  })).filter((e) => known.has(e.source) && known.has(e.target));
  return { nodes, edges };
}

function TopologyPage() {
  const [topology, refreshTopology] = useAsync<any>(() => apiGet("/api/cmdb/topology"), []);
  const graph = useMemo(() => normalizeTopologyGraph(topology.data), [topology.data]);
  const clusters = useMemo(() => ["all", ...Array.from(new Set(graph.nodes.map((n) => n.cluster))).filter(Boolean)], [graph.nodes]);
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [module, setModule] = useState<"relation" | "flow">("relation");
  const [workloadFilter, setWorkloadFilter] = useState("");
  const [view, setView] = useState<"2d" | "3d">(() => (localStorage.getItem("luxyai-topology-view") as "2d" | "3d") || "2d");
  const [selectedId, setSelectedId] = useState("");
  const [analysis, setAnalysis] = useState<ApiState<any>>({ loading: false });
  const canvasApiRef = useRef<{ reset: () => void; zoom: (factor: number) => void } | null>(null);
  const namespaces = useMemo(() => {
    const scoped = cluster === "all" ? graph.nodes : graph.nodes.filter((n) => n.cluster === cluster);
    return ["all", ...Array.from(new Set(scoped.map((n) => n.namespace).filter(Boolean))).sort()];
  }, [cluster, graph.nodes]);
  const workloadOptions = useMemo(() => {
    const scoped = graph.nodes.filter((node) => {
      const clusterOk = cluster === "all" || node.cluster === cluster;
      const namespaceOk = namespace === "all" || node.namespace === namespace || !node.namespace;
      const text = `${node.type} ${node.kind} ${node.name} ${node.title}`.toLowerCase();
      const useful = /deployment|statefulset|daemonset|workload|pod|service|kafka|redis|mysql|elastic|topic|queue/.test(text);
      return clusterOk && namespaceOk && useful;
    });
    const seen = new Set<string>();
    return scoped.map((node) => ({
      id: node.id,
      value: node.name,
      label: `${node.kind || node.type || "Node"}/${node.name}`,
    })).filter((item) => {
      const key = item.value.toLowerCase();
      if (!item.value || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.label.localeCompare(b.label));
  }, [cluster, namespace, graph.nodes]);

  const visibleGraph = useMemo(() => {
    const clusterNodes = cluster === "all" ? graph.nodes : graph.nodes.filter((n) => n.cluster === cluster);
    const namespaceOwned = new Set(clusterNodes.filter((n) => namespace === "all" || n.namespace === namespace).map((n) => n.id));
    const directlyConnected = new Set<string>();
    graph.edges.forEach((edge) => {
      if (namespaceOwned.has(edge.source)) directlyConnected.add(edge.target);
      if (namespaceOwned.has(edge.target)) directlyConnected.add(edge.source);
    });
    const nodes = namespace === "all"
      ? clusterNodes
      : clusterNodes.filter((n) => namespaceOwned.has(n.id) || (!n.namespace && directlyConnected.has(n.id)));
    const ids = new Set(nodes.map((n) => n.id));
    let scopedEdges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (workloadFilter) {
      const wanted = workloadFilter.toLowerCase();
      const seedIds = new Set(nodes.filter((node) => {
        const text = `${node.name} ${node.title} ${node.kind}/${node.name}`.toLowerCase();
        return text.includes(wanted);
      }).map((node) => node.id));
      const related = new Set(seedIds);
      let changed = true;
      while (changed) {
        changed = false;
        scopedEdges.forEach((edge) => {
          if (related.has(edge.source) && !related.has(edge.target)) {
            related.add(edge.target);
            changed = true;
          }
          if (related.has(edge.target) && !related.has(edge.source)) {
            related.add(edge.source);
            changed = true;
          }
        });
      }
      const filteredNodes = nodes.filter((node) => related.has(node.id));
      const filteredIds = new Set(filteredNodes.map((node) => node.id));
      return { nodes: filteredNodes, edges: scopedEdges.filter((edge) => filteredIds.has(edge.source) && filteredIds.has(edge.target)) };
    }
    return { nodes, edges: scopedEdges };
  }, [cluster, namespace, workloadFilter, graph]);
  const selected = visibleGraph.nodes.find((n) => n.id === selectedId) || visibleGraph.nodes[0];

  useEffect(() => {
    localStorage.setItem("luxyai-topology-view", view);
    requestAnimationFrame(() => canvasApiRef.current?.reset());
  }, [view]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!visibleGraph.nodes.length) setSelectedId("");
  }, [selected?.id, selectedId, visibleGraph.nodes.length]);

  useEffect(() => {
    if (!namespaces.includes(namespace)) setNamespace("all");
  }, [namespace, namespaces]);

  async function analyzeSelected() {
    if (!selected) return;
    setAnalysis({ loading: true });
    try {
      const data = await apiPost("/api/topology/impact", {
        selected: selected.raw || selected,
        graph: { nodes: visibleGraph.nodes.map((n) => n.raw || n), edges: visibleGraph.edges.map((e) => e.raw || e) },
        scenario: selected.type === "pod" ? "single_pod_change" : "topology_change",
      });
      setAnalysis({ loading: false, data });
    } catch (error: any) {
      setAnalysis({ loading: false, error: error.message });
    }
  }

  const policy = analysis.data?.policy || {};
  const blast = policy.blast_radius || {};
  return (
    <section className="topology-modern">
      <Panel className="topology-map">
        <PanelTitle
          icon={GitBranch}
          title={view === "2d" ? "Directed Dependency Topology" : "3D Cluster World"}
          subtitle="Nodes and edges come strictly from the same CMDB dataset"
          action={<button className="ghost" onClick={refreshTopology}><RefreshCcw size={15} />Refresh</button>}
        />
        <div className="topology-tools">
          <div className="segmented topology-view-switch">
            <button className={view === "2d" ? "active" : ""} onClick={() => setView("2d")}><Workflow size={14} />Dependency Graph</button>
            <button className={view === "3d" ? "active" : ""} onClick={() => setView("3d")}><Network size={14} />3D World</button>
          </div>
          <div className="segmented topology-module-switch">
            <button className={module === "relation" ? "active" : ""} onClick={() => setModule("relation")}><GitBranch size={14} />Relation Module</button>
            <button className={module === "flow" ? "active" : ""} onClick={() => setModule("flow")}><Cable size={14} />Data Flow Module</button>
          </div>
          <select value={cluster} onChange={(e) => { setCluster(e.target.value); setNamespace("all"); setWorkloadFilter(""); }}>
            {clusters.map((item) => <option value={item} key={item}>{item === "all" ? "All clusters" : item}</option>)}
          </select>
          <select value={namespace} onChange={(e) => { setNamespace(e.target.value); setWorkloadFilter(""); }}>
            {namespaces.map((item) => <option value={item} key={item}>{item === "all" ? "All namespaces" : item}</option>)}
          </select>
          <select value={workloadFilter} onChange={(e) => setWorkloadFilter(e.target.value)}>
            <option value="">All Workloads / Endpoints</option>
            {workloadOptions.map((item) => <option value={item.value} key={item.id}>{item.label}</option>)}
          </select>
          {module === "relation" && <>
            <button className="ghost tiny" onClick={() => canvasApiRef.current?.zoom(0.82)}><ZoomIn size={14} />Zoom in</button>
            <button className="ghost tiny" onClick={() => canvasApiRef.current?.zoom(1.18)}><ZoomOut size={14} />Zoom out</button>
            <button className="ghost tiny" onClick={() => canvasApiRef.current?.reset()}><RefreshCcw size={14} />Reset</button>
          </>}
          <div className="topology-legend-inline"><span className="workload">Workload</span><span className="pod">Pod</span><span className="service">Service</span><span className="data">Data</span><span className="risk">Risk</span></div>
        </div>
        {module === "relation" ? (
          <>
            <div className={cx("topology-stage", view === "2d" && "mode-2d")}>
              {visibleGraph.nodes.length ? (
                view === "2d" ? <Topology2D nodes={visibleGraph.nodes} edges={visibleGraph.edges} selectedId={selected?.id || ""} onSelect={setSelectedId} apiRef={canvasApiRef} /> :
                  <TopologyCanvas nodes={visibleGraph.nodes} edges={visibleGraph.edges} selectedId={selected?.id || ""} onSelect={setSelectedId} apiRef={canvasApiRef} />
              ) : (
                <EmptyState text={topology.error || topology.data?.message || "CMDB did not return any topology nodes. Please verify that CMDB is connected to Rancher/Service/Kafka/ELK data."} />
              )}
            </div>
            <ExternalTrafficEmbedded cluster={cluster} namespace={namespace} workload={workloadFilter} />
          </>
        ) : (
          <TrafficFlow3DPanel cluster={cluster} namespace={namespace} workload={workloadFilter} />
        )}
      </Panel>
      <Panel className="topology-insight">
        <PanelTitle icon={BrainCircuit} title="AI Impact Analysis" action={<button className="primary" onClick={analyzeSelected} disabled={!selected || analysis.loading}>{analysis.loading ? <Loader2 className="spin" size={15} /> : <Play size={15} />}Analyze</button>} />
        <div className="insight-stack">
          <Metric title="Topology nodes" value={visibleGraph.nodes.length} />
          <Metric title="Edges" value={visibleGraph.edges.length} />
          <Metric title="CMDB status" value={topology.data?.status || "unknown"} />
        </div>
        {selected && (
          <div className="analysis-card selected-node">
            <span>{selected.type || "node"} · {selected.cluster}</span>
            <strong>{selected.title}</strong>
            <p>{selected.namespace || "global"} · Risk status {selected.risk || "normal"}</p>
          </div>
        )}
        {analysis.error && <div className="error-box">{analysis.error}</div>}
        {analysis.data ? (
          <div className="analysis-card">
            <div className="score-grid">
              <span>Level {policy.impact_level || "-"}</span>
              <span>score {policy.impact_score ?? "-"}</span>
              <span>Amp {policy.amplification_factor ?? "-"}</span>
              <span>Paths {asList(blast.critical_paths).length}</span>
            </div>
            <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownish(analysis.data.analysis || "No analysis results yet.") }} />
          </div>
        ) : (
          <div className="analysis-card">
            <strong>Select a node to start analysis</strong>
            <p>The system will calculate upstreams, downstreams, critical paths, and change risk.</p>
          </div>
        )}
      </Panel>
    </section>
  );
}

function TopologyCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  apiRef,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedId: string;
  onSelect: (id: string) => void;
  apiRef: React.MutableRefObject<{ reset: () => void; zoom: (factor: number) => void } | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedIdRef = useRef(selectedId);
  const [canvasError, setCanvasError] = useState("");

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let cleanup = () => {};
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return cleanup;
    setCanvasError("");

    (async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      if (disposed) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x020611);
      scene.fog = new THREE.FogExp2(0x020611, 0.00036);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 7200);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 42;
      controls.maxDistance = 1800;
      controls.target.set(0, 0, 0);

      scene.add(new THREE.AmbientLight(0xb9d7ff, 0.64));
      const key = new THREE.DirectionalLight(0x9ecbff, 1.28);
      key.position.set(60, 80, 90);
      scene.add(key);
      const fill = new THREE.PointLight(0x4de1ff, 1.22, 210);
      fill.position.set(-40, -20, 50);
      scene.add(fill);

      // A deterministic star field gives depth without introducing a decorative foreground object.
      const starPositions: number[] = [];
      let starSeed = 94731;
      const seeded = () => {
        starSeed = (starSeed * 16807) % 2147483647;
        return (starSeed - 1) / 2147483646;
      };
      for (let index = 0; index < 1800; index += 1) {
        starPositions.push((seeded() - 0.5) * 1800, (seeded() - 0.5) * 1100, (seeded() - 0.5) * 1200);
      }
      const starGeometry = new THREE.BufferGeometry();
      starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
      const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xb8d8ff, size: 0.72, transparent: true, opacity: 0.76, sizeAttenuation: true }));
      scene.add(starField);

      const clusters = Array.from(new Set(nodes.map((n) => n.cluster || "local-cluster")));
      const clusterNodes = new Map(clusters.map((name) => [name, nodes.filter((node) => node.cluster === name)]));
      const clusterCenters = new Map<string, any>();
      const hostRect = host.getBoundingClientRect();
      const hostWidth = Math.max(360, hostRect.width || 960);
      const hostHeight = Math.max(420, hostRect.height || 720);
      camera.aspect = hostWidth / hostHeight;
      const compactness = Math.max(0.76, Math.min(1.08, Math.min(hostWidth / 1120, hostHeight / 760)));
      const columns = Math.max(1, Math.ceil(Math.sqrt(clusters.length)));
      const rows = Math.max(1, Math.ceil(clusters.length / columns));
      const largestCluster = Math.max(...clusters.map((name) => clusterNodes.get(name)?.length || 1));
      const densityRadius = (58 + Math.sqrt(largestCluster) * 12) * compactness;
      const fitRadius = Math.min(hostWidth / (columns * 2.38), hostHeight / (rows * 2.28));
      const galaxyRadius = Math.max(62, Math.min(168, densityRadius, fitRadius));
      const clusterSpan = galaxyRadius * 2;
      const worldSpacingX = galaxyRadius * 2.38;
      const worldSpacingY = galaxyRadius * 2.28;
      const sceneWidth = Math.max(clusterSpan, (columns - 1) * worldSpacingX + clusterSpan);
      const sceneHeight = Math.max(clusterSpan, (rows - 1) * worldSpacingY + clusterSpan);
      const fitFov = THREE.MathUtils.degToRad(camera.fov);
      const cameraDistance = Math.max(280, Math.max(
        sceneHeight / (2 * Math.tan(fitFov / 2)),
        sceneWidth / (2 * Math.tan(fitFov / 2) * Math.max(0.45, camera.aspect)),
      ) * 1.18);
      controls.minDistance = Math.max(22, galaxyRadius * 0.36);
      controls.maxDistance = Math.max(1300, cameraDistance * 2.7);
      const initialCamera = new THREE.Vector3(sceneWidth * 0.08, sceneHeight * 0.18, cameraDistance);
      camera.position.copy(initialCamera);
      camera.far = Math.max(7200, cameraDistance * 4);
      camera.updateProjectionMatrix();

      const layerOf = (node: TopologyNode) => {
        const text = `${node.type} ${node.kind} ${node.name}`.toLowerCase();
        if (/cluster|namespace/.test(text)) return 0;
        if (/deployment|statefulset|daemonset|workload|replicaset|job|cronjob/.test(text)) return 1;
        if (/service|ingress|gateway|endpoint/.test(text)) return 2;
        if (/pod|container/.test(text)) return 3;
        if (/kafka|redis|mysql|elastic|postgres|data|storage|pvc|pv|topic|queue|middleware/.test(text)) return 4;
        if (/node|infra|host/.test(text)) return 5;
        return 2;
      };
      const shellRatio = (layer: number) => {
        const table: Record<number, number> = { 0: 0.08, 1: 0.34, 2: 0.50, 3: 0.69, 4: 0.84, 5: 0.98 };
        return table[layer] ?? 0.58;
      };
      const spherePoint = (index: number, count: number, radius: number, twist: number) => {
        if (count <= 1) return { x: 0, y: radius, z: 0 };
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const y = 1 - (index / (count - 1)) * 2;
        const radial = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = index * goldenAngle + twist;
        return {
          x: Math.cos(theta) * radial * radius,
          y: y * radius,
          z: Math.sin(theta) * radial * radius,
        };
      };
      const placement = new Map<string, { x: number; y: number; z: number }>();
      clusters.forEach((cluster) => {
        const members = clusterNodes.get(cluster) || [];
        const byLayer = new Map<number, TopologyNode[]>();
        members.forEach((node) => {
          const layer = layerOf(node);
          const bucket = byLayer.get(layer) || [];
          bucket.push(node);
          byLayer.set(layer, bucket);
        });
        Array.from(byLayer.entries()).forEach(([layer, layerNodes]) => {
          const baseRadius = Math.max(8, galaxyRadius * shellRatio(layer));
          const shellCapacity = Math.max(12, Math.floor((4 * Math.PI * baseRadius * baseRadius) / 900));
          layerNodes.forEach((node, index) => {
            if (layer === 0 && layerNodes.length <= 2) {
              placement.set(node.id, { x: 0, y: index * 12, z: 0 });
              return;
            }
            const shell = Math.floor(index / shellCapacity);
            const shellIndex = index % shellCapacity;
            const shellSize = Math.min(shellCapacity, layerNodes.length - shell * shellCapacity);
            placement.set(node.id, spherePoint(
              shellIndex,
              shellSize,
              Math.min(galaxyRadius * 0.98, baseRadius + shell * 18),
              layer * 0.71 + shell * 0.33,
            ));
          });
        });
      });

      const worlds: any[] = [];
      clusters.forEach((cluster, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const center = new THREE.Vector3((column - (columns - 1) / 2) * worldSpacingX, ((rows - 1) / 2 - row) * worldSpacingY, 0);
        clusterCenters.set(cluster, center);
        const galaxy = new THREE.Group();
        galaxy.position.copy(center);
        const boundary = new THREE.Mesh(
          new THREE.SphereGeometry(galaxyRadius * 1.04, 34, 24),
          new THREE.MeshBasicMaterial({ color: 0x3d8fbd, wireframe: true, transparent: true, opacity: 0.15 })
        );
        galaxy.add(boundary);
        [0.36, 0.52, 0.70, 0.86, 1.0].forEach((ratio, orbitIndex) => {
          const orbit = new THREE.Mesh(
            new THREE.TorusGeometry(galaxyRadius * ratio, 0.24, 6, 120),
            new THREE.MeshBasicMaterial({ color: orbitIndex === 2 ? 0x4d9acb : 0x285071, transparent: true, opacity: orbitIndex === 2 ? 0.26 : 0.14 })
          );
          orbit.rotation.set(orbitIndex * 0.47, orbitIndex * 0.63, orbitIndex * 0.29);
          galaxy.add(orbit);
        });
        scene.add(galaxy);
        const core = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(5.2, galaxyRadius * 0.055), 32, 22),
          new THREE.MeshStandardMaterial({ color: 0x7bc8ff, emissive: 0x168bff, emissiveIntensity: 1.4, roughness: 0.24, metalness: 0.1 })
        );
        core.position.copy(center);
        scene.add(core);
        const coreLight = new THREE.PointLight(index % 2 ? 0x59e1ff : 0x74a7ff, 1.6, galaxyRadius * 1.5);
        coreLight.position.copy(center);
        scene.add(coreLight);
        worlds.push({ boundary: galaxy, core, speed: 0.00012 + (index % 3) * 0.00004 });
        const label = makeLabelSprite(THREE, cluster, "#9bd7ff");
        label.position.copy(center.clone().add(new THREE.Vector3(0, galaxyRadius * 1.18, 0)));
        label.scale.set(40, 9, 1);
        scene.add(label);
      });

      const nodeMeshes = new Map<string, any>();
      const labelSprites = new Map<string, any>();
      const originalPositions = new Map<string, any>();
      const nodeClusterById = new Map(nodes.map((node) => [node.id, node.cluster]));
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      nodes.forEach((node) => {
        const center = clusterCenters.get(node.cluster) || new THREE.Vector3();
        const type = `${node.type} ${node.kind}`.toLowerCase();
        const placed = placement.get(node.id) || { x: 0, y: clusterSpan * 0.26, z: 0 };
        const position = center.clone().add(new THREE.Vector3(
          placed.x,
          placed.y,
          placed.z
        ));
        const size = node.type.includes("data") || node.name.toLowerCase().includes("kafka") ? 6.1 : node.type.includes("service") ? 4.9 : node.type.includes("pod") ? 3.65 : 4.75;
        const geometry = type.includes("pod")
          ? new THREE.SphereGeometry(size, 22, 14)
          : /deployment|statefulset|daemonset|workload/.test(type)
            ? new THREE.BoxGeometry(size * 2, size * 1.35, size * 1.7)
            : type.includes("service") || type.includes("ingress")
              ? new THREE.OctahedronGeometry(size, 0)
              : type.includes("data") || type.includes("kafka")
                ? new THREE.CylinderGeometry(size, size, size * 1.7, 18)
                : new THREE.IcosahedronGeometry(size, 0);
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: colorForNode(THREE, node),
            emissive: selectedId === node.id ? 0x33ddff : 0x071b33,
            emissiveIntensity: selectedId === node.id ? 0.78 : 0.28,
            metalness: 0.28,
            roughness: 0.38,
          })
        );
        mesh.position.copy(position);
        mesh.userData = { id: node.id };
        scene.add(mesh);
        nodeMeshes.set(node.id, mesh);
        originalPositions.set(node.id, position.clone());
        const label = makeLabelSprite(THREE, `${node.kind || node.type} · ${node.name}`, selectedId === node.id ? "#ffffff" : "#d7e7f8");
        label.position.copy(position.clone().add(new THREE.Vector3(0, size + 2.2, 0)));
        const labelScale = type.includes("pod") ? 18 : type.includes("service") ? 28 : 32;
        const showAllLabels = nodes.length <= 18;
        label.scale.set(labelScale, labelScale * 0.28, 1);
        label.visible = showAllLabels || !type.includes("pod") || selectedId === node.id || String(node.risk || "").toLowerCase().includes("high");
        scene.add(label);
        labelSprites.set(node.id, label);
      });

      const flowGeometry = new THREE.SphereGeometry(0.62, 12, 9);
      const edgeLines = edges.map((edge, index) => {
        const isDataFlow = /kafka|data|stream|log|elk/i.test(edge.type);
        const line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({
            color: isDataFlow ? 0xffcc66 : 0x49c6ff,
            transparent: true,
            opacity: isDataFlow ? 0.88 : 0.52,
          })
        );
        scene.add(line);
        const particle = new THREE.Mesh(
          flowGeometry,
          new THREE.MeshBasicMaterial({ color: isDataFlow ? 0xffd477 : 0x8ae8ff, transparent: true, opacity: 0.92 })
        );
        scene.add(particle);
        return { edge, line, particle, phase: (index * 0.173) % 1, isDataFlow };
      });

      const curveFor = (source: any, target: any) => {
        const midpoint = source.position.clone().add(target.position).multiplyScalar(0.5);
        const sourceCenter = clusterCenters.get(nodeClusterById.get(source.userData.id) || "") || new THREE.Vector3();
        const targetCenter = clusterCenters.get(nodeClusterById.get(target.userData.id) || "") || new THREE.Vector3();
        const sameWorld = sourceCenter.distanceTo(targetCenter) < 0.01;
        if (sameWorld) {
          const outward = midpoint.clone().sub(sourceCenter).normalize().multiplyScalar(13);
          midpoint.add(outward);
        } else {
          midpoint.y += 28 + source.position.distanceTo(target.position) * 0.07;
        }
        return new THREE.QuadraticBezierCurve3(source.position.clone(), midpoint, target.position.clone());
      };

      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const dragPlane = new THREE.Plane();
      const intersection = new THREE.Vector3();
      let dragged: any = null;

      const resize = () => {
        const rect = host.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        const responsiveDistance = cameraDistance * Math.max(1, 0.9 / camera.aspect);
        camera.position.z = responsiveDistance;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(host);
      resize();

      const setPointer = (event: PointerEvent) => {
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      };
      const onPointerDown = (event: PointerEvent) => {
        setPointer(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(Array.from(nodeMeshes.values()), false);
        if (!hits.length) return;
        dragged = hits[0].object;
        onSelect(String(dragged.userData.id));
        controls.enabled = false;
        dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).normalize(), dragged.position);
        canvas.setPointerCapture(event.pointerId);
      };
      const onPointerMove = (event: PointerEvent) => {
        if (!dragged) return;
        setPointer(event);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
          dragged.position.copy(intersection);
          const label = labelSprites.get(String(dragged.userData.id));
          if (label) label.position.copy(intersection.clone().add(new THREE.Vector3(0, 4, 0)));
        }
      };
      const onPointerUp = (event: PointerEvent) => {
        dragged = null;
        controls.enabled = true;
        try { canvas.releasePointerCapture(event.pointerId); } catch {}
      };
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerup", onPointerUp);
      canvas.addEventListener("pointerleave", onPointerUp);

      apiRef.current = {
        reset: () => {
          nodeMeshes.forEach((mesh, id) => {
            const pos = originalPositions.get(id);
            if (pos) mesh.position.copy(pos);
            const label = labelSprites.get(id);
            if (label && pos) label.position.copy(pos.clone().add(new THREE.Vector3(0, 4, 0)));
          });
          camera.position.set(initialCamera.x, initialCamera.y, cameraDistance * Math.max(1, 0.9 / camera.aspect));
          controls.target.set(0, 0, 0);
          controls.update();
        },
        zoom: (factor: number) => {
          camera.position.multiplyScalar(factor);
          camera.updateProjectionMatrix();
        },
      };

      const animate = () => {
        controls.update();
        starField.rotation.y += 0.000025;
        worlds.forEach(({ boundary, speed }) => {
          boundary.rotation.z += speed;
        });
        nodeMeshes.forEach((mesh, id) => {
          const active = selectedIdRef.current === id;
          mesh.material.emissive.setHex(active ? 0x33ddff : 0x071b33);
          mesh.material.emissiveIntensity = active ? 0.86 : 0.18;
          mesh.scale.lerp(new THREE.Vector3(active ? 1.28 : 1, active ? 1.28 : 1, active ? 1.28 : 1), 0.12);
          const label = labelSprites.get(id);
          const node = nodeById.get(id);
          const nodeType = `${node?.type || ""} ${node?.kind || ""}`.toLowerCase();
          if (label && nodeType.includes("pod")) {
            label.visible = nodes.length <= 18 || active || String(node?.risk || "").toLowerCase().includes("high");
          }
        });
        const elapsed = performance.now() * 0.00016;
        edgeLines.forEach(({ edge, line, particle, phase, isDataFlow }) => {
          const source = nodeMeshes.get(edge.source);
          const target = nodeMeshes.get(edge.target);
          if (source && target) {
            const curve = curveFor(source, target);
            line.geometry.setFromPoints(curve.getPoints(18));
            line.geometry.attributes.position.needsUpdate = true;
            particle.position.copy(curve.getPoint((elapsed * (isDataFlow ? 1.55 : 1) + phase) % 1));
          }
        });
        renderer.render(scene, camera);
        frame = requestAnimationFrame(animate);
      };
      animate();

      cleanup = () => {
        ro.disconnect();
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", onPointerUp);
        canvas.removeEventListener("pointerleave", onPointerUp);
        controls.dispose();
        renderer.dispose();
        scene.traverse((obj: any) => {
          obj.geometry?.dispose?.();
          if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose?.());
          else obj.material?.dispose?.();
        });
      };
    })().catch((error) => {
      if (!disposed) setCanvasError(`3D topology initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanup();
      apiRef.current = null;
    };
  }, [apiRef, edges, nodes, onSelect]);

  return <div className="topology-canvas-wrap">
    <canvas className="topology-canvas" ref={canvasRef} />
    {canvasError && <div className="topology-canvas-error">{canvasError}</div>}
  </div>;
}

function colorForNode(THREE: any, node: TopologyNode) {
  const text = `${node.type} ${node.name} ${node.kind}`.toLowerCase();
  if (String(node.risk || "").toLowerCase().includes("high")) return new THREE.Color(0xff5d73);
  if (text.includes("kafka") || text.includes("data") || text.includes("redis") || text.includes("mysql") || text.includes("elastic")) return new THREE.Color(0xffcc66);
  if (text.includes("service") || text.includes("svc")) return new THREE.Color(0x55d7ff);
  if (text.includes("pod")) return new THREE.Color(0x69e6a3);
  if (text.includes("infra") || text.includes("node")) return new THREE.Color(0xb59cff);
  return new THREE.Color(0x77a7ff);
}

function makeLabelSprite(THREE: any, label: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 176;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "700 54px Inter, Segoe UI, Microsoft YaHei, Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(3, 12, 28, 0.92)";
  roundRect(ctx, 18, 38, 732, 100, 22);
  ctx.fill();
  ctx.strokeStyle = "rgba(116, 199, 255, 0.55)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  const text = label.length > 22 ? `${label.slice(0, 20)}...` : label;
  ctx.fillText(text, 384, 88);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(24, 5.5, 1);
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ReleaseJobTracker({ initial }: { initial: any }) {
  const [job, setJob] = useState(initial);
  const active = ["queued", "running", "cancelling"].includes(String(job?.status || ""));
  useEffect(() => {
    if (!active || !job?.id) return;
    const timer = window.setTimeout(async () => {
      try { setJob(await apiGet(`/api/ops/jobs/${encodeURIComponent(job.id)}`)); } catch { /* next refresh can retry */ }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [active, job?.id, job?.updated_at, job?.events?.length]);
  return <OpsJobProgress job={job} compact onCancel={active ? async () => setJob(await apiPost(`/api/ops/jobs/${encodeURIComponent(job.id)}/cancel`, {})) : undefined} />;
}

function ReleaseReportPanel({ report }: { report: any }) {
  if (!report) return null;
  const shortRisks = asList(report.short_term_risks);
  const longRisks = asList(report.long_term_risks);
  const recommendations = asList(report.recommendations);
  const evidence = asList(report.evidence);
  return <div className="release-report">
    <div className="release-report-head">
      <ShieldCheck size={15} />
      <div><strong>{report.headline || "Release Risk Summary"}</strong><span>{report.risk_decision || "Requires human review before execution."}</span></div>
    </div>
    <div className="release-report-grid">
      <section><b>Allowed canary scope</b><p>{report.allowed_scope || "No canary recommendation generated."}</p></section>
      <section><b>Blast radius</b><p>{report.blast_radius || "Topology evidence is insufficient; add CMDB/distributed tracing data first."}</p></section>
      <section><b>Image check</b><p>{report.image_check || "No image changes found."}</p></section>
    </div>
    <div className="release-report-columns">
      <section><b>Short-term risks</b>{shortRisks.slice(0, 3).map((item: any) => <p key={item}>{item}</p>)}</section>
      <section><b>Long-term risks</b>{longRisks.slice(0, 3).map((item: any) => <p key={item}>{item}</p>)}</section>
      <section><b>Change recommendations</b>{recommendations.slice(0, 4).map((item: any) => <p key={item}>{item}</p>)}</section>
      <section><b>Basis for decision</b>{evidence.slice(0, 5).map((item: any) => <p key={item}>{item}</p>)}</section>
    </div>
  </div>;
}

function ReliabilityPage() {
  const [summary, refreshSummary] = useAsync<any>(() => apiGet("/api/reliability/summary"), []);
  const [releaseState, refreshReleases] = useAsync<any>(() => apiGet("/api/releases"), []);
  const [inventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [], inventory: [] })), []);
  const [objective, setObjective] = useState({ service: "", target_percent: "99.9", window_days: "30", observed_availability_percent: "100", observed_minutes: "43200", downtime_minutes: "0" });
  const [release, setRelease] = useState({ release_mode: "existing", change_channel: "standard", emergency_action: "rollback", emergency_reason: "", service: "", cluster: "local", namespace: "default", workload_kind: "Deployment", workload_name: "", container_name: "app", image: "", change_summary: "", manifest_yaml: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobs, setJobs] = useState<Record<string, any>>({});
  const objectives = asList(summary.data?.objectives);
  const auditStorage = summary.data?.audit_storage || {};
  const releases = asList(releaseState.data?.releases);
  const clusters = asList(inventory.data?.clusters);
  const scopedInventory = asList(inventory.data?.inventory).filter((item: any) => !release.cluster || release.cluster === item.cluster?.id || release.cluster === item.cluster?.name);
  const namespaces = Array.from(new Set(scopedInventory.flatMap((item: any) => asList(item.namespaces).map((entry: any) => String(entry.name))))).sort();
  const workloads = scopedInventory.flatMap((item: any) => asList(item.workloads)).filter((item: any) => !release.namespace || item.namespace === release.namespace);

  function generateManifest() {
    const name = release.workload_name || "new-application";
    const namespace = release.namespace || "default";
    const image = release.image || "registry.example.com/application:v1.0.0";
    const kind = release.workload_kind || "Deployment";
    setRelease((current) => ({ ...current, manifest_yaml: `apiVersion: apps/v1\nkind: ${kind}\nmetadata:\n  name: ${name}\n  namespace: ${namespace}\n  labels:\n    app.kubernetes.io/name: ${name}\nspec:\n  replicas: 2\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: ${name}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: ${name}\n    spec:\n      automountServiceAccountToken: false\n      securityContext:\n        runAsNonRoot: true\n      containers:\n        - name: ${release.container_name || "app"}\n          image: ${image}\n          securityContext:\n            allowPrivilegeEscalation: false\n          resources:\n            requests:\n              cpu: 100m\n              memory: 128Mi\n            limits:\n              cpu: 1\n              memory: 512Mi\n          readinessProbe:\n            httpGet:\n              path: /health\n              port: 8080\n            periodSeconds: 10\n` }));
  }

  async function saveObjective(event: React.FormEvent) {
    event.preventDefault(); setBusy("objective"); setError(""); setNotice("");
    try {
      await apiPost("/api/reliability/objectives", {
        ...objective,
        target_percent: Number(objective.target_percent),
        window_days: Number(objective.window_days),
        observed_availability_percent: Number(objective.observed_availability_percent),
        observed_minutes: Number(objective.observed_minutes),
        downtime_minutes: Number(objective.downtime_minutes),
      });
      refreshSummary();
    } catch (requestError: any) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function submitRelease(event: React.FormEvent) {
    event.preventDefault(); setBusy("release"); setError(""); setNotice("");
    const payload = {
      ...release,
      cluster: release.cluster || "local",
      namespace: release.namespace || "default",
      service: (release.service || release.workload_name || "application-release").trim(),
      workload_name: release.workload_name.trim(),
      container_name: release.container_name.trim(),
      image: release.image.trim(),
      manifest_yaml: release.manifest_yaml.trim(),
    };
    if (payload.release_mode === "existing" && !payload.workload_name) {
      setBusy("");
      setError('Select the existing Workload to change. If this is a new application, switch to "Release new application" and submit the complete YAML.');
      return;
    }
    const emergency = payload.change_channel === "emergency_recovery";
    if (emergency && payload.emergency_reason.trim().length < 8) {
      setBusy("");
      setError("Emergency repair requires a fault description, business impact, or recovery rationale of at least 8 characters.");
      return;
    }
    if (emergency && payload.emergency_action === "rollback" && !payload.image) {
      setBusy("");
      setError("To roll back to a stable version, provide the previous stable image tag or digest.");
      return;
    }
    if (emergency && payload.emergency_action === "restore_config" && !payload.manifest_yaml) {
      setBusy("");
      setError("To restore accidentally deleted configuration, submit the complete desired-state YAML.");
      return;
    }
    if (payload.release_mode === "existing" && !payload.image && !payload.manifest_yaml && !(emergency && payload.emergency_action === "restart_component")) {
      setBusy("");
      setError("For an existing Workload release, specify at least an immutable image or submit the full desired-state YAML; otherwise the platform cannot determine what you want to change.");
      return;
    }
    if (payload.image && !payload.container_name) {
      setBusy("");
      setError("Image releases must specify the Container name to avoid changing the wrong container in the same Pod.");
      return;
    }
    try {
      const response = await apiPost<any>("/api/releases", payload);
      refreshReleases();
      setNotice(`Risk decision generated: ${response.release?.status || "awaiting_approval"}. After it passes, an "Approve" button will appear below; after approval, "Execute Release" will appear.`);
    } catch (requestError: any) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function approve(item: any) {
    const id = item.id;
    setBusy(id); setError(""); setNotice("");
    const comment = item.change_channel === "emergency_recovery"
      ? `Reviewed emergency repair action ${item.emergency_action}, impact scope, and rollback conditions`
      : "Verified the SLO, blast radius, and release objective";
    try { await apiPost(`/api/releases/${encodeURIComponent(id)}/approve`, { confirm: true, comment }); refreshReleases(); setNotice("This release request has been approved. You can execute the release now."); }
    catch (requestError: any) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  async function execute(id: string) {
    setBusy(id); setError(""); setNotice("");
    try {
      const response = await apiPost<any>(`/api/releases/${encodeURIComponent(id)}/execute`, {});
      setJobs((current) => ({ ...current, [id]: response.job }));
      refreshReleases();
      setNotice("The release job has been submitted to the controlled operations execution flow. Steps, receipts, and recovery verification will continue to appear below.");
    } catch (requestError: any) { setError(requestError.message); }
    finally { setBusy(""); }
  }

  return <section className="workspace-grid reliability-workspace">
    <div className="reliability-hero span-all">
      <div><span><ShieldCheck size={16} />SRE Release Control Plane</span><h2>Stability determines release velocity</h2><p>A default 99.9% SLO corresponds to about 43.2 minutes of monthly error budget. Once exhausted, standard releases are frozen and only recovery and rollback are allowed.</p></div>
      <div className={cx("budget-state", Number(summary.data?.summary?.exhausted || 0) > 0 && "frozen")}><strong>{summary.data?.summary?.changes_frozen || 0}</strong><span>Frozen services</span></div>
    </div>
    <div className="metric-strip span-all">
      <Metric title="SLO services" value={summary.data?.summary?.total || 0} />
      <Metric title="Budget healthy" value={summary.data?.summary?.healthy || 0} tone="good" />
      <Metric title="Budget at risk" value={summary.data?.summary?.at_risk || 0} />
      <Metric title="Budget exhausted" value={summary.data?.summary?.exhausted || 0} tone={summary.data?.summary?.exhausted ? "danger" : undefined} />
    </div>
    {auditStorage.active_path && !auditStorage.durable && <div className="audit-storage-warning span-all"><ShieldCheck size={14} /><span>Release audit is currently using emergency storage <code>{auditStorage.active_path}</code>. Submissions still work, but restore PVC write capability before Pods are rebuilt to ensure long-term audit retention.</span></div>}
    <Panel className="span-all">
      <PanelTitle icon={Gauge} title="Error budget" subtitle="The same budget governs both automated SRE changes and application releases" action={<button className="ghost tiny" onClick={refreshSummary}><RefreshCcw size={13} />Refresh</button>} />
      <div className="budget-grid">
        {objectives.map((item: any) => {
          const budget = item.budget || {};
          const used = Math.min(100, Number(budget.consumed_ratio || 0) * 100);
          return <article className={cx("budget-card", budget.state)} key={item.id}>
            <header><div><strong>{item.service}</strong><span>{item.cluster || "all"} / {item.namespace || "all"}</span></div><b>{budget.state === "exhausted" ? "Change frozen" : budget.state === "at_risk" ? "Budget at risk" : "Healthy"}</b></header>
            <div className="budget-value"><strong>{budget.target_percent}%</strong><span>SLO · {budget.error_budget_percent}% Error budget</span></div>
            <div className="budget-bar"><i style={{ width: `${used}%` }} /></div>
            <footer><span>Used {used.toFixed(1)}%</span><span>Remaining {budget.remaining_downtime_minutes ?? 0} minutes</span><span>Burn rate {budget.burn_rate ?? 0}x</span></footer>
          </article>;
        })}
      </div>
    </Panel>
    <Panel>
      <PanelTitle icon={Settings2} title="Define SLO" subtitle="The same API can be called by monitoring sync jobs to continuously update availability evidence" />
      <form className="governance-form" onSubmit={saveObjective}>
        <label>Application<input value={objective.service} onChange={(e) => setObjective({ ...objective, service: e.target.value })} /></label>
        <div className="form-pair"><label>SLO target %<input type="number" step="0.01" min="50" max="99.999" value={objective.target_percent} onChange={(e) => setObjective({ ...objective, target_percent: e.target.value })} /></label><label>Window (days)<input type="number" min="1" value={objective.window_days} onChange={(e) => setObjective({ ...objective, window_days: e.target.value })} /></label></div>
        <div className="form-pair"><label>Observed availability %<input type="number" step="0.001" min="0" max="100" value={objective.observed_availability_percent} onChange={(e) => setObjective({ ...objective, observed_availability_percent: e.target.value })} /></label><label>Downtime minutes<input type="number" min="0" value={objective.downtime_minutes} onChange={(e) => setObjective({ ...objective, downtime_minutes: e.target.value })} /></label></div>
        <button className="primary" disabled={busy === "objective"}><Save size={15} />Save and recalculate budget</button>
      </form>
    </Panel>
    <Panel>
      <PanelTitle icon={GitBranch} title="Submit application change" subtitle="Select a real target or create a new Workload, then submit desired-state YAML for security checks, risk gating, and human approval" />
      <form className="governance-form" onSubmit={submitRelease}>
        <div className="release-channel-switch"><button type="button" className={release.change_channel === "standard" ? "active" : ""} onClick={() => setRelease({ ...release, change_channel: "standard", emergency_reason: "" })}><GitBranch size={13} />Standard release</button><button type="button" className={release.change_channel === "emergency_recovery" ? "active emergency" : ""} onClick={() => setRelease({ ...release, change_channel: "emergency_recovery", release_mode: "existing", emergency_action: "rollback", workload_name: "", image: "", manifest_yaml: "" })}><Activity size={13} />Emergency repair channel</button></div>
        {release.change_channel === "standard" ? <div className="release-mode-switch"><button type="button" className={release.release_mode === "existing" ? "active" : ""} onClick={() => setRelease({ ...release, release_mode: "existing", workload_name: "", manifest_yaml: "" })}>Modify existing application</button><button type="button" className={release.release_mode === "new" ? "active" : ""} onClick={() => setRelease({ ...release, release_mode: "new", workload_name: "", manifest_yaml: "" })}>Release new application</button></div> : <div className="emergency-policy-note"><ShieldCheck size={14} /><span>Only limited stability-restoring actions are allowed. When the error budget is exhausted, the request may still enter approval, but it will not bypass security checks, audit, human confirmation, or recovery verification.</span></div>}
        {release.change_channel === "emergency_recovery" && <label>Emergency action<select value={release.emergency_action} onChange={(e) => setRelease({ ...release, emergency_action: e.target.value, image: "", manifest_yaml: "" })}><option value="rollback">Roll back to previous stable version</option><option value="restore_config">Restore accidentally deleted configuration</option><option value="restart_component">Restart failed component</option></select></label>}
        <label>Application identifier<input value={release.service} onChange={(e) => setRelease({ ...release, service: e.target.value })} placeholder="Used to match the SLO; enter the business application name" /></label>
        <div className="form-pair">
          <label>Cluster<select value={release.cluster} onChange={(e) => setRelease({ ...release, cluster: e.target.value || "local", namespace: e.target.value === "local" ? "default" : "", workload_name: "" })}><option value="local">Local agent cluster</option>{clusters.filter((item: any) => item.id !== "local").map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label>
          <label>Namespace<select value={release.namespace} onChange={(e) => setRelease({ ...release, namespace: e.target.value || "default", workload_name: "" })}><option value="">Select namespace</option>{namespaces.map((item) => <option key={item} value={item}>{item}</option>)}{release.cluster === "local" && !namespaces.includes("default") && <option value="default">default</option>}</select></label>
        </div>
        {release.release_mode === "existing" ? <label>Existing Workload<select value={release.workload_name ? `${release.workload_kind}|${release.workload_name}` : ""} onChange={(e) => { const [kind, name] = e.target.value.split("|"); setRelease({ ...release, workload_kind: kind || "Deployment", workload_name: name || "", service: release.service || name || "" }); }}><option value="">Select Workload</option>{workloads.map((item: any) => <option key={`${item.namespace}-${item.kind}-${item.name}`} value={`${item.kind}|${item.name}`}>{item.kind}/{item.name}</option>)}</select></label> : <div className="form-pair"><label>Resource type<select value={release.workload_kind} onChange={(e) => setRelease({ ...release, workload_kind: e.target.value })}><option>Deployment</option><option>StatefulSet</option><option>DaemonSet</option></select></label><label>New Workload name<input value={release.workload_name} onChange={(e) => setRelease({ ...release, workload_name: e.target.value, service: release.service || e.target.value })} placeholder="new-application" /></label></div>}
        {(release.change_channel === "standard" || release.emergency_action === "rollback") && <div className="form-pair"><label>Container<input value={release.container_name} onChange={(e) => setRelease({ ...release, container_name: e.target.value })} /></label><label>{release.change_channel === "emergency_recovery" ? "Previous stable image" : "Immutable image"}<input placeholder="registry/app:v1.2.3" value={release.image} onChange={(e) => setRelease({ ...release, image: e.target.value })} /></label></div>}
        {(release.change_channel === "standard" || release.emergency_action === "restore_config") && <label className="manifest-editor-label"><span>{release.emergency_action === "restore_config" ? "Restored desired-state YAML" : "Desired-state YAML"} <button type="button" className="ghost tiny" onClick={generateManifest}><FileUp size={13} />Generate production template</button></span><textarea className="manifest-editor" value={release.manifest_yaml} onChange={(e) => setRelease({ ...release, manifest_yaml: e.target.value })} placeholder={release.release_mode === "new" ? "New applications must submit a complete apps/v1 Workload YAML" : "Submit the complete desired-state YAML; the platform will validate it and generate auditable diffs"} /></label>}
        <div className="manifest-policy"><ShieldCheck size={14} /><span>Pre-submit checks: target consistency, immutable images, non-privileged execution, ServiceAccount token, hostPath, and Linux capabilities. Secrets are not allowed through this entry point.</span></div>
        {release.change_channel === "emergency_recovery" && <label>Emergency repair reason<textarea value={release.emergency_reason} onChange={(e) => setRelease({ ...release, emergency_reason: e.target.value })} placeholder="Describe the current failure, business impact, why immediate recovery is required, and how to stop or roll back if it fails" /></label>}
        <label>Change summary<textarea value={release.change_summary} onChange={(e) => setRelease({ ...release, change_summary: e.target.value })} placeholder="Describe the business goal, risks, and rollback conditions" /></label>
        <button className={release.change_channel === "emergency_recovery" ? "primary emergency-submit" : "primary"} disabled={busy === "release"}><ShieldCheck size={15} />{release.change_channel === "emergency_recovery" ? "Submit emergency repair decision" : "Submit risk decision"}</button>
        <div className="form-hint">Workflow: after the risk decision passes, the "Release Audit Chain" shows an Approve button; after human approval, an Execute Release button appears and the request enters an interruptible operations execution flow.</div>
      </form>
    </Panel>
    <Panel className="span-all">
      <PanelTitle icon={Workflow} title="Release Audit Chain" subtitle="Requests, budget snapshots, algorithm decisions, approvals, and execution jobs are traceable" action={<button className="ghost tiny" onClick={refreshReleases}><RefreshCcw size={13} />Refresh</button>} />
      <div className="release-list">
        {releases.map((item: any) => <article className="release-row" key={item.id}>
          <div className="release-main"><div className="release-badges"><span className={cx("release-status", item.status)}>{item.status}</span>{item.change_channel === "emergency_recovery" && <span className="release-status emergency">Emergency repair · {item.emergency_action}</span>}</div><strong>{item.service} · {item.workload_kind}/{item.workload_name}</strong><small>{item.cluster}/{item.namespace} · {item.release_mode === "new" ? "New" : "Change"} · {item.manifest_validation ? `YAML validated ${item.manifest_validation.digest}` : item.image || (item.emergency_action === "restart_component" ? "Controlled restart" : "Configuration change")}</small></div>
          <div className="release-decision"><b>{item.gate?.verdict || "-"}</b><span>Risk {item.gate?.risk?.diff_risk ?? item.gate?.risk?.amplification_factor ?? "-"} · Budget remaining {Math.round(Number(item.error_budget?.remaining_ratio || 0) * 100)}%</span><small>{item.gate?.reason}</small></div>
          <div className="release-actions">{item.status === "awaiting_approval" && <button className="ghost" disabled={busy === item.id} onClick={() => approve(item)}><CheckCircle2 size={14} />Approve</button>}{item.status === "approved" && <button className="primary" disabled={busy === item.id} onClick={() => execute(item.id)}><Play size={14} />{item.change_channel === "emergency_recovery" ? "Execute repair" : "Execute release"}</button>}{item.status === "blocked" && <span className="release-block-note">Blocked by gate</span>}</div>
          <ReleaseReportPanel report={item.report} />
          {jobs[item.id] && <div className="release-job"><ReleaseJobTracker initial={jobs[item.id]} /></div>}
        </article>)}
        {!releases.length && <EmptyState text="No release requests yet. After you submit the first change, gating evidence will appear here." />}
      </div>
    </Panel>
    {notice && <div className="notice-box span-all">{notice}</div>}
    {error && <div className="error-box span-all">{error}</div>}
  </section>;
}

function EffectivenessPage() {
  const [state, refresh] = useAsync<any>(() => apiGet("/api/effectiveness"), []);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const summary = state.data?.summary || {};
  const storage = state.data?.storage || {};
  const models = asList(state.data?.by_model);
  const records = asList(state.data?.recent_remediations);
  return (
    <section className="workspace-grid">
      <div className="metric-strip effectiveness-metrics span-all">
        <Metric title="Inspection runs" value={summary.inspection_runs || 0} />
        <Metric title="Change success rate" value={`${Math.round((summary.change_success_rate || 0) * 100)}%`} />
        <Metric title="Pods recovered" value={summary.pods_recovered || 0} tone="good" />
        <Metric title="Risk reduction rate" value={`${Math.round((summary.risk_reduction_rate || 0) * 100)}%`} />
        <Metric title="Record storage" value={storage.durable ? "PVC" : storage.path ? "Temporary" : "Loading"} tone={storage.durable ? "good" : undefined} />
      </div>
      <Panel>
        <PanelTitle icon={Gauge} title="Model performance comparison" action={<button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button>} />
        {state.loading && <div className="quiet-empty">Loading model performance and operations audit...</div>}
        {state.error && <div className="error-box">{state.error}</div>}
        <div className="model-list">
          {models.length ? models.map((m: any) => <div className="model-row" key={m.model_id}><strong>{m.model_id}</strong><span>Change {m.successful_changes || 0}/{m.changes_total || 0}</span><span>Recovered {m.pods_recovered || 0} Pods</span><button className="ghost tiny" onClick={() => setSelectedRecord((m.records || [])[0] || m)}>View record</button></div>) : <EmptyState text="No model performance records yet; they will be generated automatically after an AI inspection or SRE operation runs." />}
        </div>
      </Panel>
      <Panel>
        <PanelTitle icon={TerminalSquare} title="Recent AI change records" />
        <div className="record-list">
          {records.length ? records.slice().reverse().map((r: any) => <div className="record" key={r.id}><strong>{r.target || "Diagnostic task"}</strong><p>{r.cluster}/{r.namespace} · {r.status} · Incident lineage round {r.lineage_attempt || 1} · Change {r.changes_succeeded}/{r.changes_total} · Recovered {r.pods_recovered || 0} Pods</p><button className="ghost tiny" onClick={() => setSelectedRecord(r)}>View details</button></div>) : <EmptyState text="No change audit records yet; read-only diagnoses, gate blocks, and execution failures will also appear here from now on." />}
        </div>
      </Panel>
      {selectedRecord && <Panel className="span-all">
        <PanelTitle icon={FileUp} title="Operations record details" subtitle={selectedRecord.id || selectedRecord.model_id || "record"} action={<button className="ghost tiny" onClick={() => setSelectedRecord(null)}>Close</button>} />
        <div className="effectiveness-detail">
          <div><span>Target</span><strong>{selectedRecord.target || selectedRecord.model_id || "-"}</strong></div>
          <div><span>Scope</span><strong>{selectedRecord.cluster || "-"} / {selectedRecord.namespace || "-"}</strong></div>
          <div><span>Status</span><strong>{selectedRecord.status || "recorded"}</strong></div>
          <div><span>Change</span><strong>{selectedRecord.changes_succeeded ?? selectedRecord.successful_changes ?? 0}/{selectedRecord.changes_total ?? 0}</strong></div>
          <div><span>Incident lineage</span><strong>{selectedRecord.lineage_id || "Single-round task"}</strong></div>
          <div><span>Strategy round</span><strong>Round {selectedRecord.lineage_attempt || 1}</strong></div>
        </div>
        {asList(selectedRecord.attempted_strategies).length > 0 && <details className="ops-lineage-history" open>
          <summary>Strategy variation history</summary>
          <div>{asList(selectedRecord.attempted_strategies).map((attempt: any, index: number) => <span key={`${attempt.fingerprint || attempt.strategy}-${index}`}><i>{attempt.attempt || index + 1}</i><b>{attempt.strategy || `Strategy ${index + 1}`}</b><em>{attempt.recovered === true ? "Recovered" : attempt.status || "Not recovered"}</em><small>{attempt.outcome || "No recovery evidence was found in this round."}</small>{asList(attempt.actions).length > 0 && <code>{asList(attempt.actions).join(" · ")}</code>}</span>)}</div>
        </details>}
        {asList(selectedRecord.changes).length > 0 && <div className="record-evidence-list">{asList(selectedRecord.changes).map((change: any, index: number) => <article key={`${change.type}-${index}`}><b>{change.type} · {change.target}</b><span>{change.status} · {change.risk}</span><pre>{JSON.stringify(change.patch || change.payload || {}, null, 2)}</pre></article>)}</div>}
        {selectedRecord.verification && <div className="analysis-card"><strong>Recovery verification</strong><p>{selectedRecord.verification.message || selectedRecord.verification.proof || JSON.stringify(selectedRecord.verification)}</p></div>}
      </Panel>}
    </section>
  );
}

function ObservabilityPage() {
  const [state, refresh] = useAsync<any>(() => apiGet("/api/llm-observability?limit=80"), []);
  const summary = state.data?.summary || {};
  const analytics = state.data?.analytics || {};
  return (
    <section className="workspace-grid">
      <div className="metric-strip span-all">
        <Metric title="Calls" value={summary.total || 0} />
        <Metric title="Token" value={prettyNumber(summary.total_tokens)} />
        <Metric title="Avg latency" value={`${summary.avg_latency_ms || 0}ms`} />
        <Metric title="P95" value={`${summary.p95_latency_ms || 0}ms`} />
      </div>
      <Panel>
        <PanelTitle icon={Activity} title="Data sources" action={<button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button>} />
        <Bars rows={asList(analytics.by_source)} />
      </Panel>
      <Panel>
        <PanelTitle icon={Boxes} title="Model invocations" />
        <Bars rows={asList(analytics.by_model)} />
      </Panel>
    </section>
  );
}

function ModelLabPage({
  activeModelId,
  onActivate,
  refreshRegistry,
  registry
}: {
  activeModelId: string;
  onActivate: (profileId: string) => void;
  refreshRegistry: () => void;
  registry: ApiState<any>;
}) {
  const profiles = asList(registry.data?.profiles) as ModelProfile[];
  const [benchmark, refreshBenchmark] = useAsync<any>(() => apiGet("/api/model-benchmark"), []);
  const [form, setForm] = useState({
    id: "",
    provider: "oauth-gateway",
    model: "",
    base_url: "",
    auth_type: "oauth_client_credentials",
    token_url: "",
    client_id: "",
    client_secret: "",
    api_key: "",
    max_tokens: 4096,
    description: "",
    verify_ssl: false,
    set_active: true
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [testState, setTestState] = useState<ApiState<any>>({ loading: false });
  const [runState, setRunState] = useState<ApiState<any>>({ loading: false });
  const latestRun = runState.data?.run || benchmark.data?.runs?.[0];
  const latestResults = asList(latestRun?.results);
  const rubric = latestRun?.rubric || benchmark.data?.rubric || {};

  useEffect(() => {
    if (!selected.length && profiles.length) setSelected(profiles.slice(0, 3).map((p) => p.id));
  }, [profiles, selected.length]);

  function updateForm(key: string, value: any) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function saveProfile() {
    setTestState({ loading: true });
    try {
      await apiPost("/api/model-registry", form);
      setTestState({ loading: false, data: { status: "ok", answer: "Model configuration saved. Secrets will not be shown again in the frontend." } });
      if (form.set_active) onActivate(form.id || `${form.provider}:${form.model}`);
      refreshRegistry();
    } catch (error: any) {
      setTestState({ loading: false, error: error.message });
    }
  }

  async function testProfile(profileId = activeModelId) {
    if (!profileId) return;
    setTestState({ loading: true });
    try {
      const data = await apiPost(`/api/model-registry/${encodeURIComponent(profileId)}/test`, {});
      setTestState({ loading: false, data });
    } catch (error: any) {
      setTestState({ loading: false, error: error.message });
    }
  }

  async function runBenchmark() {
    setRunState({ loading: true });
    try {
      const data = await apiPost("/api/model-benchmark/run", {
        model_profile_ids: selected.length ? selected : [activeModelId],
        cluster: "all",
        namespace: "all",
        include_latest_findings: true
      });
      setRunState({ loading: false, data });
      refreshBenchmark();
    } catch (error: any) {
      setRunState({ loading: false, error: error.message });
    }
  }

  return (
    <section className="model-lab">
      <Panel className="span-all">
        <PanelTitle
          icon={Settings2}
          title="Pluggable AI Models"
          subtitle="Supports enterprise gateways with Token URL + Base URL, and OpenAI-compatible integrations with Base URL + API Key"
          action={<button className="ghost" onClick={refreshRegistry}><RefreshCcw size={15} />Refresh</button>}
        />
        <div className="profile-grid">
          {profiles.map((profile) => (
            <div className={cx("profile-card", activeModelId === profile.id && "active")} key={profile.id}>
              <div className="profile-head">
                <div>
                  <strong>{profile.id}</strong>
                  <span>{profile.provider} · {profile.model}</span>
                </div>
                {activeModelId === profile.id ? <CheckCircle2 size={18} /> : <button className="ghost tiny" onClick={() => onActivate(profile.id)}>Activate</button>}
              </div>
              <p>{profile.description || profile.base_url}</p>
              <div className="chips"><span>{profile.auth_type}</span><span>{profile.role || "candidate"}</span></div>
            </div>
          ))}
          {!profiles.length && <EmptyState text="No model configurations yet. You can add an enterprise gateway or API key model on the right." />}
        </div>
      </Panel>

      <Panel>
        <PanelTitle icon={KeyRound} title="Add / Update Model" />
        <div className="form-stack">
          <label>Profile ID<input value={form.id} onChange={(e) => updateForm("id", e.target.value)} placeholder="deepseek-prod" /></label>
          <div className="form-grid two">
            <label>Provider<input value={form.provider} onChange={(e) => updateForm("provider", e.target.value)} /></label>
            <label>Model<input value={form.model} onChange={(e) => updateForm("model", e.target.value)} placeholder="your-model" /></label>
          </div>
          <label>Base URL<input value={form.base_url} onChange={(e) => updateForm("base_url", e.target.value)} placeholder="https://gateway/engines/xxx or .../chat/completions" /></label>
          <label>Authentication method<select value={form.auth_type} onChange={(e) => updateForm("auth_type", e.target.value)}>
            <option value="oauth_client_credentials">Token URL + Client Credentials</option>
            <option value="api_key">Base URL + API Key</option>
            <option value="none">No authentication / local model</option>
          </select></label>
          {form.auth_type === "oauth_client_credentials" ? (
            <>
              <label>Token URL<input value={form.token_url} onChange={(e) => updateForm("token_url", e.target.value)} /></label>
              <div className="form-grid two">
                <label>Client ID<input value={form.client_id} onChange={(e) => updateForm("client_id", e.target.value)} /></label>
                <label>Client Secret<input type="password" value={form.client_secret} onChange={(e) => updateForm("client_secret", e.target.value)} placeholder="Won't be shown again after saving" /></label>
              </div>
            </>
          ) : form.auth_type === "api_key" ? (
            <label>API Key<input type="password" value={form.api_key} onChange={(e) => updateForm("api_key", e.target.value)} placeholder="Won't be shown again after saving" /></label>
          ) : null}
          <div className="form-grid two">
            <label>Max tokens<input type="number" value={form.max_tokens} onChange={(e) => updateForm("max_tokens", Number(e.target.value))} /></label>
            <label className="toggle"><input type="checkbox" checked={form.verify_ssl} onChange={(e) => updateForm("verify_ssl", e.target.checked)} />Verify certificates</label>
          </div>
          <label>Description<input value={form.description} onChange={(e) => updateForm("description", e.target.value)} placeholder="Example: primary production diagnosis model / benchmark candidate model" /></label>
          <label className="toggle"><input type="checkbox" checked={form.set_active} onChange={(e) => updateForm("set_active", e.target.checked)} />Set as current model after saving</label>
          <button className="primary" onClick={saveProfile}><Save size={16} />Save model</button>
          {testState.error && <div className="error-box">{testState.error}</div>}
          {testState.data && <div className="success-box">{testState.data.answer || testState.data.status}{testState.data.latency_ms ? ` · ${testState.data.latency_ms}ms` : ""}</div>}
        </div>
      </Panel>

      <Panel>
        <PanelTitle
          icon={Beaker}
          title="Operations Capability Benchmark"
          subtitle="Give the same inspection evidence to multiple models and compare root-cause coverage, action executability, security gating, latency, and token cost"
          action={<button className="primary" onClick={runBenchmark} disabled={runState.loading}>{runState.loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}Start benchmark</button>}
        />
        <div className="benchmark-standard">
          <header><ShieldCheck size={16} /><div><strong>{rubric.name || "FrontierSRE-Production-Rubric"}</strong><span>An open, auditable production SRE agent standard that does not pretend to be any organization's unpublished internal benchmark</span></div></header>
          <div className="benchmark-weight-grid">
            {Object.entries(rubric.weights || { "Evidence grounding": 22, "Root-cause reasoning": 20, "Remediation depth": 22, "Safe changes": 16, "Recovery verification": 12, "Response efficiency": 8 }).map(([name, weight]) => <div key={name}><b>{Number(weight)}%</b><span>{name}</span></div>)}
          </div>
          <details><summary>How scoring works</summary><p>{rubric.formula || "Total score = Σ(dimension score × dimension weight)."} Offline benchmarking checks whether answers cite real evidence, whether actions are executable and reversible, and whether safety gates and recovery verification are included. The live "Ops Effectiveness" view separately tracks real change success rates, recovered Pods, and risk reduction so eloquence is not mistaken for repair ability.</p><p>Basis: {asList(rubric.basis).join("; ") || "SLO/error budgets, safe Kubernetes changes, DORA effectiveness, and the OpenTelemetry evidence chain."}</p></details>
        </div>
        <div className="check-list">
          {profiles.map((profile) => (
            <label className="check-row" key={profile.id}>
              <input
                type="checkbox"
                checked={selected.includes(profile.id)}
                onChange={(e) => setSelected((old) => e.target.checked ? [...old, profile.id] : old.filter((x) => x !== profile.id))}
              />
              <span><strong>{profile.id}</strong><small>{profile.model}</small></span>
              <button type="button" className="ghost tiny" onClick={() => testProfile(profile.id)}>Test</button>
            </label>
          ))}
        </div>
        {runState.error && <div className="error-box">{runState.error}</div>}
        {latestRun?.rubric && <div className="benchmark-method"><ShieldCheck size={15} /><div><strong>{latestRun.rubric.name} · {latestRun.rubric.version}</strong><span>{asList(latestRun.rubric.dimensions).join(" / ")}</span></div></div>}
        <div className="leaderboard">
          {asList(benchmark.data?.leaderboard).map((row: any, index: number) => (
            <div className="rank-row" key={row.profile_id}>
              <strong>#{index + 1} {row.profile_id}</strong>
              <span>Avg score {row.avg_score}</span>
              <span>{row.avg_latency_ms}ms</span>
            </div>
          ))}
          {!asList(benchmark.data?.leaderboard).length && <EmptyState text="No benchmark records yet. Run a benchmark to see the model leaderboard." />}
        </div>
      </Panel>

      <Panel className="span-all">
        <PanelTitle icon={TerminalSquare} title="Recent benchmark reports" subtitle="Every score includes dimension weights, matched evidence, missing items, and improvement suggestions" />
        <div className="benchmark-runs">
          {latestResults.map((result: any) => (
            <div className="benchmark-card" key={result.profile_id}>
              <div className="profile-head">
                <div><strong>{result.profile_id}</strong><span>{result.model || result.status}</span></div>
                <div className="benchmark-grade"><b>{result.score?.grade || "-"}</b><strong>{result.score?.total || 0}</strong><small>/ 100</small></div>
              </div>
              {result.error ? <p className="danger-text">{result.error}</p> : <div className="rubric-list">{asList(result.score?.criteria).map((criterion: any) => <div key={criterion.id}><header><strong>{criterion.label}</strong><span>{criterion.score} × {criterion.weight}% = {criterion.weighted_score}</span></header><i><b style={{ width: `${Math.min(100, Number(criterion.score || 0))}%` }} /></i><small>{asList(criterion.evidence).slice(0, 3).join(" · ") || "No valid evidence matched"}</small></div>)}</div>}
              {!result.error && <div className="benchmark-basis"><div><b>Strengths</b><span>{asList(result.score?.strengths).join(", ") || "No clear strengths yet"}</span></div><div><b>Key gaps</b><span>{asList(result.score?.gaps).join("; ") || "No key gaps found"}</span></div><div><b>Improvement suggestions</b><span>{asList(result.score?.recommendations).join("; ") || "Maintain current strategy"}</span></div></div>}
              {!result.error && <details className="benchmark-answer"><summary>View raw model response</summary><p>{result.answer_preview}</p></details>}
            </div>
          ))}
          {!latestResults.length && <EmptyState text="After you run a benchmark, a complete six-dimension capability report will appear here." />}
        </div>
      </Panel>
    </section>
  );
}

function KnowledgePage({ activeModelId }: { activeModelId: string }) {
  const [domain, setDomain] = useState("app");
  const [question, setQuestion] = useState("After AI inspection finds a production risk, how should I execute the repair?");
  const [includePrinciple, setIncludePrinciple] = useState(false);
  const [state, setState] = useState<ApiState<any>>({ loading: false });
  const [ingestState, setIngestState] = useState<ApiState<any>>({ loading: false });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [ingestForm, setIngestForm] = useState({
    domain: "auto",
    title: "",
    tags: "",
    content: "",
    embed: true,
  });
  const [sources, refreshSources] = useAsync<any>(() => apiGet("/api/knowledge/sources"), []);
  const [documents, refreshDocuments] = useAsync<any>(() => apiGet(`/api/knowledge/documents?domain=${encodeURIComponent(domain)}`), [domain]);
  const embedding = sources.data?.embedding || {};

  function updateIngest(key: string, value: any) {
    setIngestForm((old) => ({ ...old, [key]: value }));
  }

  async function ask() {
    const text = question.trim();
    if (!text) return;
    setState({ loading: true });
    try {
      const data = await apiPost("/api/knowledge/ask", {
        question: text,
        domain,
        include_principle: includePrinciple,
        model_profile_id: activeModelId,
      });
      setState({ loading: false, data });
    } catch (error: any) {
      setState({ loading: false, error: error.message });
    }
  }

  async function addKnowledge() {
    if (!ingestForm.content.trim()) {
      setIngestState({ loading: false, error: "Please enter knowledge content first" });
      return;
    }
    setIngestState({ loading: true });
    try {
      const data = await apiPost<any>("/api/knowledge/documents", {
        ...ingestForm,
        source: "frontend",
        document_type: "text",
      });
      setIngestState({ loading: false, data });
      setIngestForm((old) => ({ ...old, title: "", tags: "", content: "" }));
      refreshSources();
      refreshDocuments();
    } catch (error: any) {
      setIngestState({ loading: false, error: error.message });
    }
  }

  async function uploadKnowledge() {
    if (!uploadFile) {
      setIngestState({ loading: false, error: "Please select a document to import first" });
      return;
    }
    setIngestState({ loading: true });
    try {
      const form = new FormData();
      form.set("file", uploadFile);
      form.set("domain", ingestForm.domain);
      form.set("title", ingestForm.title);
      form.set("tags", ingestForm.tags);
      form.set("embed", String(ingestForm.embed));
      const response = await fetch("/api/knowledge/upload", { method: "POST", body: form, headers: adminAuthHeaders({ Accept: "application/json" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || data.error || `${response.status} ${response.statusText}`);
      setIngestState({ loading: false, data });
      setUploadFile(null);
      setIngestForm((old) => ({ ...old, title: "", tags: "", content: "" }));
      refreshSources();
      refreshDocuments();
    } catch (error: any) {
      setIngestState({ loading: false, error: error.message });
    }
  }

  async function reindexKnowledge() {
    setIngestState({ loading: true });
    try {
      const data = await apiPost<any>("/api/knowledge/reindex", { domain, force: true });
      setIngestState({ loading: false, data: { status: data.status, message: `Reindex complete: ${data.reindexed || 0} documents, ${data.failed || 0} failed` } });
      refreshSources();
      refreshDocuments();
    } catch (error: any) {
      setIngestState({ loading: false, error: error.message });
    }
  }

  async function deleteKnowledge(documentId: string) {
    setIngestState({ loading: true });
    try {
      const res = await fetch(`/api/knowledge/documents/${encodeURIComponent(documentId)}`, { method: "DELETE", headers: adminAuthHeaders({ Accept: "application/json" }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || data.error || `${res.status} ${res.statusText}`);
      setIngestState({ loading: false, data: { status: "ok", message: "Knowledge entry deleted" } });
      refreshSources();
      refreshDocuments();
    } catch (error: any) {
      setIngestState({ loading: false, error: error.message });
    }
  }

  return (
    <section className="knowledge-layout">
      <Panel>
        <PanelTitle icon={BookOpen} title="Operations RAG Knowledge Base" subtitle="For assistants and operators: ask how to use the system or how to troubleshoot complex failures." />
        <div className="form-stack">
          <label>Knowledge domain<select value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="app">Application usage knowledge base</option>
            <option value="ops">Operations runbook knowledge base</option>
          </select></label>
          <textarea className="knowledge-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask how to use this system or how to handle a certain kind of K8s issue..." />
          <label className="toggle"><input type="checkbox" checked={includePrinciple} onChange={(e) => setIncludePrinciple(e.target.checked)} />Explain the principles too</label>
          <button className="primary" onClick={ask} disabled={state.loading}>{state.loading ? <Loader2 className="spin" size={16} /> : <Send size={16} />}Ask</button>
          {state.error && <div className="error-box">{state.error}</div>}
        </div>
      </Panel>
      <Panel>
        <PanelTitle icon={BrainCircuit} title="Assistant answer" />
        {state.data ? (
          <div className="knowledge-answer">
            <div className="chips"><span>{state.data.source}</span><span>{state.data.status}</span></div>
            <div className="markdown" dangerouslySetInnerHTML={{ __html: markdownish(state.data.answer || "") }} />
            <div className="source-list">
              {asList(state.data.citations).map((doc: any) => (
                <div className="source-card" key={doc.id}>
                  <strong>{doc.title}</strong>
                  <div className="source-meta"><span>{doc.retrieval || doc.source || "source"}</span>{doc.score !== undefined && <span>score {doc.score}</span>}</div>
                  <p>{doc.content}</p>
                </div>
              ))}
            </div>
          </div>
        ) : <EmptyState text="Think of it as a talking product manual and operations manual. When the LLM is unavailable, it will still provide a retrieval-based fallback answer." />}
      </Panel>
      <Panel>
        <PanelTitle icon={Database} title="Add knowledge" subtitle="Upload a file or paste text. The system will extract content, chunk it automatically, and call embeddings to store it." />
        <div className="form-stack">
          <div className="form-grid two">
            <label>Knowledge domain<select value={ingestForm.domain} onChange={(e) => updateIngest("domain", e.target.value)}>
              <option value="auto">Auto-detect</option>
              <option value="app">Application usage knowledge</option>
              <option value="ops">Operations runbook</option>
            </select></label>
            <label className="toggle"><input type="checkbox" checked={ingestForm.embed} onChange={(e) => updateIngest("embed", e.target.checked)} />Vectorize after saving</label>
          </div>
          <label>Title<input value={ingestForm.title} onChange={(e) => updateIngest("title", e.target.value)} placeholder="Example: NFS PVC permission issue handling runbook" /></label>
          <label>Tags<input value={ingestForm.tags} onChange={(e) => updateIngest("tags", e.target.value)} placeholder="crashloop, pvc, rancher; leave blank for auto-detection" /></label>
          <label className="knowledge-dropzone">
            <FileUp size={21} />
            <span><strong>{uploadFile ? uploadFile.name : "Select knowledge base file"}</strong><small>Supports PDF, Word, PowerPoint, Excel, CSV, Markdown, HTML, JSON, YAML, logs, and plain text</small></span>
            <input type="file" accept=".pdf,.docx,.pptx,.xlsx,.odt,.csv,.md,.markdown,.txt,.log,.json,.yaml,.yml,.html,.htm,.xml,.rtf" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} />
          </label>
          <textarea className="knowledge-input knowledge-ingest-input" value={ingestForm.content} onChange={(e) => updateIngest("content", e.target.value)} placeholder="Paste the knowledge text. The system will automatically detect the application/operations domain, chunk by paragraph, and use the embedding model to generate vectors." />
          <div className="knowledge-actions">
            <button className="primary" onClick={uploadKnowledge} disabled={ingestState.loading || !uploadFile}><FileUp size={16} />Import file</button>
            <button className="primary" onClick={addKnowledge} disabled={ingestState.loading}>{ingestState.loading ? <Loader2 className="spin" size={16} /> : <Save size={16} />}Save knowledge</button>
            <button className="ghost" onClick={reindexKnowledge} disabled={ingestState.loading}><RefreshCcw size={15} />Rebuild index</button>
          </div>
          {ingestState.error && <div className="error-box">{ingestState.error}</div>}
          {ingestState.data && <div className="success-box">{ingestState.data.message || ingestState.data.status}</div>}
        </div>
      </Panel>
      <Panel>
        <PanelTitle icon={Boxes} title="Added knowledge" subtitle="This knowledge will be reused by the assistant, knowledge-base Q&A, and subsequent operations RAG workflows." action={<button className="ghost" onClick={refreshDocuments}><RefreshCcw size={15} />Refresh</button>} />
        <div className="knowledge-doc-list">
          {asList(documents.data?.documents).map((doc: any) => (
            <div className="knowledge-doc-card" key={doc.id}>
              <div>
                <strong>{doc.title}</strong>
                <small>{doc.domain} · {doc.chunk_count || asList(doc.chunks).length} chunks · {doc.embedding_status}</small>
              </div>
              <div className="chips">{asList(doc.tags).slice(0, 5).map((tag: string) => <span key={tag}>{tag}</span>)}</div>
              {doc.embedding_error && <p>{doc.embedding_error}</p>}
              <button className="ghost tiny" onClick={() => deleteKnowledge(doc.id)}>Delete</button>
            </div>
          ))}
          {!asList(documents.data?.documents).length && <EmptyState text="No knowledge has been added from the frontend yet. After you save a runbook, its chunks and embedding status will appear here." />}
        </div>
      </Panel>
      <Panel className="span-all">
        <PanelTitle icon={Boxes} title="Knowledge source status" />
        <div className="knowledge-meta">
          <span>Embedding: {embedding.enabled ? "Enabled" : "Disabled"}</span>
          <span>{embedding.model || "No model configured"}</span>
          <span>{embedding.runtime_documents || 0} documents / {embedding.runtime_chunks || 0} vector chunks</span>
          <span>{embedding.store_path || "runtime store"}</span>
        </div>
        <div className="profile-grid">
          {asList(sources.data?.domains).map((item: any) => (
            <div className="profile-card" key={item.id}><strong>{item.name}</strong><p>{item.documents} knowledge chunks, reusable by the assistant, SRE chat, and operations workflows.</p></div>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={cx("panel", className)}>{children}</section>;
}

function PanelTitle({ icon: Icon, title, subtitle, action }: { icon: any; title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="panel-title"><div><span><Icon size={16} />{title}</span>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function Metric({ title, value, tone }: { title: string; value: React.ReactNode; tone?: "good" | "danger" }) {
  return <div className={cx("metric", tone)}><span>{title}</span><strong>{value}</strong></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><CircleDot size={18} />{text}</div>;
}

function Bars({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.calls || r.count || 0)));
  return <div className="bars">{rows.length ? rows.slice(0, 8).map((row) => <div className="bar" key={row.name}><span>{row.name}</span><i><b style={{ width: `${(Number(row.calls || row.count || 0) / max) * 100}%` }} /></i><strong>{row.calls || row.count || 0}</strong></div>) : <EmptyState text="No observability data yet." />}</div>;
}

const demoVideoMode = new URLSearchParams(window.location.search).get("demoVideo");

createRoot(document.getElementById("root")!).render(
  demoVideoMode ? <DemoVideoApp mode={demoVideoMode} /> : <App />
);
