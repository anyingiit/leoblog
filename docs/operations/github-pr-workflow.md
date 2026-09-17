# Small releases through GitHub

Each useful feature, fix or security update gets a small PR, relevant checks,
Agent review and a real version preview. The PR stays the visible record of its
tasks, tested source, artifact, current status, limitations and next action.

## Source and repository boundary

This private repository contains the reviewed static-site source under
`prod/static-site/` plus the root README, PR template and this workflow. The first
release maps all 51 T039 files to these exact repository paths. Its reviewed local
source SHA is `293154ad17aa0a9a5faf7ea337f0c20fd614c6fa`; the clean GitHub commit has
a different SHA. Per-file SHA-256 and Git blob checks prove the source bytes match.
The clean baseline maps 49 files from
`0e7ba2538708054ed83bf696f6c8fe524adf2553`, retaining a focused upgrade diff.

Two accepted test harnesses are verified locally by hash. They are excluded from
GitHub because local execution details are outside this repository's public source
scope. Credentials, private evidence, snapshots, database/backup files and the
original working repository's history are not imported. The existing publisher
and GitLab content recovery writer retain their separate responsibilities.

## Work and review

1. Create a branch from the reviewed baseline; include only the intended change.
2. Run checks selected by the files and dependencies that changed. Reuse accepted
   T039 checks when source, dependencies, harness and artifact bytes still match;
   documentation or a re-homed Git commit alone does not require rebuilding.
3. Open a PR with the template. Record the tested source SHA, GitHub base/head SHAs,
   artifact hash, task/version, real checks and known limitations.
4. Record Agent code review as an actual comment with the tested source and PR head
   SHAs. One account cannot independently approve its own PR. Do not label a review
   comment as GitHub APPROVE or invent a passing CI run.
5. The release coordinator verifies the full remote tree, source mapping, PR diff,
   repository permissions and review comment before submitting to the existing
   Cloudflare Pages Direct Upload publisher.

Use available API/plugin/CLI capabilities directly. A browser fallback needs a
confirmed unavailable interface and a recorded reason. A failing inactive login
entry does not override successful calls using the active GitHub identity.

## Reproduce the relevant static checks

From this repository's root, with Docker, Bash and Perl available, load the same
pinned Node image and run the existing source runner:

```bash
docker pull --platform linux/amd64 node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
bash prod/static-site/scripts/test-minimal-pinned.sh
```

The runner installs the committed lockfile into an owned Docker volume, tests
with source/dependencies mounted read-only, and cleans up only its own resources.
Dependency preparation needs registry access; the test container runs without
network access. This is the pinned static check, not a deployment command or the
separate browser acceptance. Coordinate heavy runs in one slot. The accepted T039
checks need not be repeated merely to verify this source import.

The coordinator's local integration checkout also provides the read-only T052
receipt verifier; it is intentionally outside the 54-file GitHub source import:

```bash
# (historical) python3 prod/ops/release/github/verify.py --receipt specs/001-trial-launch-remaining/evidence/T052/repository-pr.json — removed from the tree, see git tag archive/codex-tip-20260916
```

It checks local immutable source/harness bindings and fresh GitHub API metadata.
Offline fixture tests prove rejection behavior; they never prove a live PR exists.

## Release and visible progress

The existing static-release authorization permits a new machine approval for each
release attempt. Authorization, provider capability and actual success are separate
facts. Keep the same source/artifact identity through submit and observation;
unknown writes are reconciled through read-only evidence before any retry.

Pages remains Direct Upload. After the actual deployment, verify the immutable
version URL, homepage/article/404, marker and private-file exclusion. Then update
the PR with version, deployment ID and that exact preview link. Until then, write
`pending` with a reason. Merge according to the authorized review/check results;
merge alone does not mean released. Progress rendering, email, domains, backups
and unrelated backlog do not delay an otherwise ready static increment.
