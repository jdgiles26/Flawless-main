---
slug: ai-should-earn-the-right-to-act
title: AI 可以修 Kubernetes 吗？先让它赢得行动权
title_en: "Should AI Be Allowed to Fix Kubernetes? It Must Earn the Right to Act"
description: 真正安全的 AI SRE 不是拿到集群管理员权限，而是在证据、策略、审批、受控工具和恢复验证中逐步赢得行动权。
description_en: Safe AI SRE is not cluster-admin with a prompt; it earns the right to act through evidence, policy, approval, controlled tools, and recovery checks.
date: 2026-07-13
series: Flawless Field Notes
tags: [kubernetes, aiops, security, sre]
cover: assets/images/luxyai-agenticops-loop.png
cover_alt: An operational flow with guarded approval between diagnosis and recovery
published: true
publish_to_dev: true
---

# Should AI Be Allowed to Fix Kubernetes? It Must Earn the Right to Act

“Can the agent fix it automatically?” is usually the first question people ask about AI for operations. It is also the wrong first question.

The better question is: **what must be true before any automated action is justified?**

Kubernetes turns small commands into large consequences. A patch can trigger a rollout. A scale change can reshape scheduling pressure. A deleted object may be recreated, or it may reveal that no controller was responsible for it at all. Giving a language model broad credentials and asking it to be careful is not an operating model.

Flawless approaches remediation as a sequence of earned capabilities.

## Evidence before diagnosis

An agent should not begin with a command. It should begin with a bounded evidence plan.

For a failing workload, that plan might include pod status, recent events, controller state, resource pressure, service endpoints, selected logs, and a narrow window of changes. Each read should have a purpose. The system should know where the evidence came from and preserve it alongside the resulting diagnosis.

This matters because confident language is not confidence. An explanation becomes operationally useful only when another engineer can inspect the facts behind it.

## Diagnosis before action

A diagnosis should distinguish observations from inferences.

“Three replicas are pending because no node currently satisfies the requested memory” is an observation supported by scheduler events and capacity data. “The deployment should reduce its memory request” is a proposed interpretation. That proposal may be reasonable, but it still requires context: Is the request intentional? Did traffic increase? Would lowering it create an out-of-memory loop? Is a node pool change already in progress?

Flawless is designed to keep those layers separate. The agent can summarize likely causes, state uncertainty, and identify missing evidence before it proposes a change.

## Policy before tools

The safest place to stop an unsafe action is before the tool call exists.

A production-ready agent needs explicit policy around namespaces, clusters, resource types, action classes, time windows, and risk levels. Read-only investigation might proceed automatically. Restarting one stateless workload may require lightweight approval. Editing a persistent volume, changing network policy, or touching a production database should face a much higher barrier or remain prohibited.

Policy is not a paragraph in the system prompt. It is an enforceable boundary outside the model.

## Approval that carries context

Human approval is useful only when the reviewer can make a real decision. A button labeled “Approve” without evidence merely transfers uncertainty to a tired engineer.

A good approval request contains:

- The observed symptom and likely cause.
- The exact resource and proposed change.
- The expected impact and blast radius.
- The rollback or stop condition.
- The evidence that will be checked afterward.

The goal is not to place a human in every loop forever. The goal is to make the loop legible enough that teams can deliberately decide which classes of action may later become automatic.

## Verification after execution

Execution is an event. Recovery is a claim that needs proof.

After a remediation, the system should revisit the original failure mode. Are endpoints healthy? Is traffic succeeding? Did latency return to its normal range? Are new replicas stable rather than merely ready for a few seconds? Did a related dependency degrade?

If the checks fail, the agent should not invent success. It should stop, report the evidence, and either propose a rollback or return control to the operator.

## Autonomy is a ladder

Teams do not need to choose between a read-only chatbot and a fully autonomous cluster administrator. There is a practical ladder:

1. Explain evidence.
2. Recommend investigation steps.
3. Draft a remediation plan.
4. Execute an approved, bounded action.
5. Automatically execute a proven low-risk action class.

Every step can be measured. How often was the diagnosis supported? How often did operators approve the proposed action? How often did verification succeed? What caused an escalation? These records create a basis for increasing autonomy without replacing judgment with optimism.

That is how AI should enter Kubernetes operations: with narrow permissions, visible reasoning, enforceable policy, and a requirement to prove recovery.

It does not receive the right to act because it sounds intelligent. It earns that right through evidence.

