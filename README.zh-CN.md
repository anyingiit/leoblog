[English](README.md) · **简体中文**

> 英文版是规范版本。本页与 [README.md](README.md) 不一致时，以英文版为准。

<!-- translation-of: README.md sha256:bb4da5764adba6a2 -->

<!-- Source: Best-README-Template BLANK_README (Unlicense) — https://github.com/othneildrew/Best-README-Template -->
<a id="readme-top"></a>

# Leoblog

一个静态博客，其发布流程会先校验每篇文章的身份标识与批准记录，再由一个 Laravel 服务把构建产物上传到 Cloudflare Pages。

[![CI](https://github.com/anyingiit/leoblog/actions/workflows/ci.yml/badge.svg)](https://github.com/anyingiit/leoblog/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/anyingiit/leoblog)](LICENSE)

[报告问题](https://github.com/anyingiit/leoblog/issues/new?template=bug_report.yml) · [提出需求](https://github.com/anyingiit/leoblog/issues/new?template=feature_request.yml)

<details>
  <summary>目录</summary>
  <ol>
    <li><a href="#about-the-project">关于本项目</a></li>
    <li><a href="#getting-started">开始使用</a></li>
    <li><a href="#usage">用法</a></li>
    <li><a href="#contributing">参与贡献</a></li>
    <li><a href="#license">许可证</a></li>
    <li><a href="#contact">联系方式</a></li>
  </ol>
</details>

## 关于本项目

Leoblog 是一个用 Astro 构建的静态博客（`prod/static-site`），内容渲染自一小批
经过审定的 Markdown 文章，而不是依赖实时数据库或 CMS。`scripts/build.mjs`
在校验 `publication-identity.json` 的哈希值与冻结的文章快照一致之前，拒绝
生成任何页面；`prod/ops/static-launch/Preflight.php` 会再次核对构建产物的
文件、路由与每篇文章的批准引用，然后才由一个 Laravel 服务
`PagesPreparedAssetUploader` 把它上传到 Cloudflare Pages。仓库同时保留两个
源码 profile，由环境变量 `LEOBLOG_PROFILE` 选择：已在线上运行的 minimal
profile，以及功能更完整（时间线、会话、归档、评论）但尚未部署的 legacy
profile。

计划中的功能与已知问题，见 [open issues](https://github.com/anyingiit/leoblog/issues)。

## 开始使用

### 环境要求

- Node.js，版本需满足本项目依赖的要求；`prod/static-site/package.json`
  把 Astro 精确锁定在 `7.2.8`
- Docker，仅在需要针对仓库自带的固定镜像运行权威测试脚本
  `prod/static-site/scripts/test-minimal-pinned.sh` 时才需要

### 安装

```sh
git clone https://github.com/anyingiit/leoblog.git
cd leoblog/prod/static-site
npm ci
```

## 用法

```sh
npm test
```

这会在 `prod/static-site` 下运行纯 Node.js 测试套件——manifest、content、
approvals 与 article-registry 相关检查——直接针对仓库当前已提交的内容运行，
不依赖任何外部服务，也不需要先构建。构建与发布站点本身走的是另一条、需要
批准把关的流程，见 [`prod/static-site/README.md`](prod/static-site/README.md)；
有了构建产物之后，`npm run serve` 会在 `http://127.0.0.1:4173` 预览它。

## 参与贡献

欢迎参与。[CONTRIBUTING.md](CONTRIBUTING.md) 说明如何提交 issue 或 pull request，[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 说明对所有参与者的行为要求。

请不要在公开的 issue 或 pull request 中报告安全问题。[SECURITY.md](SECURITY.md) 说明了私下报告的方式。

## 许可证

以 MIT 许可证分发。详见 [LICENSE](LICENSE)。

## 联系方式

项目地址：[https://github.com/anyingiit/leoblog](https://github.com/anyingiit/leoblog)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
