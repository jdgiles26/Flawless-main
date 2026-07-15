---
slug: building-agenticops-in-shanghai
title: "Building a Public-Source AgenticOps Project"
title_en: "Building a Public-Source AgenticOps Project"
description: jdgiles26 shares how Flawless is built in public, starting with a runnable baseline, reproducible scenarios, and honest engineering boundaries.
description_en: jdgiles26 shares how Flawless is built in public, starting with a runnable baseline, reproducible scenarios, and honest engineering boundaries.
date: 2026-07-13
series: Flawless Field Notes
tags: [opensource, aiops, kubernetes, buildinpublic]
cover: assets/images/luxyai-agenticops-loop.png
cover_alt: A cinematic infrastructure operations workflow created for the Flawless project
published: true
publish_to_dev: true
---

# Building a Public-Source AgenticOps Project

I am building Flawless with a simple rule: the public project should be useful before it becomes impressive.

That means a visitor should not need a private demo or a sales call to understand the idea. They should be able to read the architecture, run the local path, inspect the controls, and form their own opinion. A repository is not credible because it has many concepts. It becomes credible when those concepts can be tested.

## Start with a runnable baseline

AI infrastructure projects are especially vulnerable to the gap between a polished diagram and working behavior. A diagram can show agents, memory, tools, policy, topology, and remediation in a single beautiful loop. The real engineering begins when every arrow must carry data and every boundary must fail safely.

For Flawless, the public baseline matters because it gives every future conversation a shared reference. A contributor can reproduce an issue. An SRE can inspect the execution path. A security engineer can ask where authorization is enforced. A platform engineer can compare the design with the constraints of their own environment.

The baseline does not need to pretend that every enterprise integration already exists. It needs to be honest about what runs today and clear about what comes next.

## Build scenarios, not only features

Features are easy to list and hard to evaluate. Scenarios create pressure for the pieces to work together.

A useful AgenticOps scenario begins with an observable symptom and ends with a verification result. Between those points, the system must collect evidence, relate resources, propose a diagnosis, respect policy, prepare an action, record approval, execute through a controlled interface, and check recovery.

This makes gaps visible. If the agent cannot explain why it selected a log source, the evidence model needs work. If an approval does not show blast radius, the governance model needs work. If the workflow ends after a command returns zero, the verification model needs work.

Scenarios turn a broad vision into engineering tasks that can be reproduced and reviewed.

## Make trust a product surface

Trust is often discussed as if it were an emotional response to a model. In operations, trust is mostly a property of the surrounding system.

Can access be scoped? Are tools constrained? Are inputs and outputs recorded? Can a human see the proposed change before it runs? Does the system stop when evidence is insufficient? Can it prove that the original symptom improved?

These are product questions, not footnotes. Flawless puts evidence, approval, audit, and verification into the visible workflow because operators should not have to infer whether safeguards exist.

## Share the useful parts, protect real environments

Building in public does not mean publishing private infrastructure details. A healthy public project separates reusable engineering patterns from environment-specific assets.

Examples, fixtures, credentials, endpoints, cluster names, internal domains, and operational history all require deliberate handling. Demo data should be synthetic. Secrets should never enter Git history. Connectors should be configurable without exposing the environment they were first designed around.

That discipline improves both security and design. Once private assumptions are removed, interfaces become more general and the project becomes easier for other people to run.

## Be precise about the license

Flawless makes its source and documentation publicly available under the PolyForm Noncommercial license. That supports learning, inspection, experimentation, and noncommercial use while reserving commercial rights.

I describe that directly because community trust also depends on licensing clarity. “Public source” and “OSI-approved open source” are not interchangeable terms. Contributors and users should know the rules before investing their time.

## Build a community around hard questions

The most valuable community is not an audience that agrees with every product claim. It is a group of practitioners willing to test the difficult boundaries.

What evidence is sufficient for a diagnosis? Which actions can be safely standardized? How should an approval express risk? What does recovery mean for a stateful service? How should an agent behave when tools disagree? How can evaluations reflect actual incident work?

Those questions are bigger than one implementation. Flawless is my concrete way of exploring them, and the public repository makes the exploration available to others.

I am writing the code and these field notes as part of a global engineering conversation. Kubernetes behaves the same at 3 a.m. in every time zone, and every operator deserves tools that make the next decision clearer.

The invitation is simple: run Flawless, inspect it, open an issue with evidence, and help turn AgenticOps from a fashionable phrase into dependable operational practice.

[Run and inspect Flawless on GitHub](https://github.com/jdgiles26/Flawless-main)
