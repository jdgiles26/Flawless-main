---
campaign: zhihu-launch
author: jdgiles26
status: ready-for-review
canonical: https://jdgiles26.github.io/Flawless-main/posts/ai-should-earn-the-right-to-act/
---

# Suggested question/title

**Can AI really take over Kubernetes operations? The answer from a 400+ Star project**

# Body

Short answer: AI shouldn't "take over" Kubernetes today, but it should start taking on part of the operations work that can be proven, constrained, and rolled back.

The key question isn't whether the model can write `kubectl` — it's whether it can answer five things before executing:

1. What evidence did you see?
2. What's fact, and what's just inference?
3. What is this action's target and blast radius?
4. Which policy allows you to execute it?
5. How will you prove the business actually recovered after execution?

I built an AI SRE control plane called **Flawless**. As of July 13, 2026, it has reached 400+ Stars on GitHub. The core judgment behind this project is: **AI shouldn't get production permissions just because it answers like an expert — it must earn the right to act through evidence.**

Traditional chatbots usually stop at "I suggest you restart the Pod." What Flawless aims to complete is the full loop: once an alert comes in, it collects Kubernetes events, logs, metrics, resource state, topology, and recent changes; separates facts from hypotheses; generates a clearly bounded remediation plan; goes through policy and human approval; executes using allowlisted tools; and finally re-checks the original symptom.

Why does recovery verification matter so much?

Because a command returning 0 only tells you the command ran. A Pod being Ready only tells you the probe passed. Monitoring turning green might even mean traffic has stopped arriving. Real recovery has to be confirmed against user requests, service latency, error rate, endpoints, and related dependencies.

So I prefer to think of autonomy as a ladder:

- Level 1: explain the evidence;
- Level 2: recommend investigation steps;
- Level 3: draft a remediation plan;
- Level 4: execute an approved, low-risk action;
- Level 5: automatically execute action classes that historical results have repeatedly proven reliable.

Every level has records and metrics, so a team can know whether a diagnosis was supported by evidence, whether a proposal was approved, whether the system actually recovered after execution, and what triggers a handoff to a human. Raising the level of autonomy this way relies on facts, not on optimism about the model.

I don't think the future SRE product is just "ChatGPT + Grafana." The real opportunity is a control plane where humans and agents share the same incident state: humans handle judgment, organizational context, and accountability; agents handle fast evidence collection, consistent procedure execution, and comparing large numbers of signals at once.

Flawless currently publishes a runnable engineering baseline, a local startup path, Docker/Helm deployment, and its safety boundaries. The source code and documentation are published under the PolyForm Noncommercial license, suitable for learning, inspection, experimentation, and noncommercial use.

Project: <https://github.com/jdgiles26/Flawless-main>

Field notes: <https://jdgiles26.github.io/Flawless-main/>

I especially want to hear disagreement: which Kubernetes actions do you think should never be handed to an agent? What evidence is enough to justify automatic remediation? And who should get to define "recovery"?

Author: **jdgiles26**
