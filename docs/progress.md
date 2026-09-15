# Leoblog 当前进度

> **已恢复（2026-09-16）**：用户已明确恢复 `tasks.md` 执行。普通实现、测试和审查使用 Luna/max；共享合同与编排由主协调者负责。Vercel 与 Neon 插件已连接，实际资源和权限仍以 API 读回为准。

[Linear 项目进度](https://linear.app/workspacebyleo/project/leoblog-5053e197f739) · [当前预览](https://6f0d77f7.leoblog-prod.pages.dev/) · [正式站点](https://douseful.eu.org/)

中央状态快照：2026-09-15T17:22:20.650206+00:00。记录中的时间不代表持续实时探测。

任务共 **65** 项：已完成 **49**，未完成 **16**。任务完成与线上发布分别计数。

| 状态 | 数量 |
| --- | --- |
| 已完成 | 49 |
| 正在并行执行 | 6 |
| 部分证据 | 1 |
| 等待依赖或输入 | 9 |

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
- 后续动作：保留历史版本；当前开发继续基于较新的 v2026.09.15-2。

- 局限：Minimal static trial: dynamic comments, backup recovery and custom-domain work remain separate.
- 局限：Historical local tests reused only for identical reviewed bytes.
- 局限：Default Python urllib public requests received Cloudflare1010; curl and the existing publisher passed actual content readback.

### v2026.09.15-2 — 已发布版本

关联任务：T044, T063；attempt：`T063-v2026.09.15-2`。

- 受测 SHA：`172a894aea309897e07f46577a71479247eb1be2`
- 产物 SHA-256：`6c0c85b489c316efa82292d9c4d03471d557a3749ff5c67be308f74a0f21f07a`
- [已发布版本链接](https://6f0d77f7.leoblog-prod.pages.dev/)
- deployment：`6f0d77f7-7301-423b-8f1b-6d0aeb2d4eae`
- 后续动作：当前正式站点与自定义域名继续提供预览；动态评论和双目标备份并行实施。

- 局限：Minimal static trial; dynamic comments and dual-target backup remain separate.
- 局限：T044 independent source/build evidence reused after exact byte comparison. T063 new independent review agents hit429; coordinator performed scoped review and verification.

以上投影消费协调者接受的回执；本页不调用 provider、不部署，也不把本地检查当成线上发布。

## 当前执行与阻塞

| 任务 | 状态 | 负责方 | 下一动作 | 情况/原因 |
| --- | --- | --- | --- | --- |
| T021 | 部分证据/阻塞 | Luna max 已完成本轮读回 | Vercel 未返回可绑定项目；Neon 已读到项目但精确额度、目标绑定和受限角色仍待下游验证 | 不再请求重复登录 |
| T024 | 正在执行 | Luna max / heavy | 审查并修正 production authority binding，运行独立 PostgreSQL、Node 与 PHP 验收 | Normal 保持 OFF |
| T030 | 正在执行 | Luna max / light | 以 TDD 实现流式 age 加密封装和私有密钥句柄 | 完整 heavy 验证排队 |
| T031 | 正在执行 | Luna max / light | 实现 Drive 上传、严格对象版本读回和持久 unknown | T029 修订已审查通过 |
| T032 | 正在执行 | Luna max / light | 实现 OneDrive 上传、429 边界和严格读回 | T029 修订已审查通过 |
| T033 | 正在执行 | Luna max / light | 完成持久 daily scheduler、截止点与恢复状态机 | T029 修订已审查通过 |
| T034 | 正在执行 | Luna max / light | 审查监测实现并补定向回归 | 完整 heavy 验证排队 |
| T036 | 等待输入 | 主协调者 | 继续 Git 对象阶段；完整媒体和 hosted GitLab/schedule/通知证据仍未满足 | `exact-gitlab-write` 尚未放行 |
| T042 | 已完成 | 主协调者 + Luna max 审查 | 精确 Cloudflare DNS/API 与正式域名读回已验收 | provider mutations = 0 |

## 就绪待开始

- 当前无就绪项。

## 局部输入与后继

未完成输入只影响其消费者；静态小版本发布不等待整层任务或全部 backlog。

| 输入 | 生产任务 | 直接消费者 |
| --- | --- | --- |
| provider-inventory | T058 | 无当前直接门禁消费者；运行阶段另验 |
| authority-live-capabilities | T022 | T037 |

动态 Gate2、备份恢复、域名等验收继续单列。新事件或中央接受状态变化后更新本页。

## 当前执行波

T029 的读回周期与 adapter 绑定合同已由主协调者修订，并由独立 Luna max 审查通过：每个周期必须在自身 30 秒/64 调用边界内完成完整字节哈希和同版本前后夹验，不允许跨周期保存部分进度；目录深度超过 16 必须在 mutation 前返回 typed gap，禁止截断。Drive、OneDrive 与 scheduler 因此已在三个互不重叠的工作树中同时执行。

Vercel 和 Neon 插件现已由用户连接。Neon API 已读到 free_v3 项目、默认分支、endpoint、数据库与 admin 权限；Vercel connector 可调用但没有返回 team/project ID。连接只解除登录等待，未读到的额度、角色隔离与运行能力仍保持 unknown。

T042 的修正版验收记录在 `evidence/T042/coordinator-acceptance-20260916.json`：Cloudflare Pages、custom domain 与精确 DNS record 均返回 HTTP 200，正式域名内容、证书、canonical、sitemap、robots、404 和历史 alias 全部匹配当前发布，未执行 provider mutation。
