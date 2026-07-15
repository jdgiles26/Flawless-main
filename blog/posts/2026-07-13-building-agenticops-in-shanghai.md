---
slug: building-agenticops-in-shanghai
title: 一个上海开发者，如何把 AgenticOps 做成源代码公开项目
title_en: Building a Public-Source AgenticOps Project from Shanghai
description: 陆宣宇分享 Flawless 的公开构建方式：从可运行基线、可复现场景和诚实边界开始，让社区围绕真实工程问题协作。
description_en: Xuanyu Lu shares how Flawless is built in public from Shanghai, starting with a runnable baseline, reproducible scenarios, and honest engineering boundaries.
date: 2026-07-13
series: Flawless Field Notes
tags: [opensource, aiops, kubernetes, buildinpublic]
cover: assets/images/luxyai-agenticops-loop.png
cover_alt: A cinematic infrastructure operations workflow created for the Flawless project
published: true
publish_to_dev: true
---

# Building a Public-Source AgenticOps Project from Shanghai

I am building Flawless from Shanghai with a simple rule: the public project should be useful before it becomes impressive.

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

I am writing the code and these field notes in Shanghai. The location is part of the story, but the engineering conversation is global. Kubernetes behaves the same at 3 a.m. in every time zone, and every operator deserves tools that make the next decision clearer.

The invitation is simple: run Flawless, inspect it, open an issue with evidence, and help turn AgenticOps from a fashionable phrase into dependable operational practice.

[Run and inspect Flawless on GitHub](https://github.com/William-Lu-stack/Flawless)

---

## 中文版

# 一个上海开发者，如何把 AgenticOps 做成源代码公开项目

我在上海构建 Flawless 时有一条很简单的原则：公开项目应该先做到有用，再追求看起来令人惊叹。

这意味着访问者不需要参加私人演示，也不需要先进行销售沟通，就能理解项目的想法。他们应该可以阅读架构、跑通本地流程、检查安全控制，并形成自己的判断。一个仓库不会因为概念很多就自然可信，只有当这些概念能够被检验时，可信度才会真正建立。

## 从可运行的工程基线开始

AI 基础设施项目尤其容易出现漂亮架构图与真实行为之间的落差。一张图可以把 Agent、记忆、工具、策略、拓扑和修复画进一个完整闭环，但真正的工程从每一条箭头都必须传递数据、每一道边界都必须安全失败时才开始。

对 Flawless 来说，公开基线很重要，因为它为后续讨论提供了共同参照。贡献者可以复现问题，SRE 可以检查执行路径，安全工程师可以追问授权在哪里强制生效，平台工程师也可以拿它与自己的环境约束进行比较。

这套基线不需要假装所有企业集成都已经完成，但必须诚实说明今天哪些内容可以运行，以及下一步要解决什么。

## 构建场景，而不只是堆叠功能

功能很容易列出来，却很难评价。场景会迫使不同能力真正协同工作。

一个有效的 AgenticOps 场景，应该从可观察的故障表现开始，以明确的验证结果结束。在两者之间，系统必须收集证据、关联资源、提出诊断、遵守策略、准备操作、记录审批、通过受控接口执行，并检查恢复。

这样，缺口会自然暴露出来。如果 Agent 无法解释为什么选择某段日志，证据模型就需要改进；如果审批信息没有爆炸半径，治理模型就需要改进；如果命令返回 0 后流程就结束了，恢复验证模型就需要改进。

场景能够把宽泛愿景转化为可复现、可审查的工程任务。

## 把信任做成可见的产品界面

人们常把信任描述成对模型的一种主观感受，但在运维领域，信任更多是外围系统的客观属性。

访问范围能否限制？工具是否受到约束？输入输出是否记录？人能否在执行前看到精确变更？证据不足时系统会不会停止？它能否证明最初的故障表现已经改善？

这些不是脚注，而是产品问题。Flawless 把证据、审批、审计和验证放在可见工作流中，因为工程师不应该靠猜测来判断安全措施是否存在。

## 公开可复用能力，同时保护真实环境

公开构建并不意味着公开私有基础设施细节。一个健康的公开项目必须把可复用的工程模式与环境专属资产分开。

示例、测试数据、凭证、Endpoint、集群名、内部域名和运维历史，都需要有意识地处理。演示数据应该是合成的，Secret 永远不应该进入 Git 历史，连接器也应该能够在不暴露其最初使用环境的情况下完成配置。

这种纪律既改善安全，也改善设计。移除私有假设后，接口会更加通用，其他人也更容易把项目跑起来。

## 准确说明许可证

Flawless 使用 PolyForm Noncommercial 许可证公开源代码与文档，支持学习、检查、实验和非商业使用，同时保留商业权利。

我会直接说明这一点，因为社区信任同样依赖清晰的授权边界。“源代码公开”和“OSI 认可的开源软件”并不是可以互换的概念，贡献者和使用者应该在投入时间前了解规则。

## 围绕困难问题建立社区

最有价值的社区，不是一群赞同所有产品主张的观众，而是一群愿意一起检验困难边界的实践者。

什么证据足以支撑诊断？哪些操作可以安全地标准化？审批如何表达风险？有状态服务怎样定义恢复？当不同工具给出冲突结果时，Agent 应该怎么做？评测又怎样反映真实事故处理？

这些问题比任何单一实现都更大。Flawless 是我探索它们的一种具体方式，而公开仓库让其他人也能参与这场探索。

我在上海写代码，也在这里写下这些实战手记。地点是故事的一部分，但工程对话属于全球。每个时区的 Kubernetes 在凌晨三点都一样难以取悦，而每一位值班工程师都值得拥有让下一步决策更清晰的工具。

邀请很简单：运行 Flawless，检查它，带着证据提交 Issue，一起把 AgenticOps 从流行词变成可靠的运维实践。

[在 GitHub 运行并检查 Flawless](https://github.com/William-Lu-stack/Flawless)
