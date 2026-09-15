#!/usr/bin/env bash
set -Eeuo pipefail
site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(git -C "$site" rev-parse --show-toplevel)"
mode="${1:-test}"
case "$mode" in test) [[ $# -le 1 ]];; preview) [[ $# -eq 2 ]];; *) exit 2;; esac
image=node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
deps=leoblog-task3-i1-deps-20260911
historical="$(git -C "$repo" rev-parse 81fbd03a5530605ab4d582cb38ce2265e85d1151:prod/static-site/package-lock.json)"
[[ "$(git hash-object "$site/package-lock.json")" == "$historical" ]]
bounded() { perl -e 'alarm shift; exec @ARGV or die $!' 20 "$@"; }
[[ "$(bounded docker volume inspect --format '{{.Name}}' "$deps")" == "$deps" ]]
owner="minimal-ui-$(date +%s)-$$-$RANDOM"; id=''
cleanup() {
  rc=$?; trap - EXIT INT TERM
  if [[ -n "$id" ]]; then bounded docker rm -f "$id" >/dev/null || rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
files=(
  package.json package-lock.json astro.config.mjs scripts/build.mjs scripts/verify-runner.mjs
  src/lib/api.mjs src/lib/content.mjs src/lib/identity.mjs src/lib/manifest.mjs
  src/layouts/Layout.astro src/components/CommentIsland.astro src/scripts/comments.js
  src/pages/index.astro src/pages/404.astro src/pages/timeline.astro 'src/pages/posts/[slug].astro'
  src/pages/sessions/index.astro 'src/pages/sessions/[id].astro'
  src/pages/archive/index.astro 'src/pages/archive/[slug].astro'
  tests/api.test.mjs tests/content.test.mjs tests/manifest.test.mjs tests/build.test.mjs
  tests/fixtures/public-snapshot.json scripts/prepare-minimal-launch.mjs scripts/serve-minimal.mjs
  content/minimal-launch/hello-world.md src/minimal/layouts/Layout.astro
  src/minimal/pages/index.astro src/minimal/pages/404.astro 'src/minimal/pages/posts/[slug].astro'
  tests/minimal-launch.test.mjs tests/minimal-preview.test.mjs
)
args=(--name "$owner" --label "leoblog.owner=$owner" --pull never --platform linux/amd64
  --read-only --memory 1024m --memory-swap 1024m --cpus 1 --pids-limit 128
  --tmpfs /work:rw,size=32m --tmpfs /tmp:rw,exec,size=384m
  --mount "type=volume,src=$deps,dst=/deps/node_modules,readonly,volume-nocopy"
  --workdir /work -e ASTRO_TELEMETRY_DISABLED=1)
for file in "${files[@]}"; do
  [[ -f "$site/$file" && ! -L "$site/$file" ]]
  args+=(--mount "type=bind,src=$site/$file,dst=/work/$file,readonly")
done
if [[ "$mode" == test ]]; then
  args+=(--network none); deadline_seconds=210
else
  input="$2"; [[ "$input" == /* && -d "$input" && ! -L "$input" ]]
  shopt -s nullglob dotglob
  input_files=("$input"/*); [[ ${#input_files[@]} -eq 3 ]]
  shopt -u nullglob dotglob
  for file in public.json manifest.json publication-identity.json; do
    [[ -f "$input/$file" && ! -L "$input/$file" ]]
    args+=(--mount "type=bind,src=$input/$file,dst=/input/$file,readonly")
  done
  args+=(--network bridge --publish 127.0.0.1::4173); deadline_seconds=900
fi
# Register the owned unique name before create, so a lost create response is still reaped.
id="$owner"
bounded docker create "${args[@]}" "$image" sh -eu -c '
  # Installed packages stay on the read-only retained volume; only generated
  # Astro/Vite caches live in this run-owned tmpfs dependency directory.
  mkdir /work/node_modules
  for entry in /deps/node_modules/* /deps/node_modules/.[!.]* /deps/node_modules/..?*; do
    [ -e "$entry" ] || continue
    name=${entry##*/}
    case "$name" in .vite|.astro) continue;; esac
    ln -s "$entry" "/work/node_modules/$name"
  done
  node -e '\''const a=require("node:assert/strict");a.equal(process.platform,"linux");a.equal(process.arch,"x64");const lock=require("./package-lock.json");a.equal(lock.packages["node_modules/astro"].version,"4.16.18");a.equal(require("astro/package.json").version,"4.16.18");require.resolve("parse5");require("esbuild").transformSync("const x=1");require("rollup");'\''
  mode=$1; shift
  if [ "$mode" = test ]; then exec timeout -s KILL 180 node scripts/verify-runner.mjs; fi
  mkdir /tmp/site
  for file do mkdir -p "/tmp/site/$(dirname "$file")"; cp "/work/$file" "/tmp/site/$file"; done
  ln -s /work/node_modules /tmp/site/node_modules
  LEOBLOG_PROFILE=minimal timeout -s KILL 120 node /tmp/site/scripts/build.mjs /input /tmp/first.tar.gz
  LEOBLOG_PROFILE=minimal timeout -s KILL 120 node /tmp/site/scripts/build.mjs /input /tmp/second.tar.gz
  cmp /tmp/first.tar.gz /tmp/second.tar.gz
  mkdir /tmp/public
  tar -xzf /tmp/first.tar.gz -C /tmp/public
  exec timeout -s KILL 600 node /tmp/site/scripts/serve-minimal.mjs /tmp/public
' -- "$mode" "${files[@]}" >/dev/null
bounded docker start "$id" >/dev/null
if [[ "$mode" == preview ]]; then
  printf 'Owned preview: %s\nOpen http://%s after builds complete.\n' "$id" "$(bounded docker port "$id" 4173/tcp)"
  printf 'Ctrl-C stops only this preview; automatic expiry is enabled. No cloud writes.\n'
fi
deadline=$((SECONDS + deadline_seconds))
while [[ "$(bounded docker inspect --format '{{.State.Running}}' "$id")" == true ]]; do
  if (( SECONDS >= deadline )); then bounded docker logs "$id"; exit 124; fi
  sleep 1
done
bounded docker logs "$id"
exit "$(bounded docker inspect --format '{{.State.ExitCode}}' "$id")"
