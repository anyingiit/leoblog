# prod/static-site：Astro 静态站

线上站点（https://douseful.eu.org/ 与 https://leoblog-prod.pages.dev/，v2026.09.15-2）的源码。一个 Astro 7.2.8 包，两个源码 profile，由环境变量 `LEOBLOG_PROFILE` 在 `astro.config.mjs` 里选择：

| profile | 状态 | srcDir | site | 页面 |
|---|---|---|---|---|
| `minimal` | **已实现且线上** | `src/minimal` | `https://douseful.eu.org` | 首页、每篇已登记文章、404、sitemap、robots；无 JS/CSS 文件、无表单、无外部资源；`publicDir` 关闭 |
| `legacy` | 已实现未部署 | `src` | `https://leoblog.example.invalid` | 完整站：首页列表、timeline、sessions、archive、带 `CommentIsland` 与 Turnstile 的文章页 |

`LEOBLOG_PROFILE` 必须显式设置，没有默认值：未设置或空串时，`astro.config.mjs` 与 `scripts/build.mjs` 都在读取任何输入前调用 `src/lib/profile.mjs` 的 `resolveProfile()` 报错 `LEOBLOG_PROFILE is required: set it to "minimal" or "legacy"`；其他值报 `unknown static profile: LEOBLOG_PROFILE must be "minimal" or "legacy"`。构建线上产物：`LEOBLOG_PROFILE=minimal npm run build`；本地跑 legacy 站：`LEOBLOG_PROFILE=legacy npm run build`。

## 目录

| 路径 | 内容 |
|---|---|
| `src/minimal/` | 线上页面：`discovery.mjs`（`ORIGIN`、`indexedPaths()`、sitemap/robots 常量）、`layouts/Layout.astro`（要求 64 位十六进制 `LEOBLOG_VERSION_MARKER`，输出 `<meta name="leoblog-version">`）、`pages/{index,404,posts/[slug]}.astro`、`pages/{sitemap.xml,robots.txt}.js` |
| `src/lib/` | 两个 profile 共用：`content.mjs`（Laravel 公开快照 schema 校验 + markdown）、`identity.mjs`（`publication-identity.json` → marker）、`manifest.mjs`（产物 `manifest.json`）、`api.mjs`（legacy 评论客户端） |
| `src/pages/`、`src/layouts/`、`src/components/`、`src/scripts/` | legacy profile 的页面、布局与评论岛 |
| `content/minimal-launch/` | 已批准文章：`articles.json` 登记 + 逐篇正文 `<slug>.md`；正文与批准记录逐字节一致，见下方"文章登记" |
| `scripts/`、`tests/` | 见下两节 |
| `dist-docker/` | **legacy** Astro 4 构建产物的跟踪副本（7 条路由），只作 `prod/worker` 测试与 `regression.sh --worker` 的夹具；不是线上站，也不能用当前锁文件重新生成 |

## 脚本与契约

| 脚本 | 用法（cwd 仓库根，除非注明） | 说明 |
|---|---|---|
| `scripts/prepare-minimal-launch.mjs` | `node prod/static-site/scripts/prepare-minimal-launch.mjs <绝对路径 namespace> <source.json>` | 冻结发布输入。`source.json` = `{git_sha, dirty_sha256}`；namespace 只能含 `release-N` 目录，分配 `generation = max(N)+1`，写出 `release-N/input/{public.json,manifest.json,publication-identity.json}`（canonical JSON）；残留 `.allocation-lock` 即停止，不得删除重试。`manifest.json` 为 v2：逐篇 `articles: [{slug, approval_reference, body_sha256}]`，每条 `approval_reference` 指向对应 `docs/decisions/<date>-<name>.md#approved-public-text-verbatim` |
| `scripts/build.mjs` | `LEOBLOG_PROFILE=minimal ASTRO_TELEMETRY_DISABLED=1 node scripts/build.mjs <input-dir> <artifact.tar.gz>`（cwd `prod/static-site`，需已按锁文件安装依赖） | 位置参数：快照目录 + 产物路径；设置 `OUTPUT_DIR` 直接报错；minimal 只接受目录输入并先 `validateMinimal`；用 `process.execPath` 运行 `node_modules/astro/bin/astro.mjs`（不用 `npx`）；tar 条目排序、mtime 归零、`gzip -n`、经 `<artifact>.new` 原子改名；同一输入两次构建字节相同；失败不覆盖旧产物。产物成员：5 个固定文件（`404.html index.html manifest.json robots.txt sitemap.xml`）+ 每篇文章一个页面（`posts/<slug>/index.html`） |
| `scripts/serve-minimal.mjs` | `node scripts/serve-minimal.mjs <解压目录>` | 纯 Node 预览：按解压目录里的 `manifest.json` 生成路由，GET/HEAD 以外 405，legacy 路径 404 |
| `scripts/test-minimal-pinned.sh` | `bash prod/static-site/scripts/test-minimal-pinned.sh [preview <绝对路径 release-N/input>]` | 权威固定镜像检查：`node@sha256:c610fcdf…`（linux/amd64）独占卷 `npm ci`，再 `--network none --read-only` 跑 `verify-runner.mjs`（101 个测试）并断言 Astro 7.2.8 / Sharp 0.35.4；`preview` 模式双构建 `cmp` 后在 127.0.0.1 随机端口起预览 |
| `scripts/test-discovery-launch-pinned.sh` | `bash prod/static-site/scripts/test-discovery-launch-pinned.sh` | 干净 git 树 → 冻结 → 离线双构建 → 22 字段 envelope → `prod/ops/static-launch/launch.sh validate`；写到 `.t044-release-private/`（gitignore）与 `<仓库根>/.static-launch-private-20260914/`；需要 launcher 的本地镜像 |
| `scripts/verify-runner.mjs` | 容器内调用 | 把显式 allowlist 复制到临时目录、软链 `node_modules`、`node --test` 12 个测试文件（`content/minimal-launch/` 在运行时整体纳入，不在 allowlist 里逐条列出）；新增源文件要同时加进它和 `test-minimal-pinned.sh` 的 `files=(…)` |
| `scripts/serve.mjs` | `npm run serve` | legacy dist 服务器 |

