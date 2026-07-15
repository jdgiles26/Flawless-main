# Flawless AIOps User Guide

This document is intended for platform users, deployment personnel, and on-site operations staff. For developers, code module owners, and extension rule maintainers, please refer to code architecture and maintenance extension rules.md.

## 1. What is the Product

Flawless AIOps is a comprehensive AI SRE control platform designed for Kubernetes, Rancher multi-cluster, databases, virtual machines, middleware, enterprise storage, and hybrid cloud environments. It organizes resource evidence, CMDB topology, Prometheus metrics, logs, traces, LLM diagnostics, and controlled remediation into a closed loop:

Detect anomaly -> Collect evidence -> Determine root cause -> Calculate impact -> Generate plan
        -> Human confirmation -> Execute change -> Verify recovery -> Record effect

The platform does not directly execute any arbitrary Shell commands output by the LLM. All write operations must go through an action whitelist, risk gatekeeping, human confirmation, least privilege execution, and recovery verification processes.

## 2. How to Use Key Features

### SRE Dialogue

1. Select the cluster, namespace, and workload, or keep it as “all.”
2. Describe the phenomenon, such as “a certain business Pod is always in CrashLoopBackOff.”
3. View evidence, root cause, impact scope, and controlled operation plan.
4. After confirming the target and change content, click execute.
5. In the execution flow, view logs, events, change acknowledgments, and recovery verification.

Issues unrelated to Kubernetes will automatically switch to regular LLM Q&A.

### Full-Stack Resources

“Full-stack resources” are used to access infrastructure beyond Kubernetes, including databases, virtual machines, Kafka/MQ, enterprise storage, and public cloud resources.

1. Configure INFRASTRUCTURE_RESOURCES_JSON in ConfigMap, or configure DATABASE_TARGETS_JSON, VM_TARGETS_JSON, MIDDLEWARE_TARGETS_JSON, STORAGE_TARGETS_JSON by type.
2. Open “Full-stack resources,” select the resource type and target resources.
3. Click “AI SRE Inspection,” and the platform will perform read-only probing, read resource metrics, match full-stack operation skills, and let the LLM generate a controlled operation preview.
4. Real changes to databases, virtual machines, storage, and cloud platforms must be submitted to the enterprise controlled executioner pointed to by INFRASTRUCTURE_ACTION_WEBHOOK_URL; the platform does not execute any arbitrary Shell or SQL.
5. After the executioner returns the result, the platform continues with auditing, recovery verification, and operation effectiveness recording.

Resource configuration example:

[
  {
    "id": "prod-mysql-01",
    "type": "database",
    "engine": "mysql",
    "name": "Production Order MySQL",
    "host": "db.example.com",
    "port": 3306,
    "business_service": "order",
    "criticality": "high",
    "metrics": { "connections_percent": 91, "replication_lag_seconds": 72 }
  },
  {
    "id": "vm-logstash-01",
    "type": "virtual_machine",
    "provider": "virtualization-platform",
    "name": "Logstash Virtual Machine 01",
    "host": "192.0.2.31",
    "port": 22,
    "business_service": "logging",
    "metrics": { "disk_percent": 89, "memory_percent": 82 }
  }
]
