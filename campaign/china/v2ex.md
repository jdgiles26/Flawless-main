---
campaign: v2ex-launch
author: jdgiles26
status: ready-for-review
canonical: https://github.com/jdgiles26/Flawless-main
---

# Title

**[Share & Create] Built an AI SRE control plane called Flawless, would love real on-call engineers to tear it apart**

# Body

Hi everyone, I'm jdgiles26.

I recently turned my thinking on AI operations into a public-source project you can run locally, called **Flawless**. It's not a chat box bolted onto a monitoring dashboard — it tries to connect the whole chain:

`alert → evidence → topology → diagnosis → change preview → human approval → controlled execution → recovery verification`

The three things I care about most:

1. Diagnosis must be traceable back to events, logs, metrics, and resource state — not just a paragraph that sounds plausible.
2. The model can't directly hold an arbitrary shell; RBAC, an action allowlist, risk tiering, and approval all live outside the model.
3. A successful command doesn't count as fixed — the system must return to the original symptom to verify recovery.

The repository currently includes local startup, Docker, Helm, SRE chat, an inspection queue, topology impact analysis, controlled remediation, and an observability path. Once you configure an OpenAI-compatible model endpoint, you can run it directly. The project uses the PolyForm Noncommercial license, suitable for learning, inspection, and noncommercial use.

GitHub: <https://github.com/jdgiles26/Flawless-main>

Technical articles: <https://jdgiles26.github.io/Flawless-main/>

The project currently has 400+ Stars, but what I need more is friends who've done real on-call work to challenge it:

- What kind of action would you never, under any circumstances, hand to an agent?
- What missing evidence should force a stop?
- How would you define "recovery verification passed"?

Feel free to reply directly or open an Issue — being sharp is totally fine.
