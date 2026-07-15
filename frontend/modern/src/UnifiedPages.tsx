import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  CloudCog,
  Database,
  Download,
  FileClock,
  Eye,
  Gauge,
  GitBranch,
  HardDrive,
  Layers3,
  LineChart,
  Loader2,
  MessageSquareText,
  Network,
  RefreshCcw,
  Search,
  Send,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import { useAsync } from "./hooks/useAsync";
import { ApiState, adminAuthHeaders, apiGet, apiPost, asList as list, compactNumber, invalidateApiCache } from "./lib/api";
import { OpsPlanPanel } from "./components/OpsPlanPanel";

function timeText(value: string | undefined) {
  if (!value) return "-";
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return value; }
}

function SectionHead({ icon: Icon, title, meta, action }: { icon: any; title: string; meta?: string; action?: React.ReactNode }) {
  return <div className="section-head"><div><span><Icon size={16} />{title}</span>{meta && <small>{meta}</small>}</div>{action}</div>;
}

function StatusPill({ status, text }: { status: string; text?: string }) {
  const tone = /ok|up|connected|ready|enabled|healthy/i.test(status) ? "ok" : /disabled|not_configured|unknown/i.test(status) ? "muted" : "warn";
  return <span className={`status-pill ${tone}`}><i />{text || status}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="unified-empty"><CircleDot size={18} /><span>{text}</span></div>;
}

