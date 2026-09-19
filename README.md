<!-- Source: Best-README-Template BLANK_README (Unlicense) — https://github.com/othneildrew/Best-README-Template -->
<a id="readme-top"></a>

# Leoblog

A static blog whose release pipeline checks every post's identity and approval record before a Laravel service uploads the finished site to Cloudflare Pages.

**English** · [简体中文](README.zh-CN.md)

[![CI](https://github.com/anyingiit/leoblog/actions/workflows/ci.yml/badge.svg)](https://github.com/anyingiit/leoblog/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/anyingiit/leoblog)](LICENSE)

[Report a bug](https://github.com/anyingiit/leoblog/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/anyingiit/leoblog/issues/new?template=feature_request.yml)

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

## About The Project

Leoblog is a static blog built with Astro (`prod/static-site`) and rendered from a
small, curated set of Markdown posts rather than a live database or CMS.
`scripts/build.mjs` refuses to produce a page until it can verify a
`publication-identity.json` whose hashes match the frozen post snapshot, and
`prod/ops/static-launch/Preflight.php` re-checks the built artifact's files and
per-post approval references before a Laravel service,
`PagesPreparedAssetUploader`, uploads it to Cloudflare Pages. Two source
profiles exist side by side, selected by the `LEOBLOG_PROFILE` environment
variable: a minimal profile that is live in production, and a fuller legacy
profile (timeline, sessions, archive, comments) that builds but is not
deployed.

See the [open issues](https://github.com/anyingiit/leoblog/issues) for planned features and known issues.

## Getting Started

### Prerequisites

- Node.js, matching the version this project's dependencies require;
  `prod/static-site/package.json` pins Astro at exactly `7.2.8`
- Docker, only needed to run the repository's authoritative test harness,
  `prod/static-site/scripts/test-minimal-pinned.sh`, against its pinned image

### Installation

```sh
git clone https://github.com/anyingiit/leoblog.git
cd leoblog/prod/static-site
npm ci
```

## Usage

```sh
npm test
```

This runs the pure Node.js test suite under `prod/static-site` — manifest,
content, approvals and article-registry checks — against the repository
exactly as committed, with no external services and no build step. Building
and publishing the site itself follows a separate, approval-gated pipeline
described in [`prod/static-site/README.md`](prod/static-site/README.md); once
you have a build, `npm run serve` previews it at `http://127.0.0.1:4173`.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for how to open an issue or a pull request, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the standards expected of everyone taking part.

Please do not report security issues in public issues or pull requests. [SECURITY.md](SECURITY.md) explains how to report them privately.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

## Contact

Project link: [https://github.com/anyingiit/leoblog](https://github.com/anyingiit/leoblog)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
