# leoblog

A static blog delivered through small, reviewed releases. This private repository
holds the reviewed Astro source and the GitHub release workflow.

- [当前进度、版本预览与下一动作](docs/progress.md)
- [Latest released preview](https://18c0fefd.leoblog-prod.pages.dev/)
- [Release v2026.09.15-1](https://github.com/anyingiit/leoblog/releases/tag/v2026.09.15-1)
- [Source](prod/static-site/)
- [Small releases and review](docs/operations/github-pr-workflow.md)
- [Pull requests and current release records](https://github.com/anyingiit/leoblog/pulls)

Each release PR records its tasks, tested source SHA, artifact hash, checks, Agent
review, current status and next action. Its immutable preview link is added only
after deployment and readback. PR creation or merge does not itself publish the site.

## Reproduce the pinned static check

Docker, Bash and Perl are required. From the repository root:

```bash
docker pull --platform linux/amd64 node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
bash prod/static-site/scripts/test-minimal-pinned.sh
```

The existing runner prepares dependencies from the lockfile in its own Docker
volume, tests read-only source in a container and cleans its resources. Preparation
needs registry access; tests run without network. See the workflow for the scope
of this check and reuse of already accepted T039 evidence.

The initial upgrade contains all 51 reviewed static-source files, mapped by bytes
from local candidate `293154ad17aa0a9a5faf7ea337f0c20fd614c6fa` onto a new GitHub
commit. Local private harnesses and the original repository history are excluded.
Cloudflare Pages Direct Upload remains the publisher; GitHub holds code and PRs.
