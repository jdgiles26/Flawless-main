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
  { key: "chat", label: "SRE 对话", group: "核心", icon: MessageSquareText },
  { key: "inspection", label: "AI 巡检", group: "核心", icon: Search },
  { key: "topology", label: "拓扑影响", group: "核心", icon: Network },
  { key: "dashboard", label: "运行总览", group: "运维闭环", icon: LayoutDashboard },
  { key: "opsHub", label: "资源事件", group: "运维闭环", icon: PackageSearch },
  { key: "skills", label: "Skill 库", group: "运维闭环", icon: BrainCircuit },
  { key: "reliability", label: "发布治理", group: "运维", icon: ShieldCheck },
  { key: "effectiveness", label: "运维成效", group: "运维", icon: Activity },
  { key: "platform", label: "平台能力", group: "平台", icon: Settings2 },
] as const;

const skills = [
  ["PVC/PV 静态供给", "storage", "Pending PVC、未绑定 PV、StorageClass 不匹配", "create_pv · bind_pvc"],
  ["Volume Permission 修复", "runtime", "mkdir permission denied、挂载目录不可写", "patch_security_context"],
  ["CrashLoop 根因深挖", "runtime", "容器反复退出、previous log 有异常", "collect_logs · patch_workload"],
  ["镜像架构检测", "supply-chain", "exec format error、arm/amd64 架构不匹配", "inspect_image_manifest"],
  ["ImagePullBackOff 凭据修复", "registry", "私有仓库拉取失败、Secret 缺失", "patch_pull_secret"],
  ["Service Endpoint 空路由", "network", "Service 无后端、selector 漂移", "patch_service_selector"],
  ["NetworkPolicy 出站诊断", "network", "跨集群调用失败、外部依赖不可达", "trace_egress_flow"],
  ["Ingress TLS 证书轮换", "edge", "证书过期、SNI 不匹配", "rotate_tls_secret"],
  ["Node DiskPressure 隔离", "node", "节点磁盘压力、驱逐风险", "cordon_node · cleanup_image"],
  ["OOMKill 资源画像", "capacity", "内存不足、Limit 配置过低", "resize_resources"],
  ["HPA 抖动稳定", "capacity", "副本频繁扩缩、指标毛刺", "patch_hpa_behavior"],
  ["ConfigMap 漂移恢复", "config", "配置误删、环境变量变更未发布", "restore_configmap"],
  ["Kafka Lag 快速收敛", "middleware", "消费堆积、分区不均衡", "rebalance_consumer"],
  ["数据库连接风暴", "database", "连接池打满、慢 SQL 放大", "throttle_connections"],
  ["VM 高 I/O 定位", "virtual-machine", "虚拟机磁盘延迟、业务 I/O 抖动", "inspect_vm_io"],
  ["灰度发布门禁", "release", "发布前风险判定、错误预算保护", "release_gate"],
  ["跨集群数据流溯源", "ebpf", "东西向/南北向流量异常", "trace_flow_topology"],
  ["Emergency Rollback", "release", "紧急回滚、配置误删恢复", "rollback_workload"],
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
  const title = mode === "inspection" ? "AI 巡检" : mode === "skills" ? "Skill 库" : "拓扑影响";

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
          <button className="ghost tiny"><RefreshCcw size={14} />刷新状态</button>
        </div>
        <div className="author-watermark"><span>Built by</span><strong>the maintainer</strong></div>
      </aside>
      <main className="main demo-main">
        <div className="topbar demo-topbar">
          <div>
            <h1>{title}</h1>
            <p>{mode === "topology" ? "数据流、爆炸半径与发布影响一屏收敛" : mode === "skills" ? "把专家经验沉淀为可复用的运维能力" : "风险发现、AI 预演、人工确认、自动验证闭环"}</p>
          </div>
          <div className="top-actions">
            <select aria-label="model">
              <option>primary</option>
              <option>deepseek-ops</option>
            </select>
            <button className="ghost tiny">日间</button>
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
  const discovered = progress < 0.12 ? "扫描中" : progress < 0.24 ? "218" : "476";
  const p1 = progress < 0.12 ? "--" : progress < 0.24 ? "61" : progress < 0.90 ? "152" : "151";
  const plans = progress < 0.24 ? "生成中" : progress < 0.90 ? "476" : "已收敛";
  const skillRoutes = progress < 0.24 ? "匹配中" : "476";
  const cursorMove = easeBetween(progress, 0.48, 0.545);
  const [inspectionX, inspectionY] = humanPoint(cursorMove, [-420, -45], [-310, 34], [-118, -16], [6, -3], 7);
  const cursorClick = progress >= 0.545 && progress <= 0.575 ? 0.84 : 1;
  const confirmState =
    progress < 0.545 ? "confirm-ready" :
    progress < 0.59 ? "confirm-pressed" :
    progress < 0.90 ? "confirm-running" :
    "confirm-done";
  const confirmText =
    progress < 0.545 ? "确认并执行" :
    progress < 0.59 ? "已确认" :
    progress < 0.90 ? "执行中..." :
    "执行完成";
  const inspectionCursorStyle: React.CSSProperties = {
    animation: "none",
    opacity: progress >= 0.47 && progress <= 0.62 ? 1 : 0,
    transform: `translate(${inspectionX}px, ${inspectionY}px) scale(${cursorClick})`,
  };
  const findings = [
    ["P1", "k8s-agent-alloy-4t8hf", "CrashLoop/OOM 与挂载目录权限异常", "DaemonSet/k8s-agent-alloy"],
    ["P1", "k8s-agent-loki-58bd7", "PVC 已存在但未绑定 PV，调度被阻塞", "Deployment/k8s-agent-loki"],
    ["P2", "grafana-6d5544", "镜像架构与节点平台存在兼容风险", "Deployment/k8s-agent-grafana"],
    ["P2", "tempo-ingester", "重启次数升高，外部存储写入延迟", "StatefulSet/k8s-agent-tempo"],
  ];
  const evidence = ["previous logs", "Kubernetes Events", "Workload YAML", "PVC/PV", "Node runtime"];
  const planSteps = [
    ["1", "锁定影响对象", "从 Pod 反查 DaemonSet、ReplicaSet、Node 与挂载卷，避免修错排名第一之外的目标。"],
    ["2", "拉取多源证据", "采集 current/previous logs、Events、describe、YAML、PVC/PV、节点 runtime 状态。"],
    ["3", "根因归并", "把 permission denied 与 read-only file system 归并到挂载权限链，而不是误判成应用代码错误。"],
    ["4", "生成候选方案", "输出 fsGroup、initContainer chown、PV 权限修复、回滚路径四类方案并做风险排序。"],
    ["5", "选择最小变更", "只 patch securityContext.fsGroup 与 fsGroupChangePolicy，不扩大镜像或业务配置变更。"],
    ["6", "人工确认执行", "生成差异、影响范围、回滚命令，确认后才进入受控执行。"],
    ["7", "滚动重建并观察", "rollout 后等待新 Pod 调度、挂载、启动，并实时读取新旧日志。"],
    ["8", "恢复验证", "验证 Ready、重启次数、Events、写入探针和业务探针，失败则进入下一轮方案。"],
  ];
  const opSteps = [
    ["采集证据", "events/logs/yaml/pvc/node"],
    ["根因诊断", "permission denied + volume mount"],
    ["提交变更", "patch securityContext + rollout"],
    ["等待新 Pod", "调度、挂载、容器启动"],
    ["验证恢复", "Ready 1/1 + no new BackOff"],
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
            <span><Search size={16} />巡检范围</span>
            <button className="primary"><Play size={15} />立即巡检</button>
          </div>
          <div className="demo-form-row">
            <label>集群<select><option>所有集群</option></select></label>
            <label>Namespace<select><option>所有 Namespace</option></select></label>
            <label>定时巡检<select><option>每 2 小时</option></select></label>
          </div>
          <div className="demo-toggle-row">
            <span className="demo-check on" />生产模式
            <span className="demo-check" />自动运维
            <span className="demo-check on" />人工确认
          </div>
          <div className="demo-scan-line"><i /></div>
        </div>
        <Kpi label="发现问题" value={discovered} />
        <Kpi label="P0/P1" value={p1} tone="danger" />
        <Kpi label="可执行计划" value={plans} tone="good" />
        <Kpi label="Skill 路由" value={skillRoutes} />
      </section>

      <section className="panel demo-finding-panel">
        <div className="panel-title">
          <span><ShieldCheck size={16} />异常队列</span>
          <small>{progress < 0.34 ? "正在采集事件、日志、YAML 与拓扑证据" : "按业务影响、爆炸半径、证据强度自动排序"}</small>
        </div>
        <div className="demo-findings">
          {findings.map((item, index) => (
            <article className={`demo-finding-card finding-${index + 1} ${index === 0 && progress >= 0.90 ? "recovered" : ""}`} key={item[1]}>
              <b>{index === 0 && progress >= 0.90 ? "OK" : item[0]}</b>
              <div>
                <strong>[nonprod-wgq-s2-system] Pod {item[1]}</strong>
                <p>{index === 0 && progress >= 0.90 ? "Ready 1/1，restartCount 稳定，未再出现 BackOff 与写入失败" : item[2]} · 所属 {item[3]}</p>
                <span>k8s-agent</span><span>{index === 0 && progress >= 0.90 ? "recovered" : "evidence-ready"}</span><span>{index === 0 && progress >= 0.90 ? "verified" : "skill-matched"}</span>
              </div>
              <button className="ghost tiny">{index === 0 && progress >= 0.90 ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}{index === 0 && progress >= 0.90 ? "已恢复" : "AI 预演"}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel demo-preview-panel">
        <div className="panel-title">
          <span><Zap size={16} />实时 AI 运维预演</span>
          <strong className="demo-badge">{progress < 0.24 ? "采集中" : progress < 0.54 ? "生成方案" : progress < 0.59 ? "等待确认" : progress < 0.90 ? "执行中" : "已恢复"}</strong>
        </div>
        <div className="demo-phase-strip">
          <span className={progress >= 0.12 ? "on" : ""}>异常发现</span>
          <span className={progress >= 0.24 ? "on" : ""}>AI 生成方案</span>
          <span className={progress >= 0.54 ? "on" : ""}>人工确认</span>
          <span className={progress >= 0.86 ? "on" : ""}>验证恢复</span>
        </div>
        <div className="demo-preview-head">
          <div><small>受控运维计划</small><strong>Volume permission recovery</strong></div>
          <div><small>证据链</small><strong>{evidence.join(" · ")}</strong></div>
          <div><small>目标链</small><strong>DaemonSet/k8s-agent-alloy → Pod</strong></div>
        </div>
        <div className="demo-ai-plan">
          <div className="demo-ai-plan-title">
            <strong>AI 生成的完整运维方案</strong>
            <span>8 步闭环 · 可回滚 · 失败自动进入下一轮方案</span>
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
            <strong>人工确认</strong>
            <p>AI 已生成可回滚变更，确认后进入执行流并全程留痕。</p>
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
            <p>[INIT] 查看事件与 previous logs</p>
            <p>[LOG] mkdir data-alloy: read-only file system</p>
            <p>[RCA] 挂载目录权限与 fsGroup 不匹配，非应用代码问题</p>
            <p>[PATCH] securityContext.fsGroup=1000 + rollout restart</p>
            <p>[VERIFY] 等待新 Pod Ready，持续检查 Events 与业务探针</p>
            <p>[DONE] new pod Ready 1/1，restartCount stable，Events no backoff</p>
          </div>
          <div className="demo-patch-card">
            <strong>找变更内容</strong>
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
  const skillName = progress < 0.58 ? "PVC Pending 静态 PV 恢复" : "网络插件版本兼容性排查";
  const skillDesc = progress < 0.58
    ? "当 PVC 长时间 Pending 且无可用 PV 时，自动校验 StorageClass、容量、访问模式，并生成静态 PV 绑定方案。"
    : "当应用日志缺少直接错误但数据面异常时，沿拓扑影响路径采集 CNI、Service、Endpoint 与 eBPF 流量证据，定位网络插件兼容问题。";
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
            <span><BrainCircuit size={16} />运维 Skill 注入</span>
            <button className="ghost tiny">导入 Skill</button>
          </div>
          <div className="demo-form-row two">
            <label>Skill 名称<input value={skillName} readOnly /></label>
            <label>类别<select><option>{progress < 0.58 ? "存储" : "网络"}</option></select></label>
          </div>
          <label>一句话说明<textarea value={skillDesc} readOnly /></label>
          <div className="demo-choice-grid">
            <span>适用对象：Pod</span><span>Deployment</span><span>StatefulSet</span><span>PersistentVolumeClaim</span>
            <span>需要证据：Events</span><span>YAML</span><span>StorageClass</span><span>Node capacity</span>
          </div>
          <div className="demo-skill-note"><GitBranch size={15} />兼容 Agent Skills 开放规范，可迁移到其他智能体运行时。</div>
          <button className="primary">{progress < 0.8 ? "保存并生成 Skill 包" : "已加入企业 Skill 库"}</button>
        </div>
        <div className="panel demo-skill-match">
          <div className="panel-title"><span><Sparkles size={16} />匹配测试</span></div>
          <textarea value="Pod CrashLoopBackOff，previous logs 提示 permission denied，挂载 PVC 后启动失败" readOnly />
          <button className="primary">测试匹配</button>
          <div className="demo-match-result">
            <strong>匹配结果</strong>
            <span>Volume Permission 修复 98%</span>
            <span>CrashLoop 根因深挖 92%</span>
            <span>PVC/PV 静态供给 84%</span>
          </div>
        </div>
      </section>

      <section className="panel demo-skills-bank">
        <div className="panel-title">
          <span><Database size={16} />Skill 库</span>
          <small>越使用、越沉淀、越接近企业自己的专家系统</small>
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
  { id: "external", label: "External", sub: "客户入口 / UAAS", position: [-20, 0, 4], color: 0x2b77ff, size: 1.8 },
  { id: "ingress", label: "Ingress", sub: "edge-gateway", position: [-11, 6, -4], color: 0x4d99ff, size: 1.55 },
  { id: "orders", label: "orders-api", sub: "canary v2.4.1", position: [-1, 1, 1], color: 0x46b7ff, risk: true, size: 1.9 },
  { id: "svc", label: "Service", sub: "orders-svc", position: [7, -3, 2], color: 0x56d8ff, size: 1.45 },
  { id: "kafka", label: "Kafka", sub: "middleware cluster", position: [14, 7, -5], color: 0x8b72ff, risk: true, size: 1.75 },
  { id: "cbs", label: "CBS", sub: "财务链路", position: [20, 0, 3], color: 0xff6f8e, risk: true, size: 1.65 },
  { id: "ecp", label: "ECP", sub: "关务集成", position: [13, -9, 6], color: 0x66d3aa, risk: true, size: 1.45 },
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
  const impactNodes = progress < 0.32 ? "扫描中" : progress < 0.55 ? "11" : "18";
  const criticalPaths = progress < 0.44 ? "计算中" : "3";
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
              <button><Workflow size={14} />依赖图</button>
              <button className="active"><Network size={14} />3D 世界</button>
            </div>
            <select><option>nonprod-wgq-s2-system</option></select>
            <select><option>cattle-neuvector-system</option><option>orders</option></select>
            <select><option>Deployment/orders-api</option></select>
            <button className="ghost tiny"><ZoomIn size={14} />放大</button>
            <button className="ghost tiny"><ZoomOut size={14} />缩小</button>
            <button className="ghost tiny"><RefreshCcw size={14} />复位</button>
            <div className="topology-legend-inline"><span className="workload">Workload</span><span className="pod">Pod</span><span className="service">Service</span><span className="data">Data</span><span className="risk">Risk</span></div>
          </div>
          <div className="demo-flow-stage demo-three-stage">
            <TopologyThreeScene />
            <div className="demo-release-chip"><GitBranch size={14} />提交变更：orders-api v2.4.1 · 灰度 5%</div>
            <button className="demo-node-focus-hotspot">
              <span>Deployment/orders-api</span>
              <small>点击查看变更数据流</small>
            </button>
            <span className="demo-cursor demo-topology-cursor" style={topologyCursorStyle} />
            <div className="demo-selected-flow-card">
              <strong>已选中：orders-api</strong>
              <p>模拟变更后，订单入口、Kafka、CBS、ECP 相关数据流被标红。</p>
            </div>
            <div className="demo-three-status">
              <span className={progress >= 0.25 ? "on" : ""}>捕获 eBPF 数据流</span>
              <span className={progress >= 0.45 ? "hot" : ""}>影响链路隔离</span>
              <span className={progress >= 0.72 ? "on" : ""}>门禁建议生成</span>
            </div>
          </div>
        </div>

        <aside className="panel demo-impact-panel">
          <div className="panel-title">
            <span><BrainCircuit size={16} />AI 影响分析</span>
            <button className="primary"><Play size={14} />分析</button>
          </div>
          <div className="insight-stack">
            <div className="metric"><span>拓扑节点</span><strong>30</strong></div>
            <div className="metric"><span>关系边</span><strong>54</strong></div>
            <div className="metric"><span>CMDB 状态</span><strong>ok</strong></div>
          </div>
          <div className="analysis-card selected-node">
            <span>workload · nonprod-wgq-s2-system</span>
            <strong>Deployment/orders-api</strong>
            <p>orders namespace · 风险状态 {progress >= 0.55 ? "high" : "normal"}</p>
          </div>
          <div className="analysis-card">
            <div className="score-grid">
              <span>等级 {progress >= 0.55 ? "high" : "计算中"}</span>
              <span>score {progress >= 0.55 ? "0.82" : "--"}</span>
              <span>Amp {amp}</span>
              <span>路径 {criticalPaths}</span>
            </div>
            <div className="demo-selected-node-panel">
              <strong>选中节点：Deployment/orders-api</strong>
              <span>入站：External / Ingress / UAAS</span>
              <span>出站：Kafka / CBS / ECP / ELK</span>
            </div>
          </div>
          <div className="demo-impact-story">
            <strong>灰度发布门禁结论</strong>
            <p>建议先放行 5% 灰度，观察订单入口、Kafka 中间件集群、CBS 财务链路三条关键路径。若 SLO 错误预算连续 10 分钟消耗异常，自动冻结扩大发布。</p>
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