## 文章登记

minimal profile 的已发布文章由三类文件共同确定，三者必须一致，否则 `prepare()`／`validateMinimal()` 拒绝：

| 文件 | 内容 |
|---|---|
| `content/minimal-launch/<slug>.md` | 正文：UTF-8、无 CR、恰好一个结尾换行 |
| `content/minimal-launch/articles.json` | 登记：每篇 `{slug, title, body_sha256, approval}`；`hello-world` 必须是第一条 |
| `docs/decisions/<date>-<name>.md` | 负责人批准记录；`## Approved public text (verbatim)` 小节字节须与对应正文一致；登记的 `approval` 指向其 `#approved-public-text-verbatim` 锚点 |

批准核对（cwd 仓库根）：

```bash
node prod/static-site/scripts/approvals.mjs check --site "$PWD/prod/static-site" --root "$PWD"
```

新增一篇文章的完整步骤、批准记录模板与发布顺序见 [docs/operations/static-release.md](../../docs/operations/static-release.md)。

## 测试

| 命令（cwd） | 覆盖 | 依赖 |
|---|---|---|
| `bash prod/static-site/scripts/test-minimal-pinned.sh`（仓库根） | api 2、content 5、manifest 4、build 9（legacy 构建契约）、minimal-launch 3、minimal-multi 4、minimal-content 5、minimal-preview 2、security-toolchain 1、article-registry 33、approvals 28、profile 5 = 101 | Docker、bash、perl |
| `node --test tests/minimal-preview.test.mjs tests/manifest.test.mjs tests/content.test.mjs tests/security-toolchain.test.mjs tests/api.test.mjs tests/article-registry.test.mjs tests/approvals.test.mjs tests/minimal-content.test.mjs`（`prod/static-site`） | 8 个文件、80 个纯 Node 测试 | host node，无需 `node_modules` |
| `node --test tests/runner-ownership.test.mjs`（`prod/static-site`） | 用 PATH 上的假 `docker` 驱动 `test-minimal-pinned.sh`，4 个场景（不复用/删除他人卷与容器、按不可变 ID 回收） | host node + bash |
| `tests/browser.spec.mjs` + `playwright.config.mjs` | legacy 评论岛的 Playwright 测试，不属于任何 runner | 休眠 |

前置条件、耗时与实跑状态见 [docs/operations/testing.md](../../docs/operations/testing.md)。

## 固定值

`package.json` / `package-lock.json`：`astro 7.2.8`（exact）、`sharp 0.35.4`（可选依赖）、`@playwright/test 1.63.0`、`parse5 7.3.0`（dev）；`tests/security-toolchain.test.mjs` 与容器探针断言这些值（SEC-001 已在 v2026.09.15-1 关闭，任何写着 4.16.18 的文档都是历史）。运行镜像 `node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`。

## 深入阅读

- 发布全流程（冻结 → 预览 → 构建 → envelope → `launch.sh` → 读回）：[docs/operations/static-release.md](../../docs/operations/static-release.md)
- 快照 / manifest / identity 数据形状：[docs/reference/content-model.md](../../docs/reference/content-model.md)、[publication-pipeline.md](../../docs/reference/publication-pipeline.md)
- runner 写法：[docs/reference/docker-runner-pattern.md](../../docs/reference/docker-runner-pattern.md)
