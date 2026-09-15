# Leoblog 当前进度

[Linear 项目：需求、优先级和进度](https://linear.app/workspacebyleo/project/leoblog-5053e197f739) · [正式主站](https://douseful.eu.org/)

当前执行已恢复；普通实现和审查使用 DeepSeek V4.1 flash max，遇到429改用Luna max。

中央状态快照：2026-09-15T14:46:19.307428+00:00。记录中的时间不代表持续实时探测。

任务共 **64** 项：已完成 **46**，未完成 **18**。任务完成与线上发布分别计数。

| 状态 | 数量 |
| --- | --- |
| 已完成 | 46 |
| hosted_pending | 1 |
| in_progress | 2 |
| 部分证据 | 1 |
| 待开始 | 14 |

## 版本、PR 与公开入口

[PR #3](https://github.com/anyingiit/leoblog/pull/3)

受审源码 SHA：`172a894aea309897e07f46577a71479247eb1be2`；GitHub 导入 head：`13cd53b2050b8ad1a8a38bca418642e23054758e`。

[主站（浮动入口）](https://leoblog-prod.pages.dev/)：地址随发布更新；T004 的历史读回完成于 2026-09-15T04:09:45.227747+00:00 之前，不代表当前根入口的新读回。

### v2026.09.15-1 — 已发布版本

关联任务：T039, T052, T053；attempt：`T053-v2026.09.15-1`。

- 受测 SHA：`293154ad17aa0a9a5faf7ea337f0c20fd614c6fa`
- 产物 SHA-256：`8513dfcd856ef1bfca8342ee29901cdae541965475557965f838d457901f3b21`
- [已发布版本链接](https://18c0fefd.leoblog-prod.pages.dev/)
- deployment：`18c0fefd-3e86-4b74-9aad-9fee1e7da528`
- 后续动作：继续下一项独立可预览增量。

- 局限：Minimal static trial: dynamic comments, backup recovery and custom-domain work remain separate.
- 局限：Historical local tests reused only for identical reviewed bytes.
- 局限：Default Python urllib public requests received Cloudflare1010; curl and the existing publisher passed actual content readback.

### v2026.09.15-2 — 已发布版本

关联任务：T044, T063；attempt：`T063-v2026.09.15-2`。

- 受测 SHA：`172a894aea309897e07f46577a71479247eb1be2`
- 产物 SHA-256：`6c0c85b489c316efa82292d9c4d03471d557a3749ff5c67be308f74a0f21f07a`
- [已发布版本链接](https://6f0d77f7.leoblog-prod.pages.dev/)
- deployment：`6f0d77f7-7301-423b-8f1b-6d0aeb2d4eae`
- 后续动作：继续下一项独立可预览增量。

- 局限：Minimal static trial; dynamic comments and dual-target backup remain separate.
- 局限：T044 independent source/build evidence reused after exact byte comparison. T063 new independent review agents hit429; coordinator performed scoped review and verification.

以上投影消费协调者接受的回执；本页不调用 provider、不部署，也不把本地检查当成线上发布。

## 进行中与审查

| 任务 | 状态 | 负责方 | 下一动作 | 情况/原因 |
| --- | --- | --- | --- | --- |
| T021 | 部分证据 | Agent | 补充 Oracle、网盘、监测、scheduler 和路由只读资源清单 | 见所属任务输入 |
| T024 | in_progress | Agent | 实现非测试身份连接与 live 证明验证，保留默认 OFF | 见所属任务输入 |
| T036 | hosted_pending | Agent | 完成 GitLab 内容恢复副本首次完整同步与定时失败通知 | 见所属任务输入 |
| T064 | in_progress | Agent | 启用 Linear 并建立稳定任务映射、依赖与真实读回校验 | 见所属任务输入 |

## 就绪待开始

- T030：实现选定标准工具的流式加密封装及密钥句柄边界
- T031：实现 Google Drive 单目标上传和严格对象版本读回
- T032：实现 OneDrive 单目标上传和严格对象版本读回
- T033：实现持久 daily 调度、截止点与恢复后不重复执行
- T034：实现独立 missed-run/deadline 监测和幂等事件生产者
- T042：完成自定义域名诊断、绑定候选与正式化读回

## 局部输入与后继

未完成输入只影响其消费者；静态小版本发布不等待整层任务或全部 backlog。

| 输入 | 生产任务 | 直接消费者 |
| --- | --- | --- |
| provider-inventory | T058 | 无当前直接门禁消费者；运行阶段另验 |
| authority-live-capabilities | T022 | T037 |

动态 Gate2、备份恢复、域名等验收继续单列。新事件或中央接受状态变化后更新本页。
