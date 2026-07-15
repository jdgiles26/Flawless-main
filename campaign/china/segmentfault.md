---
campaign: segmentfault-launch
author: jdgiles26
status: ready-for-review
canonical: https://jdgiles26.github.io/Flawless-main/posts/not-another-chatbox/
repository: https://github.com/jdgiles26/Flawless-main
---

# Title

**Stop bolting a chat box onto Kubernetes: I turned AI SRE into an auditable control plane**

# Body

The first move for a lot of AI operations products is adding a chat box next to the monitoring dashboard. It can explain logs, generate commands, and summarize an alert to read more like an incident report.

But the moment you push the problem forward to "let the agent actually act," the system design has to change completely.

At that point, what matters is no longer how smoothly it answers — it's where the evidence came from, whether the inference can be double-checked, what the change actually affects, who approved which version of the action, who controls the execution boundary, and how you prove the original incident is truly gone.

**Flawless**, which I built, is an AI SRE control plane designed around exactly these questions. The project has already reached 400+ Stars on GitHub, and the source code can be inspected and run locally directly.

## Moving from a chat transcript to an incident state machine

An incident shouldn't exist only inside a natural-language context. Flawless breaks the handling process into explicit states:

`discover -> diagnose -> preview -> approve -> execute -> verify -> learn`

Each state has defined inputs, outputs, and allowed transitions. Evidence retains its source and time window; diagnosis separates facts from hypotheses; an action is bound to its target resource, risk, and expected impact; an approval is bound to the actual change content; and after execution, the system re-checks the original symptom.

The point of this isn't to make the interface look more complicated — it's to avoid three common mistakes:

1. The model reaching a confident conclusion from incomplete context;
2. The approver reviewing a different version of the command than the one actually executed;
3. The system marking an incident as recovered the moment a command succeeds.

## Keeping the execution boundary outside the model

A prompt is not a permission system.

Flawless lets the model handle planning, explanation, and selecting from approved tools, while RBAC, an action allowlist, risk tiering, dry-run, human approval, and audit are enforced by the control plane. The model cannot temporarily expand its own permissions, and it cannot rewrite a high-risk action as "seemingly safe" natural language to bypass policy.

I'd rather build autonomy as a ladder that opens up level by level: explain the evidence first, then recommend investigation steps, then draft a remediation plan; only clearly bounded, approved actions move into execution. Only low-risk actions that have been repeatedly verified over time earn further automation.

## Recovery verification is the actual end of the loop

`kubectl` returning 0 doesn't mean the business recovered. A Pod being Ready doesn't mean user requests are succeeding. Monitoring turning green again might just mean traffic has stopped arriving.

So after execution completes, the agent must return to the original failure signals: endpoints, real requests, error rate, latency, sustained stability duration, and related dependencies. If verification fails, the system preserves the failed strategy and evidence, stops expanding the change further, and proposes either a rollback or handoff to a human.

This is also, in my view, the most important dividing line between AI SRE and a "chatbot that can write commands."

## Current engineering baseline

Flawless currently includes SRE chat, an inspection queue, evidence-driven diagnosis, 2D/3D topology, blast-radius analysis, human approval, controlled execution, recovery verification, remediation lineage, and an observability path through Prometheus, Loki, Tempo, Grafana, and optional Langfuse.

The repository provides local, Docker, and Helm run paths. Once you configure an OpenAI-compatible model endpoint, you can start evaluating real software instead of just looking at an architecture diagram.

Project: <https://github.com/jdgiles26/Flawless-main>

Field notes: <https://jdgiles26.github.io/Flawless-main/>

The project publishes its source code and documentation under the PolyForm Noncommercial license, supporting learning, inspection, experimentation, and noncommercial use. Real production environments still need to constrain RBAC, credentials, network access, tools, and approval scope according to your organization's policy.

I'd especially like to hear from engineers who've done on-call work answer three questions: which actions should never be handed to an agent? What missing evidence should force a stop? How would you define a recovery that a machine can actually prove?

Author: **jdgiles26**
