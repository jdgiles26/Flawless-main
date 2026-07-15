---
campaign: segmentfault-launch
author: 陆宣宇
location: 上海
status: ready-for-review
canonical: https://william-lu-stack.github.io/Flawless/posts/not-another-chatbox/
repository: https://github.com/William-Lu-stack/Flawless
---

# 标题

**别再给 Kubernetes 贴聊天框了：我把 AI SRE 做成了一个可审计的控制平面**

# 正文

很多 AI 运维产品的第一步，是在监控面板旁边增加一个对话框。它可以解释日志、生成命令，也可以把告警总结得更像一份事故报告。

但只要把问题推进到“让 Agent 动手”，系统设计就会立刻改变。

此时真正重要的不再是回答是否流畅，而是：证据来自哪里，推断能否复核，变更影响了什么，谁批准了哪一版操作，执行边界由谁控制，以及怎样证明原始故障真的消失。

我在上海开发的 **Flawless**，就是围绕这些问题构建的 AI SRE 控制平面。目前项目在 GitHub 已获得 400+ Stars，源代码可以直接检查和本地运行。

## 从聊天记录转向故障状态机

一次故障不应该只存在于自然语言上下文里。Flawless 把处理过程拆成显式状态：

`discover -> diagnose -> preview -> approve -> execute -> verify -> learn`

每个状态都有输入、输出和允许发生的转移。证据保留来源和时间范围；诊断区分事实与假设；操作绑定目标资源、风险和预期影响；审批绑定实际变更内容；执行后重新检查最初的故障表现。

这样做的价值不是让界面看起来更复杂，而是避免三个常见错误：

1. 模型根据不完整上下文给出确定结论；
2. 审批人与实际执行的命令不是同一版本；
3. 命令成功后，系统直接把事件标记为已恢复。

## 把执行边界放在模型之外

Prompt 不是权限系统。

Flawless 让模型负责规划、解释和选择经过允许的工具，但 RBAC、动作白名单、风险分级、Dry Run、人工审批和审计由控制平面执行。模型不能临时扩大自己的权限，也不能把一个高风险动作改写成“看起来安全”的自然语言来绕过策略。

我更愿意把自治能力做成逐级开放的阶梯：先解释证据，再推荐调查步骤，然后起草修复方案；只有边界清楚、经过审批的动作才进入执行。历史上被反复验证的低风险动作，才有资格进一步自动化。

## 恢复验证才是闭环的终点

`kubectl` 返回 0，不代表业务恢复。Pod Ready，不代表用户请求成功。监控恢复绿色，也可能只是流量已经消失。

因此执行完成后，Agent 必须回到最初的失败信号：Endpoint、真实请求、错误率、延迟、持续稳定时间以及关联依赖。如果验证不通过，系统保留失败策略与证据，停止继续扩大变更，并提出回滚或转人工处理。

这也是我认为 AI SRE 与“会写命令的聊天机器人”之间最重要的分界线。

## 当前工程基线

Flawless 当前包含 SRE Chat、巡检队列、证据驱动诊断、2D/3D 拓扑、爆炸半径分析、人工审批、受控执行、恢复验证、修复谱系，以及 Prometheus、Loki、Tempo、Grafana 和可选 Langfuse 可观测链路。

仓库提供本地运行、Docker 和 Helm 路径。配置一个 OpenAI-compatible 模型端点后，就可以从真实软件开始评估，而不是只看架构图。

项目地址：<https://github.com/William-Lu-stack/Flawless>

中英文实战手记：<https://william-lu-stack.github.io/Flawless/>

项目使用 PolyForm Noncommercial 许可证公开源代码和文档，支持学习、检查、实验与非商业使用。真实生产环境仍需按组织策略收敛 RBAC、凭证、网络、工具和审批范围。

我尤其想听做过 On-call 的工程师回答三个问题：哪些动作永远不该交给 Agent？什么证据缺失时必须停止？你会怎样定义一次可被机器证明的恢复？

作者：**陆宣宇，上海**
