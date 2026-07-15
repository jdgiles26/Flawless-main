"""Data models for topology, inspection, alert, and controlled operations endpoints."""

from pydantic import BaseModel, Field


class MCPToolRequest(BaseModel):
    tool: str
    arguments: dict = Field(default_factory=dict)


class AlertScanRequest(BaseModel):
    intent: str
    cluster: str = "all"
    namespace: str = "default"
    severity: str = "auto"
    auto_healing_enabled: bool = False


class TopologyImpactRequest(BaseModel):
    selected: dict
    graph: dict = Field(default_factory=dict)
    scenario: str = "pod_change"


class ExternalTrafficFlowRequest(BaseModel):
    """Query criteria for external or cross-cluster data flows."""

    cluster: str = "all"
    cluster_id: str = ""
    namespace: str = "all"
    workload: str = ""
    window: str = "30m"
    source: str = "auto"
    include_static_inference: bool = True
    include_cmdb: bool = True


class ReleaseGateRequest(BaseModel):
    change: dict = Field(default_factory=dict)
    graph: dict = Field(default_factory=dict)
    runtime: dict = Field(default_factory=dict)
    history: list[dict] = Field(default_factory=list)
    candidates: list[dict] = Field(default_factory=list)
    observation: dict = Field(default_factory=dict)


class OpsExecuteRequest(BaseModel):
    plan: dict
    confirm: bool = False


class OpsJobCreateRequest(BaseModel):
    plan: dict
    confirm: bool = False
    autonomous: bool = False
    high_risk_confirmed: bool = False
    operator_force_execute: bool = False
    allow_high_risk_after_confirmation: bool = False
    operator_override_reason: str = ""
    stepwise_confirmation: bool = False


class OpsStepApprovalRequest(BaseModel):
    change_index: int = Field(ge=1)
    confirm: bool = True
    comment: str = ""


class OpsSkillScriptPolicy(BaseModel):
    """Optional enterprise-approved script policy for a Skill; does not accept script bodies or arbitrary commands."""

    enabled: bool = False
    script_id: str = ""
    trigger_conditions: list[str] = Field(default_factory=list)
    trigger_description: str = ""
    timeout_seconds: int = Field(default=120, ge=10, le=600)
    require_confirmation: bool = True


class OpsSkillDefinition(BaseModel):
    """A matchable Skill injected into the platform by operations staff; arbitrary shell is not allowed."""

    id: str = ""
    name: str
    category: str = "custom"
    summary: str = ""
    symptoms: list[str] = Field(default_factory=list)
    applies_to: list[str] = Field(default_factory=list)
    evidence_required: list[str] = Field(default_factory=list)
    diagnostic_steps: list[str] = Field(default_factory=list)
    allowed_actions: list[str] = Field(default_factory=list)
    success_criteria: list[str] = Field(default_factory=list)
    risk: str = "medium"
    rollback: str = ""
    owner: str = ""
    enabled: bool = True
    script_policy: OpsSkillScriptPolicy = Field(default_factory=OpsSkillScriptPolicy)


class OpsSkillMatchRequest(BaseModel):
    """Used to test whether AI or rules can match a problem to the correct Skill in isolation."""

    question: str = ""
    alert: dict = Field(default_factory=dict)
    evidence: dict = Field(default_factory=dict)
    cluster: str = "all"
    namespace: str = "all"
    workload: str = ""
    top_k: int = 5


class InspectionRequest(BaseModel):
    auto_ops: bool = False
    cluster: str = "all"
    namespace: str = "all"
    model_profile_id: str = ""
    production_mode: bool = False


class InspectionPreviewRequest(BaseModel):
    """Re-collect live evidence from the most recent inspection finding and generate a preview."""

    finding_id: str
    model_profile_id: str = ""


class InfrastructureScanRequest(BaseModel):
    """Inspection request for non-K8s infrastructure such as databases, virtual machines, and middleware."""

    resource_type: str = "all"
    resource_id: str = ""
    model_profile_id: str = ""
    production_mode: bool = True
    include_probe: bool = True