[Inspect the Flawless approach on GitHub](https://github.com/William-Lu-stack/Flawless)

---

## 中文版

# AI 可以修 Kubernetes 吗？先让它赢得行动权

“这个 Agent 能不能自动修复？”通常是大家讨论 AI 运维时最先问的问题，但它并不是最应该先问的问题。

更关键的问题是：**在任何自动操作被允许之前，系统必须满足哪些条件？**

Kubernetes 会把一条看似很小的命令放大成一连串后果。一次 Patch 可能触发完整发布，一次扩缩容会改变调度压力，一个被删除的对象可能自动重建，也可能暴露它根本没有控制器负责。给语言模型一套宽泛权限，再提醒它“小心操作”，这不是可靠的生产方案。

Flawless 把修复能力设计成一组必须逐级赢得的权限。

## 诊断之前，先有证据

Agent 不应该从命令开始，而应该从一个边界清晰的证据计划开始。

面对异常工作负载，这个计划可能包括 Pod 状态、近期事件、控制器状态、资源压力、Service Endpoint、经过选择的日志，以及一段有限时间内的变更。每一次读取都应该有目的，系统也应该记录证据来自哪里，并把它和最终诊断保存在一起。

这是因为表达得自信，不等于结论可信。只有当另一位工程师能够检查结论背后的事实时，这段解释才真正具备运维价值。

## 行动之前，区分事实与推断

诊断必须把观察事实和推断分开。

“三个副本处于 Pending，因为当前没有节点满足其内存请求”，是可以由调度事件和容量数据支撑的事实。“应该降低 Deployment 的内存请求”，则是一种建议。它也许合理，但仍然需要上下文：这项请求是不是刻意设置的？流量是否正在增长？降低后会不会进入 OOM 循环？节点池是不是已经在扩容？

Flawless 的设计目标，是让这些层次保持清晰。Agent 可以总结可能原因、说明不确定性，并在提出变更前指出还缺少什么证据。

## 工具之前，必须先有策略

阻止危险操作最有效的位置，是在工具调用产生之前。

面向生产的 Agent 需要对命名空间、集群、资源类型、操作类别、时间窗口和风险等级建立明确策略。只读调查可以自动进行；重启一个无状态工作负载可能只需要轻量审批；修改持久卷、网络策略或生产数据库，则应该面临更高门槛，甚至被完全禁止。

策略不应该只是系统提示词里的一段话，它必须是模型之外可以强制执行的边界。

## 审批必须携带足够上下文

只有当审批人能够真正做出判断时，人工审批才有意义。一个没有证据、只有“同意”按钮的请求，只是把不确定性转移给另一位疲惫的工程师。

一份合格的审批请求应该包含：

- 已观察到的故障表现与可能原因。
- 精确的资源对象和拟议变更。
- 预期影响与爆炸半径。
- 回滚方案或停止条件。
- 执行后将检查哪些证据。

目标并不是永远让人参与每一次操作，而是先把闭环做得足够清晰，让团队可以有意识地决定：哪些经过验证的操作类别，未来可以逐步自动化。

## 执行之后，必须验证恢复

执行只是一件发生过的事，恢复则是一个需要证据支撑的结论。

修复完成后，系统应该重新检查最初的故障模式：Endpoint 是否健康？真实流量是否成功？延迟是否回到正常区间？新副本是否持续稳定，而不是只短暂 Ready？关联依赖有没有出现新的退化？

如果验证失败，Agent 不应该创造一个成功故事。它应该停止、报告证据，并提出回滚方案或把控制权交还给工程师。

## 自治是一架梯子

团队不必在“只读聊天机器人”和“完全自治的集群管理员”之间二选一。更现实的路径是：

1. 解释证据。
2. 推荐调查步骤。
3. 起草修复计划。
4. 执行经过批准且边界明确的操作。
5. 自动执行已经被反复证明为低风险的操作类别。

每一级都可以衡量：诊断有多少次得到证据支持？工程师有多少次批准建议？恢复验证有多少次成功？什么情况触发了升级？这些记录让团队可以基于事实逐步提高自治程度，而不是用乐观替代判断。

AI 应该这样进入 Kubernetes 运维：权限收敛、推理可见、策略可执行，并且必须证明系统恢复。

它不是因为听起来聪明就获得行动权，而是靠证据一步步赢得行动权。

[在 GitHub 查看 Flawless 的实现思路](https://github.com/William-Lu-stack/Flawless)