function Kpi({ label, value, detail, tone = "" }: { label: string; value: React.ReactNode; detail?: string; tone?: string }) {
  return <div className={`unified-kpi ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function DashboardPage() {
  const [cluster, setCluster] = useState("all");
  const [selectedProblem, setSelectedProblem] = useState<any>(null);
  const [advice, setAdvice] = useState<ApiState<any>>({ loading: false });
  const [rancher, refreshRancher] = useAsync<any>(() => apiGet("/api/rancher/status"), []);
  const [inventory, refreshInventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => apiGet("/api/dashboard")), []);
  const [metrics, refreshMetrics] = useAsync<any>(() => apiGet(`/api/prometheus/summary?cluster=${encodeURIComponent(cluster)}`), [cluster]);
  const [health, refreshHealth] = useAsync<any>(() => apiGet("/api/health"), []);

  const clusters = list(rancher.data?.clusters);
  const selectedInventory = useMemo(() => {
    const items = list(inventory.data?.inventory);
    if (cluster === "all") return items;
    return items.filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name);
  }, [cluster, inventory.data]);
  const pods = selectedInventory.flatMap((item: any) => list(item.pods));
  const workloads = selectedInventory.flatMap((item: any) => list(item.workloads));
  const nodes = selectedInventory.flatMap((item: any) => list(item.nodes));
  const values = metrics.data?.values || {};
  const fallback = inventory.data?.pods && !inventory.data?.inventory;
  const summary = fallback ? inventory.data : {
    pods: { total: pods.length, running: pods.filter((pod: any) => pod.phase === "Running").length, failed: pods.filter((pod: any) => pod.issue || !pod.ready).length },
    nodes: { total: nodes.length, ready: nodes.filter((node: any) => node.ready).length },
  };
  const problems = pods.filter((pod: any) => pod.issue || (!pod.ready && pod.phase !== "Succeeded"));

  async function askForAdvice(pod: any) {
    setSelectedProblem(pod);
    setAdvice({ loading: true });
    try {
      const data = await apiPost<any>("/api/chat", {
        message: `Please analyze the root cause of Pod ${pod.name} based on real cluster evidence and provide concise remediation guidance. Current signal: ${pod.issue?.reason || pod.phase || "NotReady"}`,
        cluster: pod.cluster || cluster,
        cluster_id: pod.cluster_id || pod.cluster || cluster,
        namespace: pod.namespace || "default",
        deployment: pod.workload_name || pod.workload?.name || "",
        workload_type: pod.workload_kind || pod.workload?.kind || "Workload",
        severity: pod.issue?.severity || "P2",
        auto_healing_enabled: false,
      });
      setAdvice({ loading: false, data });
    } catch (error: any) { setAdvice({ loading: false, error: error.message }); }
  }

  const refresh = () => { refreshRancher(); refreshInventory(); refreshMetrics(); refreshHealth(); };
  return (
    <div className="unified-page">
      <div className="page-commandbar">
        <div className="scope-control"><span>Monitoring Scope</span><select value={cluster} onChange={(event) => setCluster(event.target.value)}><option value="all">All Clusters</option>{clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>
        <button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button>
      </div>
      <section className="kpi-grid six">
        <Kpi label="Clusters" value={cluster === "all" ? (rancher.data?.cluster_count || selectedInventory.length || 1) : 1} detail={rancher.data?.status || "local"} />
        <Kpi label="Pods" value={summary.pods?.total || 0} detail={`${summary.pods?.running || 0} Running`} />
        <Kpi label="Anomalies" value={summary.pods?.failed || problems.length || 0} detail="Not ready or running abnormally" tone={(summary.pods?.failed || problems.length) ? "danger" : "good"} />
        <Kpi label="CPU" value={`${Number(values.cpu_cores || 0).toFixed(2)} C`} detail={metrics.data?.source || "metrics"} />
        <Kpi label="Memory" value={`${(Number(values.memory_bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GiB`} detail="Working set" />
        <Kpi label="Nodes" value={summary.nodes?.total || nodes.length || 0} detail={`${summary.nodes?.ready || nodes.filter((node: any) => node.ready).length || 0} Ready`} />
      </section>
      <section className="unified-grid dashboard-grid">
        <div className="surface span-two">
          <SectionHead icon={AlertTriangle} title="Needs Attention" meta={`${problems.length}  live anomalies`} />
          {problems.length ? <div className="compact-list attention-scroll">{problems.map((pod: any) => <div className="compact-row attention-row" key={`${pod.cluster}-${pod.namespace}-${pod.name}`}><span className="resource-icon risk"><Boxes size={15} /></span><div><strong>{pod.name}</strong><small>{pod.cluster} / {pod.namespace} · {pod.issue?.reason || pod.phase || "NotReady"}</small></div><div className="attention-actions"><StatusPill status={pod.issue?.severity || "warning"} /><button className="row-icon-button" onClick={() => { setSelectedProblem(pod); setAdvice({ loading: false }); }} title="View anomaly details"><Eye size={14} /></button></div></div>)}</div> : <Empty text="No anomalous Pods were found in the current scope" />}
        </div>
        <div className="surface">
          <SectionHead icon={Activity} title="Platform Services" />
          <div className="service-matrix">{Object.entries(health.data?.services || {}).map(([name, value]: [string, any]) => <div key={name}><span>{name}</span><StatusPill status={value?.status || "unknown"} /></div>)}</div>
          {health.error && <div className="inline-error">{health.error}</div>}
        </div>
        {selectedProblem && <div className="surface span-three attention-detail">
          <SectionHead icon={Eye} title={selectedProblem.name} meta={`${selectedProblem.cluster || cluster} / ${selectedProblem.namespace || "default"}`} action={<button className="primary" onClick={() => askForAdvice(selectedProblem)} disabled={advice.loading}>{advice.loading ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}AI Guidance</button>} />
          <div className="attention-detail-grid"><div><span>Anomaly Cause</span><strong>{selectedProblem.issue?.reason || selectedProblem.phase || "NotReady"}</strong></div><div><span>Container Status</span><strong>{selectedProblem.ready ? "Ready" : "NotReady"} · restart {selectedProblem.restart_count || 0}</strong></div><div><span>Upstream Workload</span><strong>{selectedProblem.workload_kind || selectedProblem.workload?.kind || "-"}/{selectedProblem.workload_name || selectedProblem.workload?.name || "-"}</strong></div></div>
          {advice.error && <div className="inline-error">{advice.error}</div>}
          {advice.data?.answer && <div className="attention-advice"><BrainCircuit size={17} /><p>{advice.data.answer}</p></div>}
        </div>}
        <div className="surface span-three">
          <SectionHead icon={Layers3} title="Workload Health" meta={`${workloads.length} workloads`} />
          {workloads.length ? <div className="workload-strip">{workloads.slice(0, 12).map((item: any) => {
            const healthy = Number(item.ready_replicas || 0) >= Number(item.replicas || 0);
            return <div key={`${item.cluster}-${item.namespace}-${item.kind}-${item.name}`}><span>{item.kind}</span><strong>{item.name}</strong><small>{item.cluster}/{item.namespace}</small><StatusPill status={healthy ? "healthy" : "degraded"} text={`${item.ready_replicas || 0}/${item.replicas || 0}`} /></div>;
          })}</div> : <Empty text="Rancher has not returned the workload inventory yet" />}
        </div>
      </section>
    </div>
  );
}

export function ResourcesPage() {
  const [state, refresh] = useAsync<any>(() => apiGet("/api/rancher/inventory"), []);
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [kind, setKind] = useState<"pods" | "workloads" | "nodes">("pods");
  const [query, setQuery] = useState("");
  const inventory = list(state.data?.inventory);
  const clusters = list(state.data?.clusters);
  const scoped = cluster === "all" ? inventory : inventory.filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name);
  const namespaces = Array.from(new Set(scoped.flatMap((item: any) => list(item.namespaces).map((item: any) => item.name)))).sort();
  const rows = scoped.flatMap((item: any) => list(item[kind])).filter((item: any) => namespace === "all" || item.namespace === namespace).filter((item: any) => !query || JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));

  return <div className="unified-page">
    <div className="page-commandbar resource-toolbar">
      <div className="segmented"><button className={kind === "pods" ? "active" : ""} onClick={() => setKind("pods")}>Pods</button><button className={kind === "workloads" ? "active" : ""} onClick={() => setKind("workloads")}>Workloads</button><button className={kind === "nodes" ? "active" : ""} onClick={() => setKind("nodes")}>Nodes</button></div>
      <select value={cluster} onChange={(event) => { setCluster(event.target.value); setNamespace("all"); }}><option value="all">All Clusters</option>{clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select>
      {kind !== "nodes" && <select value={namespace} onChange={(event) => setNamespace(event.target.value)}><option value="all">All Namespaces</option>{namespaces.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
      <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter resources" /></label>
      <button className="ghost" onClick={refresh}><RefreshCcw size={15} /></button>
    </div>
    <div className="surface resource-surface">
      <SectionHead icon={kind === "nodes" ? ServerCog : Boxes} title={kind === "pods" ? "Pod Inventory" : kind === "workloads" ? "Workload Inventory" : "Node Inventory"} meta={`${rows.length} resources`} />
      {state.error && <div className="inline-error">{state.error}</div>}
      {rows.length ? <div className="resource-table"><div className="resource-table-head"><span>Name</span><span>Location</span><span>Type / Status</span><span>Health</span></div>{rows.slice(0, 200).map((item: any, index: number) => {
        const healthy = kind === "nodes" ? item.ready : kind === "workloads" ? Number(item.ready_replicas || 0) >= Number(item.replicas || 0) : item.ready || item.phase === "Succeeded";
        return <div className="resource-table-row" key={`${item.cluster}-${item.namespace}-${item.name}-${index}`}><div><strong>{item.name}</strong><small>{item.workload_kind && item.workload_name ? `${item.workload_kind}/${item.workload_name}` : item.kind || ""}</small></div><span>{item.cluster || "-"}<small>{item.namespace || "global"}</small></span><span>{item.kind || item.phase || "Node"}<small>{kind === "workloads" ? `${item.ready_replicas || 0}/${item.replicas || 0} ready` : item.issue?.reason || ""}</small></span><StatusPill status={healthy ? "healthy" : "degraded"} /></div>;
      })}</div> : !state.loading && <Empty text="No resources match the current filters" />}
    </div>
  </div>;
}

export function InfrastructurePage({ activeModelId = "" }: { activeModelId?: string }) {
  const [resourceType, setResourceType] = useState("all");
  const [resourceId, setResourceId] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState("");
  const [providers, refreshProviders] = useAsync<any>(() => apiGet("/api/infrastructure/providers").catch(() => ({ catalog: [], resources: [], summary: {} })), []);
  const [resources, refreshResources] = useAsync<any>(() => apiGet(`/api/infrastructure/resources?resource_type=${encodeURIComponent(resourceType)}`).catch(() => ({ resources: [] })), [resourceType]);
  const [scan, setScan] = useState<ApiState<any>>({ loading: false });
  const catalog = list(providers.data?.catalog);
  const resourceRows = list(resources.data?.resources || providers.data?.resources);
  const scopedResources = resourceType === "all" ? resourceRows : resourceRows.filter((item: any) => item.type === resourceType);
  const selectedResource = resourceRows.find((item: any) => item.id === resourceId);
  const findings = list(scan.data?.findings);
  const selectedFinding = findings.find((item: any) => item.id === selectedFindingId) || findings[0];
  const selectedPlan = selectedFinding?.ops_plan;
  const summary = scan.data?.summary || {};

  async function runScan() {
    setScan({ loading: true });
    setSelectedFindingId("");
    try {
      const data = await apiPost<any>("/api/infrastructure/scan", {
        resource_type: resourceType,
        resource_id: resourceId,
        model_profile_id: activeModelId,
        production_mode: true,
        include_probe: true,
      });
      setScan({ loading: false, data });
      const first = list(data.findings)[0];
      if (first?.id) setSelectedFindingId(first.id);
    } catch (error: any) {
      setScan({ loading: false, error: error.message });
    }
  }

  function refreshAll() {
    refreshProviders();
    refreshResources();
  }

  return <div className="unified-page infrastructure-page">
    <div className="page-commandbar infrastructure-toolbar">
      <div className="scope-control"><span>Resource Type</span><select value={resourceType} onChange={(event) => { setResourceType(event.target.value); setResourceId(""); }}><option value="all">All Infrastructure</option>{catalog.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>
      <div className="scope-control"><span>Target Resource</span><select value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">All resources of the current type</option>{scopedResources.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div>
      <button className="primary" onClick={runScan} disabled={scan.loading}>{scan.loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />}AI SRE Inspection</button>
      <button className="ghost" onClick={refreshAll}><RefreshCcw size={15} />Refresh</button>
    </div>
    <section className="kpi-grid six">
      <Kpi label="Managed Resources" value={providers.data?.summary?.total || resourceRows.length || 0} detail={providers.data?.summary?.configured ? "Provider Configured" : "Awaiting Integration"} />
      <Kpi label="Databases" value={providers.data?.summary?.by_type?.database || 0} detail="MySQL / Oracle / Redis" />
      <Kpi label="Virtual Machines" value={providers.data?.summary?.by_type?.virtual_machine || 0} detail="VMware / ECS / Linux" />
      <Kpi label="Middleware" value={providers.data?.summary?.by_type?.middleware || 0} detail="Kafka / MQ / ELK" />
      <Kpi label="Current Anomalies" value={summary.total || 0} detail={`${summary.p1 || 0} P1 · ${summary.p2 || 0} P2`} tone={summary.total ? "danger" : "good"} />
      <Kpi label="Controlled Executor" value={providers.data?.summary?.action_webhook_configured ? "Ready" : "Not Configured"} detail="External Change Webhook" tone={providers.data?.summary?.action_webhook_configured ? "good" : ""} />
    </section>
    <section className="unified-grid infrastructure-grid">
      <div className="surface">
        <SectionHead icon={CloudCog} title="Provider Catalog" meta="Full-stack resource entry points beyond K8s" />
        <div className="infra-provider-list">
          {catalog.map((item: any) => <article key={item.id}>
            <span className="resource-icon">{item.id === "database" ? <Database size={15} /> : item.id === "virtual_machine" ? <ServerCog size={15} /> : item.id === "storage" ? <HardDrive size={15} /> : <CloudCog size={15} />}</span>
            <div><strong>{item.name}</strong><p>{item.description}</p><small>{list(item.typical_actions).slice(0, 4).join(" · ")}</small></div>
          </article>)}
        </div>
      </div>
      <div className="surface span-two">
        <SectionHead icon={Layers3} title="Resource Inventory" meta={`${scopedResources.length} resources`} />
        {resources.error && <div className="inline-error">{resources.error}</div>}
        {scopedResources.length ? <div className="infra-resource-grid">{scopedResources.slice(0, 60).map((item: any) => <button className={resourceId === item.id ? "selected" : ""} key={item.id} onClick={() => setResourceId(item.id)}>
          <span className="resource-icon">{item.type === "database" ? <Database size={15} /> : item.type === "virtual_machine" ? <ServerCog size={15} /> : item.type === "storage" ? <HardDrive size={15} /> : <CloudCog size={15} />}</span>
          <div><strong>{item.name || item.id}</strong><small>{item.type} · {item.provider || item.subtype} · {item.cluster || "external"}</small><small>{item.business_service || item.owner || item.endpoint || item.host || "Not bound to a business service"}</small></div>
          <StatusPill status={item.actions_enabled ? "actions" : "read-only"} text={item.actions_enabled ? "Change Request Available" : "Read-Only Diagnosis"} />
        </button>)}</div> : <div className="infra-config-guide">
          <Database size={22} />
          <div><strong>No resources beyond K8s have been integrated yet</strong><p>After configuring <code>INFRASTRUCTURE_RESOURCES_JSON</code>, <code>DATABASE_TARGETS_JSON</code>, and <code>VM_TARGETS_JSON</code> in the ConfigMap, database, virtual machine, middleware, and storage resources will appear here automatically.</p></div>
        </div>}
      </div>
      <div className="surface">
        <SectionHead icon={AlertTriangle} title="Anomaly Queue" meta={`${findings.length} findings`} />
        {scan.error && <div className="inline-error">{scan.error}</div>}
        {scan.loading && <Empty text="Probing resources, reading metrics, and having AI SRE generate a preview" />}
        {!scan.loading && findings.length ? <div className="infra-finding-list">{findings.map((item: any) => <button className={selectedFinding?.id === item.id ? "selected" : ""} key={item.id} onClick={() => setSelectedFindingId(item.id)}>
          <StatusPill status={item.severity || "P2"} />
          <strong>{item.title}</strong>
          <small>{item.resource_type}/{item.resource_id}</small>
          <p>{item.summary}</p>
        </button>)}</div> : !scan.loading && <Empty text={providers.data?.summary?.configured ? "Click AI SRE Inspection to display anomalies and executable previews" : "Configure resource providers first, then run a full-stack inspection"} />}
      </div>
      <div className="surface span-two infra-plan-shell">
        <SectionHead icon={BrainCircuit} title="AI SRE Operations Preview" meta={selectedResource ? `${selectedResource.type}/${selectedResource.name}` : selectedPlan?.target || "waiting"} />
        {selectedPlan ? <OpsPlanPanel plan={selectedPlan} /> : <div className="infra-config-guide">
          <ShieldCheck size={22} />
          <div><strong>Execution Boundaries Are Reserved</strong><p>Real changes for databases, virtual machines, storage, and cloud resources are uniformly submitted to <code>INFRASTRUCTURE_ACTION_WEBHOOK_URL</code>. The executor handles integration with DBAs, virtualization platforms, ITSM, or enterprise scripting platforms, while this page preserves approval, audit, and recovery verification.</p></div>
        </div>}
      </div>
    </section>
  </div>;
}

export function OperationsPage() {
  const [tab, setTab] = useState<"scan" | "incidents" | "alerts" | "postmortems" | "capabilities" | "skills">("scan");
  const [cluster, setCluster] = useState("all");
  const [namespace, setNamespace] = useState("all");
  const [intent, setIntent] = useState("crashloop");
  const [severity, setSeverity] = useState("auto");
  const [scan, setScan] = useState<ApiState<any>>({ loading: false });
  const [inventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [], inventory: [] })), []);
  const [incidents, refreshIncidents] = useAsync<any>(() => apiGet("/api/incidents"), []);
  const [alerts, refreshAlerts] = useAsync<any>(() => apiGet("/api/alerts"), []);
  const [postmortems, refreshPostmortems] = useAsync<any>(() => apiGet("/api/postmortems"), []);
  const [capabilities, refreshCapabilities] = useAsync<any>(() => apiGet("/api/ops/capabilities"), []);
  const sources = { incidents: list(incidents.data?.incidents), alerts: list(alerts.data?.alerts), postmortems: list(postmortems.data?.postmortems) };
  const rows = tab === "scan" || tab === "capabilities" || tab === "skills" ? [] : sources[tab];
  const clusters = list(inventory.data?.clusters);
  const scoped = cluster === "all" ? list(inventory.data?.inventory) : list(inventory.data?.inventory).filter((item: any) => cluster === item.cluster?.id || cluster === item.cluster?.name);
  const namespaces = Array.from(new Set(scoped.flatMap((item: any) => list(item.namespaces).map((entry: any) => String(entry.name))))).sort();
  const refresh = () => { refreshIncidents(); refreshAlerts(); refreshPostmortems(); refreshCapabilities(); };
  async function runScan() {
    setScan({ loading: true });
    try { setScan({ loading: false, data: await apiPost("/api/alert/scan", { cluster, namespace, intent, severity, auto_healing_enabled: false }) }); }
    catch (error: any) { setScan({ loading: false, error: error.message }); }
  }
  return <div className="unified-page">
    <div className="page-commandbar"><div className="segmented"><button className={tab === "scan" ? "active" : ""} onClick={() => setTab("scan")}>Scan Diagnosis</button><button className={tab === "incidents" ? "active" : ""} onClick={() => setTab("incidents")}>Incidents</button><button className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>Alerts</button><button className={tab === "postmortems" ? "active" : ""} onClick={() => setTab("postmortems")}>Postmortems</button><button className={tab === "capabilities" ? "active" : ""} onClick={() => setTab("capabilities")}>Operations Tools</button><button className={tab === "skills" ? "active" : ""} onClick={() => setTab("skills")}>Skill Library</button></div><button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button></div>
    {tab === "scan" ? <div className="operations-scan-grid"><div className="surface"><SectionHead icon={Search} title="Evidence Scan" meta="Trigger AI diagnosis only after real signals are detected" /><div className="ops-scan-form"><label>Clusters<select value={cluster} onChange={(event) => { setCluster(event.target.value); setNamespace("all"); }}><option value="all">All Clusters</option>{clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label><label>Namespace<select value={namespace} onChange={(event) => setNamespace(event.target.value)}><option value="all">All Namespaces</option>{namespaces.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Anomaly Type<select value={intent} onChange={(event) => setIntent(event.target.value)}><option value="crashloop">CrashLoop / Image / OOM</option><option value="pending">Pending / Scheduling</option><option value="highcpu">High CPU</option></select></label><label>Severity<select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="auto">Auto Detect</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option></select></label><button className="primary" onClick={runScan} disabled={scan.loading}>{scan.loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />}Scan and Diagnose</button></div></div><div className="surface"><SectionHead icon={BrainCircuit} title="Diagnosis Results" meta={scan.data?.status || "waiting"} />{scan.error && <div className="inline-error">{scan.error}</div>}{scan.data ? <div className="scan-result"><StatusPill status={scan.data.status || "ok"} /><h3>{scan.data.reason || scan.data.scan?.findings?.[0]?.issue?.reason || "Scan Complete"}</h3><p>{scan.data.results?.[0]?.answer || scan.data.answer || `Checked ${scan.data.evidence?.pods_checked ?? list(scan.data.scan?.findings).length} Pods and found ${list(scan.data.scan?.findings).length} matching signals.`}</p><div className="compact-list">{list(scan.data.scan?.findings).map((item: any) => <div className="compact-row" key={`${item.cluster}-${item.namespace}-${item.name}`}><span className="resource-icon risk"><Boxes size={14} /></span><div><strong>{item.name}</strong><small>{item.cluster}/{item.namespace} · {item.issue?.reason || item.phase}</small></div><StatusPill status={scan.data.scan?.severity || "warning"} /></div>)}</div></div> : <Empty text="Select a scope and anomaly type to start scanning" />}</div></div> : tab === "capabilities" ? <div className="surface"><SectionHead icon={TerminalSquare} title="Controlled Operations Capabilities" meta={capabilities.data?.planner} /><div className="capability-grid">{list(capabilities.data?.actions).map((item: any) => <div className="capability-card" key={item.action || item.id}><span>{item.risk || "controlled"}</span><strong>{item.action || item.id || item.name}</strong><p>{item.description || item.summary || "Execute through evidence, preview, approval, and recovery verification"}</p></div>)}</div></div> : tab === "skills" ? <OpsSkillsPage /> : <div className="surface"><SectionHead icon={tab === "incidents" ? BellRing : tab === "alerts" ? AlertTriangle : FileClock} title={tab === "incidents" ? "Incident Timeline" : tab === "alerts" ? "Alert Records" : "Postmortem Reports"} meta={`${rows.length} records`} />{rows.length ? <div className="timeline-list">{rows.slice().reverse().map((item: any, index: number) => <div className="timeline-item" key={item.incident_id || item.id || index}><i /><div><div><strong>{item.title || item.alert_name || item.name || "Record"}</strong><StatusPill status={item.status || item.severity || "recorded"} /></div><p>{item.summary || item.description || item.root_cause || item.report || "Entered the audit timeline"}</p><small>{item.cluster || ""} {item.namespace || ""} · {timeText(item.created_at || item.timestamp)}</small></div></div>)}</div> : <Empty text="No records yet; new alerts and handling results will appear here automatically" />}</div>}
  </div>;
}

type SkillChoice = {
  id: string;
  label?: string;
  name?: string;
  description?: string;
  when_to_use?: string;
  operator_note?: string;
  rollback?: string;
  risk?: string;
  auto_allowed?: boolean;
  allowed_targets?: string[];
  required_evidence?: string[];
};

const fallbackSkillOptions = {
  applies_to: [
    { id: "Pod", label: "Pod", description: "A single running instance, suitable for log, restart, mount, probe, and scheduling issues." },
    { id: "Deployment", label: "Deployment", description: "A stateless workload, suitable for template, image, replica, and release issues." },
    { id: "StatefulSet", label: "StatefulSet", description: "A stateful workload that requires attention to stable identity and persistent volumes." },
    { id: "Service", label: "Service", description: "Service discovery and traffic entry, suitable for selector, port, and Endpoint issues." },
    { id: "Node", label: "Node", description: "A cluster node, suitable for pressure, NotReady, isolation, and scheduling recovery issues." },
    { id: "PVC", label: "PVC", description: "A storage claim, suitable for Pending, expansion, and binding issues." },
    { id: "Database", label: "Database", description: "A database instance or cluster, suitable for connection, slow SQL, lock, replication, capacity, and backup issues." },
    { id: "MySQL", label: "MySQL", description: "A MySQL / MariaDB instance, with focus on connection pools, replication, slow queries, and InnoDB locks." },
    { id: "Oracle", label: "Oracle", description: "An Oracle database instance, with focus on tablespaces, sessions, archiving, lock waits, and Data Guard." },
    { id: "Redis", label: "Redis", description: "A cache or in-memory database, with focus on memory, primary/replica, slow commands, expiration policies, and connection count." },
    { id: "VirtualMachine", label: "VirtualMachine", description: "A virtual machine, cloud host, or physical host, suitable for system service, disk, network, and Agent issues." },
    { id: "LinuxHost", label: "LinuxHost", description: "A Linux host, suitable for troubleshooting systemd, filesystems, the kernel, processes, and networking." },
    { id: "StorageArray", label: "StorageArray", description: "Enterprise storage or a NAS/SAN backend, suitable for capacity, path, ACL, and snapshot issues." },
  ],
  evidence_required: [
    { id: "previous_logs", label: "Previous Container Logs", description: "Prioritize reading this in CrashLoop scenarios to locate the error before the last exit." },
    { id: "events", label: "Kubernetes Events", description: "Confirm scheduling, mounting, image, probe, and admission failures." },
    { id: "workload_spec", label: "Workload Configuration", description: "Read images, probes, resources, volumes, and security context." },
    { id: "dependency_topology", label: "Dependency Topology", description: "Read the CMDB, call chains, and cross-cluster middleware data flows." },
    { id: "db_connectivity", label: "Database Connectivity", description: "Confirm the instance, listening port, account permissions, and network path." },
    { id: "db_slow_queries", label: "Slow SQL Evidence", description: "Read slow SQL, execution plans, and hot-table information." },
    { id: "db_locks", label: "Lock Waits / Long Transactions", description: "Confirm blocking sessions, lock waits, long transactions, and the impact scope." },
    { id: "db_replication", label: "Replication / HA Status", description: "Confirm primary/replica, lag, read-only mode, failover, and synchronization status." },
    { id: "db_capacity", label: "Database Capacity", description: "Check tablespaces, disk, connection count, memory, and log space." },
    { id: "vm_agent_status", label: "Host Agent Status", description: "Confirm whether monitoring, cloud assistant, virtualization Agent, or security Agent is online." },
    { id: "vm_system_metrics", label: "Host System Metrics", description: "Read CPU, memory, disk, IO, network, and file handle metrics." },
    { id: "vm_service_status", label: "System Service Status", description: "Read systemd / Windows Service status and recent errors." },
    { id: "vm_disk_usage", label: "Host Disk Usage", description: "Confirm filesystems, inodes, mount points, growth directories, and expansion capability." },
  ],
  success_criteria: [
    { id: "pod_ready", label: "Pod Ready", description: "The target Pod consistently passes readiness checks and remains stable." },
    { id: "rollout_complete", label: "Release Complete", description: "All expected replicas are available and the generation has converged." },
    { id: "restart_count_stable", label: "Stable Restart Count", description: "The restart count no longer increases within the observation window." },
    { id: "error_rate_recovered", label: "Error Rate Recovered", description: "The error rate has returned to the SLO or pre-change baseline." },
    { id: "db_connection_recovered", label: "Database Connections Recovered", description: "Business connection success rate and instance connection count have returned to a safe range." },
    { id: "db_replication_caught_up", label: "Replication Caught Up", description: "Replication lag is back within threshold and HA status is healthy." },
    { id: "db_slow_query_reduced", label: "Slow SQL Reduced", description: "Slow queries and lock waits have dropped, and critical SQL no longer blocks the business." },
    { id: "vm_agent_online", label: "Host Agent Online", description: "The monitoring, virtualization, or cloud assistant Agent is back online." },
    { id: "vm_service_active", label: "Service Running Normally", description: "Key services are active/running and business probes have recovered." },
    { id: "vm_disk_pressure_relieved", label: "Disk Pressure Relieved", description: "Disk, inode, or mount-point capacity is back within safe thresholds." },
  ],
  script_triggers: [
    { id: "symptom_matched", label: "Exact Symptom Match", description: "Logs, events, or alerts match the Skill symptom keywords." },
    { id: "required_evidence_collected", label: "Required Evidence Complete", description: "All required evidence selected for this Skill has been collected." },
    { id: "root_cause_confirmed", label: "Root Cause Confirmed", description: "Evidence scoring reached the confirmation threshold; execution does not rely on guesswork." },
    { id: "manual_confirmation", label: "Manual Approval Required", description: "Operations personnel click confirm after reviewing the impact and parameters." },
  ],
};

const fallbackActionOptions: SkillChoice[] = [
  { id: "patch_workload", label: "Modify Workload Configuration", description: "Correct images, probes, resources, replicas, environment variables, or security context.", risk: "medium", when_to_use: "Evidence confirms that a Deployment, StatefulSet, or DaemonSet template is misconfigured.", operator_note: "Show the diff before execution and allow rollback to the original template." },
  { id: "restart", label: "Rolling Restart Component", description: "Trigger a controlled rolling restart without modifying the Workload configuration.", risk: "medium", when_to_use: "Use when the configuration is correct but the process is stuck, connections have not refreshed, or the Pod needs to be restarted.", operator_note: "This will not fix bad configuration; replica and PDB safety must be confirmed." },
  { id: "scale_out", label: "Increase Replicas", description: "Increase Workload replicas within platform limits.", risk: "medium", when_to_use: "Evidence from CPU, traffic, or concurrency shows insufficient capacity.", operator_note: "Observe resource quotas and downstream dependency capacity." },
  { id: "recreate_pod", label: "Recreate Anomalous Pod", description: "Delete a single anomalous Pod and let the controller recreate it from the original template.", risk: "medium", when_to_use: "Only one Pod is in an anomalous state while the template and other replicas are healthy.", operator_note: "Not suitable for template-level or storage-level failures." },
  { id: "rollback_workload", label: "Rollback Workload", description: "Roll back to a stable image or template revision that has been observed in production.", risk: "high", when_to_use: "The fault is strongly related to a recent release and a stable rollback point exists.", operator_note: "High risk and requires manual approval." },
  { id: "create_pvc", label: "Create Missing PVC", description: "Create the missing PVC for the Workload according to the approved storage policy.", risk: "high", when_to_use: "The Workload clearly references a non-existent PVC, and capacity and access mode are confirmed.", operator_note: "The LLM must not invent a StorageClass or capacity policy." },
  { id: "create_pv", label: "Create Static PV", description: "Create a static PV from a storage-admin-approved template.", risk: "high", when_to_use: "Dynamic provisioning is unavailable and the backend path and reclaim policy are approved.", operator_note: "Never invent NFS, LUN, or directory paths." },
  { id: "patch_workload_volume", label: "Correct Volume References", description: "Correct the PVC, volume, or mount references in the Workload.", risk: "high", when_to_use: "Complete storage-chain evidence proves the original volume references are wrong.", operator_note: "A rollback point for the original configuration must be preserved." },
  { id: "patch_service", label: "Correct Service", description: "Correct selector, port, or targetPort mismatches.", risk: "high", when_to_use: "The Service has no Endpoints and evidence proves a configuration mismatch.", operator_note: "An incorrect modification can create a traffic black hole." },
  { id: "patch_service_account", label: "Correct ServiceAccount", description: "Bind the enterprise-approved imagePullSecret.", risk: "medium", when_to_use: "Image pulling fails and the approved credential reference is missing.", operator_note: "Do not read or modify Secret plaintext." },
  { id: "create_configmap", label: "Restore ConfigMap", description: "Restore the missing ConfigMap from an operations-approved template.", risk: "high", when_to_use: "The configuration referenced by the Workload is missing and an approved template exists.", operator_note: "The LLM must not generate production configuration values on its own." },
  { id: "patch_hpa", label: "Adjust HPA Range", description: "Adjust the HPA minimum and maximum replicas.", risk: "medium", when_to_use: "The HPA bounds prevent reasonable scaling while metric semantics are normal.", operator_note: "Do not modify the HPA metric algorithm." },
  { id: "expand_pvc", label: "Expand PVC", description: "Expand a bound PVC that supports online expansion.", risk: "high", when_to_use: "Volume capacity is near the limit and the StorageClass supports expansion.", operator_note: "Usually irreversible; backup and filesystem status must be verified." },
  { id: "cordon_node", label: "Cordon Node", description: "Stop scheduling new Pods onto the problematic node.", risk: "high", when_to_use: "The node clearly has pressure, is NotReady, or has a hardware fault.", operator_note: "Existing Pods will not be migrated automatically." },
  { id: "evict_pod", label: "Controlled Pod Eviction", description: "Evict Pods through the Eviction API while honoring the PDB.", risk: "high", when_to_use: "Workloads need to be migrated after node maintenance or isolation.", operator_note: "High risk and requires manual approval." },
  { id: "uncordon_node", label: "Restore Node Scheduling", description: "Return a recovered node to scheduling.", risk: "high", when_to_use: "The node is Ready, pressure is relieved, and system components are restored.", operator_note: "Health verification must be completed before restoration." },
  { id: "patch_pdb", label: "Correct PDB", description: "Correct a disruption budget that causes deadlock during rollout or eviction.", risk: "high", when_to_use: "The PDB and replica count form a deadlock and there is sufficient business-availability evidence.", operator_note: "Continuously observe available replicas and the SLO." },
  { id: "db_expand_storage", label: "Expand Database Storage", description: "Expand database tablespace or disk through the DBA/storage controlled executor.", risk: "high", when_to_use: "Database capacity evidence has reached the threshold, and backup and expansion strategy are confirmed.", operator_note: "Usually irreversible; change records and capacity approvals must be retained." },
  { id: "db_kill_session", label: "Terminate Blocking Session", description: "Terminate a database session confirmed to be blocking the business.", risk: "high", when_to_use: "Evidence for lock waits, long transactions, and session source is complete.", operator_note: "Session, SQL, business impact, and rollback notes must be shown." },
  { id: "db_failover", label: "Database Failover", description: "Trigger database failover according to the HA playbook.", risk: "high", when_to_use: "The primary database has failed or replication is abnormal, and the standby node is healthy.", operator_note: "RPO/RTO, read-only status, and failback plans must be confirmed a second time." },
  { id: "db_apply_parameter", label: "Adjust Database Parameters", description: "Adjust database runtime parameters using an approved template.", risk: "high", when_to_use: "Evidence shows that parameters are causing connection, locking, or performance faults.", operator_note: "The LLM must not invent production parameter values." },
  { id: "db_restart_instance", label: "Restart Database Instance", description: "Restart the database instance through the controlled executor.", risk: "high", when_to_use: "Use only after HA, maintenance window, backups, and impact scope are confirmed.", operator_note: "High risk and typically used only as a last resort." },
  { id: "vm_restart_service", label: "Restart Host Service", description: "Restart the specified system service on the virtual machine or host.", risk: "medium", when_to_use: "The service process is abnormal and configuration, dependencies, disk, and permissions have been confirmed.", operator_note: "The service name and recovery probe must be specified." },
  { id: "vm_expand_disk", label: "Expand Host Disk", description: "Expand the virtual disk and grow the filesystem.", risk: "high", when_to_use: "Disk or inode pressure has reached the threshold, and snapshots and mount points are confirmed.", operator_note: "An external virtualization/cloud-platform executor is required." },
  { id: "vm_reboot", label: "Reboot Virtual Machine", description: "Perform a controlled reboot of the faulty host.", risk: "high", when_to_use: "The kernel, Agent, or system services cannot recover, and business redundancy has been confirmed.", operator_note: "This must be confirmed a second time as a high-risk action." },
  { id: "middleware_rebalance", label: "Middleware Rebalance", description: "Rebalance partitions or instances for middleware such as Kafka/MQ.", risk: "high", when_to_use: "There is sufficient evidence of consumer lag, broker pressure, or abnormal partition distribution.", operator_note: "Rate limiting, a maintenance window, and rollback strategy are required." },
  { id: "storage_expand_volume", label: "Expand Storage Volume", description: "Expand the enterprise storage volume through the storage controlled executor.", risk: "high", when_to_use: "Storage pools, volumes, mappings, and business mount relationships are all verified.", operator_note: "Capacity strategy must be approved by the storage team." },
  { id: "infra_run_approved_action", label: "Execute Approved Infrastructure Action", description: "Invoke an enterprise-standard action already registered in the external executor.", risk: "high", when_to_use: "A non-K8s object requires an external platform action, and that action is registered in the enterprise executor.", operator_note: "The platform passes only structured plans and does not execute arbitrary commands." },
];

function createEmptySkillForm() {
  return {
    id: "",
    name: "",
    category: "runtime",
    summary: "",
    symptoms: "",
    applies_to: ["Pod", "Deployment", "StatefulSet", "Service"],
    evidence_required: ["previous_logs", "events", "workload_spec"],
    diagnostic_steps: "",
    allowed_actions: ["patch_workload", "recreate_pod"],
    success_criteria: ["pod_ready", "restart_count_stable"],
    risk: "medium",
    owner: "",
    script_enabled: false,
    script_id: "",
    script_trigger_conditions: ["required_evidence_collected", "root_cause_confirmed", "manual_confirmation"],
    script_trigger_description: "",
    script_timeout_seconds: 120,
  };
}

type SkillForm = ReturnType<typeof createEmptySkillForm>;

function splitSkillList(value: string) {
  return value.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean);
}

function SkillMultiSelect({
  title,
  selected,
  options,
  onChange,
  onInspect,
  hint,
}: {
  title: string;
  selected: string[];
  options: SkillChoice[];
  onChange: (value: string[]) => void;
  onInspect: (option: SkillChoice, title: string) => void;
  hint: string;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  }
  const selectedOptions = selected.map((id) => options.find((item) => item.id === id) || { id, label: id });
  return <div className="skill-multiselect">
    <div className="skill-field-title"><span>{title}</span><small>Multiple selections allowed · {selected.length} selected</small></div>
    <details>
      <summary>{selected.length ? selectedOptions.slice(0, 3).map((item) => item.label || item.name || item.id).join(", ") + (selected.length > 3 ? ` total ${selected.length} selected` : "") : hint}<ChevronRight size={14} /></summary>
      <div className="skill-option-menu">
        {options.map((option) => <div className={selected.includes(option.id) ? "selected" : ""} key={option.id}>
          <label><input type="checkbox" checked={selected.includes(option.id)} onChange={() => toggle(option.id)} /><span><b>{option.label || option.name || option.id}</b><small>{option.description || option.when_to_use || option.id}</small></span></label>
          <button type="button" onClick={() => onInspect(option, title)} title={`View ${option.label || option.id} description`}><Eye size={14} /></button>
        </div>)}
      </div>
    </details>
    <div className="skill-selected-chips">
      {selectedOptions.map((option) => <button type="button" key={option.id} onClick={() => toggle(option.id)} title="Click to remove">{option.label || option.name || option.id}<X size={11} /></button>)}
    </div>
  </div>;
}

export function OpsSkillsPage() {
  const [skills, refreshSkills] = useAsync<any>(() => apiGet("/api/ops/skills"), []);
  const [capabilities] = useAsync<any>(() => apiGet("/api/ops/capabilities"), []);
  const [form, setForm] = useState<SkillForm>(() => createEmptySkillForm());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [matchQuestion, setMatchQuestion] = useState("Pod CrashLoopBackOff, previous logs indicate permission denied, and startup fails after mounting the PVC");
  const [match, setMatch] = useState<ApiState<any>>({ loading: false });
  const [inspected, setInspected] = useState<{ title: string; option: SkillChoice } | null>(null);
  const [importing, setImporting] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const actions = (list(capabilities.data?.actions).length ? list(capabilities.data?.actions) : fallbackActionOptions) as SkillChoice[];
  const optionCatalog = capabilities.data?.skill_options || fallbackSkillOptions;
  const appliesToOptions = (list(optionCatalog.applies_to).length ? list(optionCatalog.applies_to) : fallbackSkillOptions.applies_to) as SkillChoice[];
  const evidenceOptions = (list(optionCatalog.evidence_required).length ? list(optionCatalog.evidence_required) : fallbackSkillOptions.evidence_required) as SkillChoice[];
  const successOptions = (list(optionCatalog.success_criteria).length ? list(optionCatalog.success_criteria) : fallbackSkillOptions.success_criteria) as SkillChoice[];
  const scriptTriggerOptions = (list(optionCatalog.script_triggers).length ? list(optionCatalog.script_triggers) : fallbackSkillOptions.script_triggers) as SkillChoice[];
  const approvedScripts = list(capabilities.data?.approved_scripts) as SkillChoice[];
  const selectedScript = approvedScripts.find((item) => item.id === form.script_id);

  function update<K extends keyof SkillForm>(key: K, value: SkillForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function inspectOption(option: SkillChoice, title: string) {
    setInspected({ title, option });
  }

  function editSkill(skill: any) {
    const scriptPolicy = skill.script_policy || {};
    setForm({
      id: skill.id || "",
      name: skill.name || "",
      category: skill.category || "runtime",
      summary: skill.summary || "",
      symptoms: list(skill.symptoms).join("\n"),
      applies_to: list(skill.applies_to),
      evidence_required: list(skill.evidence_required),
      diagnostic_steps: list(skill.diagnostic_steps).join("\n"),
      allowed_actions: list(skill.allowed_actions),
      success_criteria: list(skill.success_criteria),
      risk: skill.risk || "medium",
      owner: skill.owner || "",
      script_enabled: Boolean(scriptPolicy.enabled),
      script_id: scriptPolicy.script_id || "",
      script_trigger_conditions: list(scriptPolicy.trigger_conditions),
      script_trigger_description: scriptPolicy.trigger_description || "",
      script_timeout_seconds: Number(scriptPolicy.timeout_seconds || 120),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveSkill() {
    setSaving(true);
    setMessage("");
    try {
      await apiPost("/api/ops/skills", {
        id: form.id,
        name: form.name,
        category: form.category,
        summary: form.summary,
        symptoms: splitSkillList(form.symptoms),
        applies_to: form.applies_to,
        evidence_required: form.evidence_required,
        diagnostic_steps: splitSkillList(form.diagnostic_steps),
        allowed_actions: form.allowed_actions,
        success_criteria: form.success_criteria,
        risk: form.risk,
        owner: form.owner,
        script_policy: {
          enabled: form.script_enabled,
          script_id: form.script_enabled ? form.script_id : "",
          trigger_conditions: form.script_enabled ? form.script_trigger_conditions : [],
          trigger_description: form.script_enabled ? form.script_trigger_description : "",
          timeout_seconds: form.script_timeout_seconds,
          require_confirmation: true,
        },
      });
      setForm(createEmptySkillForm());
      setMessage("Skill saved. It will participate in automatic matching for SRE chat and AI inspection.");
      refreshSkills();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function disableSkill(skill: any) {
    setMessage("");
    try {
      await apiPost(`/api/ops/skills/${encodeURIComponent(skill.id)}/delete`, {});
      setMessage(skill.builtin ? "Built-in Skill disabled." : "Custom Skill deleted.");
      refreshSkills();
    } catch (error: any) {
      setMessage(error.message);
    }
  }

  async function testMatch() {
    setMatch({ loading: true });
    try {
      setMatch({ loading: false, data: await apiPost("/api/ops/skills/match", { question: matchQuestion, top_k: 5 }) });
    } catch (error: any) {
      setMatch({ loading: false, error: error.message });
    }
  }

  async function importSkill(file?: File) {
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/ops/skills/import", { method: "POST", body, headers: adminAuthHeaders({ Accept: "application/json" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `${response.status} ${response.statusText}`);
      invalidateApiCache("/api/ops/skills");
      invalidateApiCache("/api/ops/capabilities");
      setMessage(data.message || `Imported ${list(data.imported).length} standard Agent Skills.`);
      refreshSkills();
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setImporting(false);
      if (importInput.current) importInput.current.value = "";
    }
  }

  function exportSkill(skill: any) {
    window.location.assign(`/api/ops/skills/${encodeURIComponent(skill.id)}/export`);
  }

  return <div className="skill-workbench">
    <div className="surface">
      <SectionHead icon={BrainCircuit} title="Operations Skill Injection" meta="Saving generates a standard SKILL.md for reuse across agents" action={<div className="skill-head-actions"><input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => importSkill(event.target.files?.[0])} /><button className="ghost" onClick={() => importInput.current?.click()} disabled={importing}>{importing ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}Import Skill</button><button className="ghost" onClick={refreshSkills}><RefreshCcw size={15} />Refresh</button></div>} />
      <div className="skill-form">
        <label>Skill Name<input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="For example: PVC Pending Static PV Recovery" /></label>
        <label>Category<select value={form.category} onChange={(event) => update("category", event.target.value)}><option value="runtime">Runtime</option><option value="database">Databases</option><option value="virtual_machine">Virtual Machines / Hosts</option><option value="middleware">Middleware</option><option value="storage">Storage</option><option value="network">Network</option><option value="release">Release</option><option value="security">Security</option><option value="cloud">Cloud Resources</option><option value="custom">Custom</option></select></label>
        <label>Risk<select value={form.risk} onChange={(event) => update("risk", event.target.value)}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
        <label>Owner<input value={form.owner} onChange={(event) => update("owner", event.target.value)} placeholder="Team or name" /></label>
        <label className="span-two">One-Line Description<textarea value={form.summary} onChange={(event) => update("summary", event.target.value)} placeholder="What scenario does this experience solve, and when should AI consider it? It can apply to K8s, databases, virtual machines, storage, or middleware." /></label>
        <label>Symptom Keywords<textarea value={form.symptoms} onChange={(event) => update("symptoms", event.target.value)} placeholder="One per line, for example: FailedMount, permission denied, ImagePullBackOff, tablespace full, lock waits, host disk full" /></label>
        <label>Diagnostic Steps<textarea value={form.diagnostic_steps} onChange={(event) => update("diagnostic_steps", event.target.value)} placeholder="Write these according to the real operations workflow, one step per line." /></label>
        <SkillMultiSelect title="Applicable Objects" selected={form.applies_to} options={appliesToOptions} onChange={(value) => update("applies_to", value)} onInspect={inspectOption} hint="Choose K8s, database, virtual machine, middleware, storage, or cloud resource objects" />
        <SkillMultiSelect title="Required Evidence" selected={form.evidence_required} options={evidenceOptions} onChange={(value) => update("evidence_required", value)} onInspect={inspectOption} hint="Choose the real evidence that must be read before execution" />
        <SkillMultiSelect title="Allowed Actions" selected={form.allowed_actions} options={actions} onChange={(value) => update("allowed_actions", value)} onInspect={inspectOption} hint="Choose controlled actions that pass platform gating" />
        <SkillMultiSelect title="Recovery Criteria" selected={form.success_criteria} options={successOptions} onChange={(value) => update("success_criteria", value)} onInspect={inspectOption} hint="Choose how to determine objectively that the issue has been resolved" />
        <div className="skill-script-policy span-two">
          <div className="skill-script-header">
            <div><ShieldCheck size={16} /><span><strong>Enterprise-Approved Script</strong><small>Optional capability; the script body itself does not become part of the Skill</small></span></div>
            <label className="skill-toggle"><input type="checkbox" checked={form.script_enabled} onChange={(event) => update("script_enabled", event.target.checked)} /><i /><span>{form.script_enabled ? "Allow as a Candidate" : "Do Not Use Script"}</span></label>
          </div>
          {form.script_enabled && <div className="skill-script-body">
            <label>Approved Script<select value={form.script_id} onChange={(event) => update("script_id", event.target.value)}>
              <option value="">Choose a script registered in the ConfigMap</option>
              {approvedScripts.filter((item: any) => item.enabled !== false).map((item) => <option key={item.id} value={item.id}>{item.name || item.id} · {item.risk || "high"}</option>)}
            </select></label>
            <div className="script-inspect">
              <button type="button" className="ghost tiny" disabled={!selectedScript} onClick={() => selectedScript && inspectOption(selectedScript, "Enterprise-Approved Script")}><Eye size={13} />View Script Description</button>
              {!approvedScripts.length && <small>OPS_APPROVED_SCRIPTS_JSON is not configured yet, so script mode cannot be saved.</small>}
            </div>
            <SkillMultiSelect title="Script Trigger Conditions" selected={form.script_trigger_conditions} options={scriptTriggerOptions} onChange={(value) => update("script_trigger_conditions", value)} onInspect={inspectOption} hint="Choose trigger thresholds that must be met simultaneously" />
            <label>Maximum Execution Time<select value={form.script_timeout_seconds} onChange={(event) => update("script_timeout_seconds", Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>60 seconds</option><option value={120}>120 seconds</option><option value={300}>300 seconds</option><option value={600}>600 seconds</option></select></label>
            <label className="span-two">Specific Trigger Scenario<textarea value={form.script_trigger_description} onChange={(event) => update("script_trigger_description", event.target.value)} placeholder="For example: allow this script only when a Pod has entered CrashLoop three times in a row, the previous log clearly shows permission denied, the PVC is already Bound, and the securityContext does not match the storage directory permissions; a user description alone must not trigger it." /></label>
            <div className="skill-script-guard span-two"><ShieldCheck size={15} /><span>Scripts must first be registered in the approved ConfigMap catalog. Even after a Skill match, the script is only a candidate and still requires complete evidence, impact-scope checks, human approval, timeout control, and execution auditing.</span></div>
          </div>}
        </div>
        {inspected && <div className="skill-info-panel span-two">
          <header><div><Eye size={15} /><span><small>{inspected.title}</small><strong>{inspected.option.label || inspected.option.name || inspected.option.id}</strong></span></div><button type="button" onClick={() => setInspected(null)} title="Close description"><X size={16} /></button></header>
          <p>{inspected.option.description || inspected.option.when_to_use || "No detailed description available yet."}</p>
          <div>
            {inspected.option.when_to_use && <span><b>When to Use</b>{inspected.option.when_to_use}</span>}
            {inspected.option.operator_note && <span><b>Operator Note</b>{inspected.option.operator_note}</span>}
            {inspected.option.risk && <span><b>Risk Level</b>{inspected.option.risk}</span>}
            {typeof inspected.option.auto_allowed === "boolean" && <span><b>Automatic Execution</b>{inspected.option.auto_allowed ? "Allowed When Gates Pass" : "Manual Approval Required"}</span>}
            {inspected.option.rollback && <span><b>Rollback Method</b>{inspected.option.rollback}</span>}
            {list(inspected.option.allowed_targets).length > 0 && <span><b>Allowed Targets</b>{list(inspected.option.allowed_targets).join(", ")}</span>}
            {list(inspected.option.required_evidence).length > 0 && <span><b>Pre-Script Evidence</b>{list(inspected.option.required_evidence).join(", ")}</span>}
          </div>
        </div>}
        <div className="skill-portability-note span-two"><Workflow size={15} /><span><strong>Compatible with the Open Agent Skills Specification</strong><small>The platform generates SKILL.md, agents/openai.yaml, and references/ops-policy.yaml; existing evidence gates and execution approvals remain unchanged.</small></span></div>
        <button className="primary span-two" onClick={saveSkill} disabled={saving || !form.name.trim()}>{saving ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}Save and Generate Skill Package</button>
        {message && <div className={/(?:\u5df2|saved|imported|disabled|deleted|delivered)/i.test(message) ? "success-box span-two" : "inline-error span-two"}>{message}</div>}
      </div>
    </div>
    <div className="surface">
      <SectionHead icon={Search} title="Match Test" meta="Simulate how AI selects expert knowledge" />
      <div className="skill-match-box">
        <textarea value={matchQuestion} onChange={(event) => setMatchQuestion(event.target.value)} />
        <button className="primary" onClick={testMatch} disabled={match.loading}>{match.loading ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}Test Match</button>
      </div>
      {match.error && <div className="inline-error">{match.error}</div>}
      <div className="skill-match-list">
        {list(match.data?.matches).map((item: any) => <div className="skill-card matched" key={item.skill?.id}><span>{Math.round(Number(item.confidence || 0) * 100)}%</span><strong>{item.skill?.name}</strong><p>{item.why}</p><small>{list(item.matched_terms).slice(0, 8).join(" / ")}</small></div>)}
      </div>
    </div>
    <div className="surface span-two">
      <SectionHead icon={TerminalSquare} title="Skill Library" meta={`${skills.data?.summary?.enabled || 0}/${skills.data?.summary?.total || 0} enabled · ${skills.data?.summary?.portable || 0} portable`} />
      {skills.error && <div className="inline-error">{skills.error}</div>}
      <div className="skill-grid">
        {list(skills.data?.skills).map((skill: any) => <article className={`skill-card ${skill.enabled ? "" : "disabled"}`} key={skill.id}>
          <div><span>{skill.category} · {skill.risk} · v{skill.version || "1.0.0"}</span><strong>{skill.name}</strong></div>
          <p>{skill.summary}</p>
          <div className="chips">{list(skill.allowed_actions).slice(0, 4).map((item: any) => <span key={item}>{item}</span>)}</div>
          {skill.script_policy?.enabled && <div className="skill-script-badge"><TerminalSquare size={13} /><span>Approved Script: {skill.script_policy.script_id}</span></div>}
          <footer><small>{skill.builtin ? "Built-in" : "Custom"} · {skill.owner || "operator"} · {skill.execution_ready ? "Executable Mapping" : "Instruction-Based"}</small><div><button className="ghost tiny" onClick={() => exportSkill(skill)} title="Export Standard Agent Skill ZIP"><Download size={13} />Export</button><button className="ghost tiny" onClick={() => editSkill(skill)}>Edit</button><button className="ghost tiny" onClick={() => disableSkill(skill)}>{skill.builtin ? "Disable" : "Delete"}</button></div></footer>
        </article>)}
      </div>
    </div>
  </div>;
}

function flatten(value: any, prefix = "", rows: Array<{ label: string; value: string }> = []) {
  if (rows.length >= 9) return rows;
  if (Array.isArray(value)) { rows.push({ label: prefix || "items", value: value.length ? value.slice(0, 3).map((item) => Array.isArray(item) ? item.join(" → ") : typeof item === "object" ? Object.values(item).join(" · ") : String(item)).join("; ") : "0 items" }); return rows; }
  if (value && typeof value === "object") { Object.entries(value).forEach(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key, rows)); return rows; }
  if (prefix) rows.push({ label: prefix.split(".").pop()!.replaceAll("_", " "), value: value === undefined || value === null || value === "" ? "-" : String(value) });
  return rows;
}

export function AlgorithmsPage() {
  const [state, refresh] = useAsync<any>(() => apiGet("/api/algorithms/workbench"), []);
  const cases = list(state.data?.cases);
  const decisions = list(state.data?.recent_decisions);
  return <div className="unified-page"><div className="page-commandbar"><div className="quiet-note"><BrainCircuit size={15} />Algorithms are shown only in real decision chains, not as static concept displays</div><button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button></div>
    <div className="algorithm-overview">{list(state.data?.module_map).map((item: any, index: number) => <div className="algorithm-stage" key={item.algorithm}><span>0{index + 1}</span><div><strong>{item.module}</strong><small>{item.algorithm}</small></div><ChevronRight size={16} /><p>{item.effect}</p></div>)}</div>
    {cases.length ? <div className="algorithm-case-grid">{cases.map((item: any) => <div className="surface algorithm-case" key={item.id}><SectionHead icon={Workflow} title={item.title} meta={item.where_used} /><div className="decision-flow"><div><span>Input Evidence</span>{flatten(item.input).map((row) => <b key={row.label}>{row.label}<small>{row.value}</small></b>)}</div><i>→</i><div className="algorithm-core"><BrainCircuit size={22} /><strong>{item.algorithm}</strong></div><i>→</i><div><span>Decision Output</span>{flatten(item.output).map((row) => <b key={row.label}>{row.label}<small>{row.value}</small></b>)}</div></div><p className="algorithm-effect">{item.action_effect}</p></div>)}</div> : <div className="surface"><Empty text="After you run an inspection, topology analysis, or change gate, real algorithm samples will appear here" /></div>}
    <div className="surface"><SectionHead icon={FileClock} title="Decision Audit" meta={`${decisions.length} decisions`} />{decisions.length ? <div className="audit-grid">{decisions.slice(0, 12).map((item: any, index: number) => <div key={`${item.timestamp}-${index}`}><StatusPill status="recorded" text={item.algorithm} /><strong>{item.used_by}</strong><p>{item.action_effect}</p><small>{timeText(item.timestamp)}</small></div>)}</div> : <Empty text="No algorithm audit records yet" />}</div>
  </div>;
}

export function SignalsPage() {
  const [cluster, setCluster] = useState("all");
  const [inventory] = useAsync<any>(() => apiGet("/api/rancher/inventory").catch(() => ({ clusters: [] })), []);
  const [metrics, refreshMetrics] = useAsync<any>(() => apiGet(`/api/prometheus/summary?cluster=${encodeURIComponent(cluster)}`), [cluster]);
  const [llm, refreshLlm] = useAsync<any>(() => apiGet("/api/llm-observability?limit=200"), []);
  const [integrations, refreshIntegrations] = useAsync<any>(() => apiGet("/api/integrations"), []);
  const [logs, setLogs] = useState<ApiState<any>>({ loading: false });
  const [traces, setTraces] = useState<ApiState<any>>({ loading: false });
  const [logQuery, setLogQuery] = useState('{namespace=~".+"}');
  const [traceService, setTraceService] = useState("");
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const values = metrics.data?.values || {};
  const summary = llm.data?.summary || {};
  const analytics = llm.data?.analytics || {};
  const weekly = analytics.weekly_analysis || {};
  const langfuse = llm.data?.langfuse || {};
  const clusters = list(inventory.data?.clusters);
  const sources = list(integrations.data?.items).filter((item: any) => item.category === "observability");
  async function queryLogs() {
    setLogs({ loading: true });
    try { setLogs({ loading: false, data: await apiPost("/api/observability/logs", { query: logQuery, limit: 80 }) }); } catch (error: any) { setLogs({ loading: false, error: error.message }); }
  }
  async function queryTraces() {
    setTraces({ loading: true });
    try { setTraces({ loading: false, data: await apiGet(`/api/observability/traces?service=${encodeURIComponent(traceService)}&limit=30`) }); } catch (error: any) { setTraces({ loading: false, error: error.message }); }
  }
  const refresh = () => { refreshMetrics(); refreshLlm(); refreshIntegrations(); };
  const maxDailyTokens = Math.max(1, ...list(analytics.daily_usage).map((item: any) => Number(item.tokens || 0)));
  return <div className="unified-page"><div className="page-commandbar"><div className="scope-control"><span>Metrics scope</span><select value={cluster} onChange={(event) => setCluster(event.target.value)}><option value="all">All Clusters</option>{clusters.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></div><button className="ghost" onClick={refresh}><RefreshCcw size={15} />Refresh</button></div>
    <section className="kpi-grid six"><Kpi label="CPU" value={`${Number(values.cpu_cores || 0).toFixed(2)} C`} detail={metrics.data?.source || "Prometheus"} /><Kpi label="Memory" value={`${(Number(values.memory_bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GiB`} detail="working set" /><Kpi label="Restarts / 1h" value={values.pod_restarts_1h || 0} /><Kpi label="LLM Calls" value={summary.total || 0} detail={`${summary.failures || 0} failed`} /><Kpi label="Token" value={compactNumber(summary.total_tokens)} detail={`$${Number(summary.estimated_cost_usd || 0).toFixed(4)} · ${compactNumber(summary.input_tokens)} in`} /><Kpi label="P95" value={`${summary.p95_latency_ms || 0} ms`} detail={`${summary.throughput_per_min || 0} req/min`} /></section>
    <section className="unified-grid signals-grid">
      <div className="surface span-two"><SectionHead icon={Activity} title="Signal Sources" meta="Metrics · Logs · Traces · LLM" /><div className="integration-strip">{sources.map((item: any) => <div key={item.id}><span className="resource-icon"><Database size={15} /></span><div><strong>{item.name}</strong><small>{item.capability}</small></div><StatusPill status={item.status} /></div>)}</div></div>
      <div className="surface"><SectionHead icon={Gauge} title="Model Call Distribution" /><div className="mini-bars">{list(analytics.by_model).slice(0, 7).map((item: any) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${Math.min(100, Number(item.calls || 0) * 10)}%` }} /></i><strong>{item.calls || 0}</strong></div>)}</div></div>
      <div className="surface span-three langfuse-lens"><SectionHead icon={GitBranch} title="Langfuse Black-Box Breakdown" meta={`${summary.langfuse_traces || 0} traces · ${langfuse.active ? "active" : langfuse.configured ? "configured" : "not configured"}`} /><div className="langfuse-chain">{["User", "Session", "Trace", "Generation", "Tool Call", "Score"].map((item) => <div key={item}><span>{item}</span><small>{item === "User" ? "Operator / Alert" : item === "Session" ? "Incident / Inspection" : item === "Trace" ? "SRE Workflow" : item === "Generation" ? "LLM Tokens" : item === "Tool Call" ? "MCP / Healing" : "Quality Eval"}</small></div>)}</div><div className="quality-strip">{list(analytics.quality_scores).length ? list(analytics.quality_scores).map((item: any) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${Math.round(Number(item.avg || 0) * 100)}%` }} /></i><strong>{Math.round(Number(item.avg || 0) * 100)}</strong></div>) : <Empty text="Langfuse quality scores will appear after running SRE chat or an inspection" />}</div></div>
      <div className="surface span-two"><SectionHead icon={LineChart} title="Daily Token Usage" meta={`${weekly.observed_days || 0} observed days`} /><div className="usage-chart">{list(analytics.daily_usage).length ? list(analytics.daily_usage).map((item: any) => <div key={item.date}><div><i style={{ height: `${Math.max(4, Number(item.tokens || 0) / maxDailyTokens * 100)}%` }} /></div><strong>{compactNumber(item.tokens)}</strong><span>{item.date?.slice(5)}</span></div>) : <Empty text="The daily Token chart appears after LLM calls are generated" />}</div></div>
      <div className="surface"><SectionHead icon={BrainCircuit} title="Weekly Usage Forecast" /><div className="weekly-forecast"><div><span>Without Automatic Inspection</span><strong>{compactNumber(weekly.weekly_tokens_without_auto_inspection)}</strong></div><div><span>With Automatic Inspection</span><strong>{compactNumber(weekly.weekly_tokens_with_auto_inspection)}</strong></div><p>Every {weekly.inspection_interval_minutes || 30} minutes of inspection is expected to add {compactNumber(weekly.auto_inspection_extra_tokens)} Token / week</p></div></div>
      <div className="surface"><SectionHead icon={Workflow} title="LLM Data Flow" /><div className="flow-list">{list(analytics.data_flows).map((item: any, index: number) => <div key={item.name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.name}</strong><small>{item.count} calls</small></div>)}</div></div>
      <div className="surface span-two"><SectionHead icon={FileClock} title="Call Audit" meta={`${summary.shown || 0} shown`} /><div className="call-table"><div><span>Time</span><span>Source / Model</span><span>Latency</span><span>Status</span><span /></div>{list(llm.data?.items).slice(0, 80).map((item: any) => <button key={item.id} onClick={() => setSelectedCall(item)}><span>{timeText(item.timestamp)}</span><span>{item.source}<small>{item.llm?.model_profile_id || item.llm?.model}{item.trace_id ? ` · ${String(item.trace_id).slice(0, 10)}` : ""}</small></span><span>{item.latency_ms || 0} ms</span><StatusPill status={item.status || "unknown"} /><Eye size={14} /></button>)}</div></div>
      {selectedCall && <div className="surface span-three"><SectionHead icon={Eye} title="Call Details" meta={selectedCall.id} action={<button className="ghost tiny" onClick={() => setSelectedCall(null)}>Close</button>} /><div className="call-detail-grid"><div><span>Input Scope</span><pre>{JSON.stringify(selectedCall.metadata || selectedCall.input, null, 2)}</pre></div><div><span>Agent Chain</span><pre>{JSON.stringify(selectedCall.chain || [], null, 2)}</pre></div><div><span>Output Summary</span><pre>{JSON.stringify(selectedCall.output || {}, null, 2)}</pre></div></div></div>}
      <div className="surface span-three"><SectionHead icon={HardDrive} title="Log Query" meta="Restricted LogQL with read-only access to Loki" /><div className="querybar"><input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} /><button className="primary" onClick={queryLogs} disabled={logs.loading}>{logs.loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />}Query</button></div>{logs.error && <div className="inline-error">{logs.error}</div>}{list(logs.data?.streams).length ? <div className="log-view">{list(logs.data.streams).flatMap((stream: any) => list(stream.values).map((value: any[], index: number) => <div key={`${value[0]}-${index}`}><span>{value[0]}</span><code>{value[1]}</code></div>)).slice(0, 120)}</div> : <Empty text="After configuring Loki, you can search correlated logs here; no data is fabricated when it is not connected" />}</div>
      <div className="surface span-three"><SectionHead icon={GitBranch} title="Trace Query" meta="Tempo / TraceQL backend" /><div className="querybar"><input value={traceService} onChange={(event) => setTraceService(event.target.value)} placeholder="service.name, or leave blank to view recent traces" /><button className="primary" onClick={queryTraces} disabled={traces.loading}>{traces.loading ? <Loader2 className="spin" size={15} /> : <Search size={15} />}Query</button></div>{traces.error && <div className="inline-error">{traces.error}</div>}{list(traces.data?.traces).length ? <div className="trace-list">{list(traces.data.traces).map((trace: any, index: number) => <div key={trace.traceID || index}><strong>{trace.rootServiceName || trace.serviceName || "trace"}</strong><code>{trace.traceID}</code><span>{trace.durationMs || trace.duration || "-"} ms</span></div>)}</div> : <Empty text="After configuring Tempo and sending OTLP Traces, you can search correlated call chains here" />}</div>
    </section>
  </div>;
}

export function IntegrationsPage() {
  const [state, refresh] = useAsync<any>(() => apiGet("/api/integrations"), []);
  const [cloud] = useAsync<any>(() => apiGet("/api/cloud/adapters"), []);
  const [testing, setTesting] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const groups = [
    ["infrastructure", "Infrastructure", Network],
    ["observability", "Observability", Activity],
    ["collaboration", "Collaboration Channels", MessageSquareText],
    ["ai", "AI and Knowledge", BrainCircuit],
  ] as const;
  async function testChannel(channel: string) {
    setTesting(channel); setFeedback(null);
    try {
      await apiPost("/api/integrations/notify/test", { channel });
      setFeedback({ tone: "ok", text: `${channel} test notification delivered` });
    } catch (error: any) {
      setFeedback({ tone: "warn", text: error.message });
    } finally { setTesting(""); }
  }
  const cloudAdapters = list(cloud.data?.available || cloud.data?.adapters);
  return <div className="unified-page"><div className="page-commandbar"><div className="quiet-note"><ShieldCheck size={15} />Credentials are managed by K8s Secrets; the frontend shows only health status</div>{feedback && <span className={`channel-feedback ${feedback.tone}`}>{feedback.text}</span>}<button className="ghost" onClick={refresh}><RefreshCcw size={15} />Check</button></div>
    <div className="integration-groups">{groups.map(([id, title, Icon]) => <section className="surface" key={id}><SectionHead icon={Icon} title={title} /><div className="integration-cards">{list(state.data?.items).filter((item: any) => item.category === id).map((item: any) => <div key={item.id}><span className="resource-icon"><CloudCog size={16} /></span><div><strong>{item.name}</strong><p>{item.capability}</p><small>{item.configuration_hint}</small></div><div className="integration-actions"><StatusPill status={item.status} />{id === "collaboration" && item.status === "configured" && <button className="channel-test" onClick={() => testChannel(item.id)} disabled={testing === item.id} title={`Send ${item.name} test notification`}>{testing === item.id ? <Loader2 className="spin" size={13} /> : <Send size={13} />}</button>}</div></div>)}</div></section>)}</div>
    <section className="surface"><SectionHead icon={GitBranch} title="Cloud Resource Adapters" meta="Rancher · Generic CSI Storage · Virtualization Platform · Public Cloud" /><div className="capability-grid">{cloudAdapters.length ? cloudAdapters.map((item: any) => <div className="capability-card" key={item.id || item.provider}><span>{item.enabled ? "enabled" : "available"}</span><strong>{item.display_name || item.name || item.provider}</strong><p>{list(item.capabilities).join(" · ") || item.description}</p><small>{item.auth_mode} · {item.inventory_scope}</small></div>) : <Empty text="Use CLOUD_ADAPTERS_JSON to integrate Alibaba Cloud, generic CSI storage, virtualization platforms, or other cloud adapters" />}</div></section>
    <section className="surface"><SectionHead icon={CheckCircle2} title="Capability Coverage" meta="Aligned with capabilities already released in OnGrid while preserving Flawless differentiation" /><div className="coverage-table"><div><strong>Capability</strong><strong>This System</strong><strong>Description</strong></div>{list(state.data?.coverage).map((item: any) => <div key={item.capability}><span>{item.capability}</span><StatusPill status={item.status} /><small>{item.detail}</small></div>)}</div></section>
  </div>;
}

type AssistantMessage = {
  role: "user" | "assistant";
  text: string;
  at: number;
  page?: string;
  domain?: "app" | "ops";
  sourceCount?: number;
};

const ASSISTANT_OPS_PATTERN = /pod|k8s|kubernetes|fault|troubleshoot|cluster|network|storage|alert|repair|inspection|topology|prometheus|cmdb|rancher|namespace|workload|deployment|statefulset|\u6545\u969c|\u6392\u969c|\u96c6\u7fa4|\u7f51\u7edc|\u5b58\u50a8|\u544a\u8b66|\u4fee\u590d|\u5de1\u68c0|\u62d3\u6251/i;

function assistantSuggestions(page: string) {
  if (page.includes("SRE")) return ["How can this diagnosis be executed safely?", "Help me turn the answer into action steps", "What should I do next if the fix fails?"];
  if (page.includes("Inspection")) return ["How can I view only newly added risks?", "What hidden risks are checked in production mode?", "How do I enable human-approved remediation?"];
  if (page.includes("Topology")) return ["How do I understand the impact scope?", "Explain the critical path and amplification factor", "Where can I view the Kafka/ELK data flow?"];
  if (page.includes("Model")) return ["How do I integrate an OAuth model?", "How do I compare model operations capabilities?", "How do I run a shadow evaluation?"];
  if (page.includes("Knowledge")) return ["How should Runbooks be accumulated?", "What is the difference between product knowledge and operations knowledge?", "How do I make the assistant use this knowledge?"];
  return ["How do I use this page?", "Recommend the next step for me", "Where should I look first when an anomaly occurs?"];
}

function assistantDomain(question: string, page: string): "app" | "ops" {
  return ASSISTANT_OPS_PATTERN.test(`${page}\n${question}`) ? "ops" : "app";
}

export function AssistantDock({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem("luxyai-unified-assistant") || "[]"); } catch { return []; }
  });
  const suggestions = useMemo(() => assistantSuggestions(page), [page]);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => { localStorage.setItem("luxyai-unified-assistant", JSON.stringify(messages.slice(-40))); requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }); }, [messages]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  async function ask(override?: string) {
    const question = (override || input).trim();
    if (!question || loading) return;
    setInput(""); setOpen(true); setLoading(true);
    const domain = assistantDomain(question, page);
    setMessages((current) => [...current, { role: "user", text: question, at: Date.now(), page, domain }]);
    try {
      const data = await apiPost<any>("/api/knowledge/ask", {
        question: `Current page: ${page}\nUser question: ${question}`,
        domain,
        include_principle: /(?:\u539f\u7406|\u673a\u5236|\u4e3a\u4ec0\u4e48|principle|mechanism|why)/i.test(question),
      });
      setMessages((current) => [...current, { role: "assistant", text: data.answer || "No answer was retrieved.", at: Date.now(), page, domain, sourceCount: list(data.sources).length }]);
    } catch (error: any) {
      setMessages((current) => [...current, { role: "assistant", text: `The assistant is temporarily unavailable: ${error.message}`, at: Date.now(), page, domain }]);
    } finally { setLoading(false); }
  }
  return <>
    <button className="assistant-launcher" onClick={() => setOpen(true)} title="Open Flawless Assistant"><Bot size={19} /><span>Assistant</span><kbd>⌘K</kbd></button>
    <aside className={`assistant-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <header>
        <div><span className="assistant-mark"><Bot size={18} /></span><div><strong>Flawless Assistant</strong><small>Current page: {page}</small></div></div>
        <div className="assistant-header-actions">
          <button onClick={() => setMessages([])} title="Clear conversation"><RefreshCcw size={15} /></button>
          <button onClick={() => setOpen(false)} title="Close"><X size={18} /></button>
        </div>
      </header>
      <div className="assistant-context">
        <span><BrainCircuit size={14} />Knowledge Base Route</span>
        <strong>{ASSISTANT_OPS_PATTERN.test(page) ? "Operations Runbook" : "Product Usage + Operations RAG"}</strong>
      </div>
      <div className="assistant-suggestions">
        {suggestions.map((item) => <button key={item} onClick={() => ask(item)} disabled={loading}>{item}</button>)}
      </div>
      <div className="assistant-messages" ref={scroller}>
        {messages.length ? messages.map((item, index) => <div className={`assistant-message ${item.role}`} key={`${item.at}-${index}`}>
          <span>{item.role === "assistant" ? "Flawless" : "You"}{item.page ? ` · ${item.page}` : ""}{item.domain ? ` · ${item.domain === "ops" ? "Operations Knowledge" : "Product Knowledge"}` : ""}</span>
          <p>{item.text}</p>
          {item.role === "assistant" && typeof item.sourceCount === "number" && <small>{item.sourceCount} knowledge snippets contributed to this answer</small>}
        </div>) : <div className="assistant-welcome"><BrainCircuit size={24} /><strong>How can I help you use this system?</strong><p>I will combine the current page, the product knowledge base, and the operations Runbook to suggest the next step.</p></div>}
        {loading && <div className="assistant-thinking"><i /><i /><i />Searching the knowledge base</div>}
      </div>
      <footer>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="Ask about product usage, the operations Runbook, or the next step on this page" />
        <button onClick={() => ask()} disabled={loading || !input.trim()}><Send size={16} /></button>
      </footer>
    </aside>
    {open && <button className="assistant-backdrop" onClick={() => setOpen(false)} aria-label="Close assistant overlay" />}
  </>;
}
