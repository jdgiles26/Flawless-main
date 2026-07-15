---
campaign: v2ex-launch
author: 陆宣宇
location: 上海
status: ready-for-review
canonical: https://github.com/William-Lu-stack/Flawless
---

# 标题

**[分享创造] 做了一个 AI SRE 控制平面 Flawless，想听听真实值班工程师的批评**

# 正文

大家好，我是陆宣宇，在上海。

最近把自己对 AI 运维的一套想法做成了可以本地运行的源代码公开项目 **Flawless**。它不是在监控面板旁加一个聊天框，而是尝试把这条链路连起来：

`告警 → 证据 → 拓扑 → 诊断 → 变更预演 → 人工审批 → 受控执行 → 恢复验证`

我最在意的三个点：

1. 诊断必须能指回事件、日志、指标和资源状态，不能只给一段听起来合理的话。
2. 模型不能直接拥有任意 Shell；RBAC、动作白名单、风险分级和审批都在模型之外。
3. 命令成功不算修好，必须回到原始故障表现验证恢复。

目前仓库里有本地启动、Docker、Helm、SRE Chat、巡检队列、拓扑影响、受控修复和可观测链路。配置 OpenAI-compatible 模型端点后可以直接跑。项目使用 PolyForm Noncommercial 许可证，适合学习、检查和非商业使用。

GitHub：<https://github.com/William-Lu-stack/Flawless>

中英文技术文章：<https://william-lu-stack.github.io/Flawless/>

项目目前 400+ Stars，但我更需要做过真实 On-call 的朋友挑问题：

- 哪类动作你无论如何都不会交给 Agent？
- 哪些证据缺失时必须停止？
- 你会如何定义“恢复验证通过”？

欢迎直接回复或开 Issue，尖锐一点没关系。
