#!/usr/bin/env bash
set -Eeuo pipefail
site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-test}"
case "$mode" in test) [[ $# -le 1 ]];; preview) [[ $# -eq 2 ]];; *) exit 2;; esac
image=node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
bounded() { perl -e 'alarm shift; exec @ARGV or die $!' 20 "$@"; }
owner="minimal-ui-$(date +%s)-$$-$RANDOM"; id=''; pending_name=''
deps="${owner}-deps"; owns_deps=0
cleanup() {
  rc=$?; trap - EXIT INT TERM
  # Recover a lost create acknowledgement only when the exact-name resource
  # carries this invocation's unique owner label; delete by its immutable ID.
  if [[ -z "$id" && -n "$pending_name" ]]; then
    recovered="$(bounded docker inspect --format '{{.Id}} {{index .Config.Labels "leoblog.owner"}}' "$pending_name" 2>/dev/null)" || recovered=''
    if [[ "$recovered" == *" $owner" && "${recovered% *}" =~ ^[0-9a-f]{64}$ ]]; then id="${recovered% *}"; fi
  fi
  if [[ -n "$id" ]]; then bounded docker rm -f "$id" >/dev/null || rc=1; fi
  if (( ! owns_deps )); then
    label="$(bounded docker volume inspect --format '{{index .Labels "leoblog.owner"}}' "$deps" 2>/dev/null)" || label=''
    if [[ "$label" == "$owner" ]]; then owns_deps=1; fi
  fi
  if (( owns_deps )); then bounded docker volume rm "$deps" >/dev/null || rc=1; fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if bounded docker volume inspect "$deps" >/dev/null 2>&1; then
  printf 'refusing existing dependency volume: %s\n' "$deps" >&2; exit 1
fi
bounded docker volume create --label "leoblog.owner=$owner" "$deps" >/dev/null
[[ "$(bounded docker volume inspect --format '{{index .Labels "leoblog.owner"}}' "$deps")" == "$owner" ]]
owns_deps=1
pending_name="${owner}-install"
id="$(bounded docker create --name "$pending_name" --label "leoblog.owner=$owner" --pull never --platform linux/amd64 \
  --read-only --memory 1024m --memory-swap 1024m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,exec,size=384m --mount "type=volume,src=$deps,dst=/deps" \
  --mount "type=bind,src=$site/package.json,dst=/input/package.json,readonly" \
  --mount "type=bind,src=$site/package-lock.json,dst=/input/package-lock.json,readonly" \
  --workdir /deps "$image" sh -ec 'cp /input/package*.json .; npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/npm')"
bounded docker start "$id" >/dev/null
deadline=$((SECONDS + 300))
while [[ "$(bounded docker inspect --format '{{.State.Running}}' "$id")" == true ]]; do
  if (( SECONDS >= deadline )); then bounded docker logs "$id"; exit 124; fi
  sleep 1
done
bounded docker logs "$id"
[[ "$(bounded docker inspect --format '{{.State.ExitCode}}' "$id")" == 0 ]]
bounded docker rm "$id" >/dev/null; id=''; pending_name=''

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
  tests/minimal-launch.test.mjs tests/minimal-preview.test.mjs tests/security-toolchain.test.mjs
)
args=(--name "$owner" --label "leoblog.owner=$owner" --pull never --platform linux/amd64
  --read-only --memory 1024m --memory-swap 1024m --cpus 1 --pids-limit 128
  --tmpfs /work:rw,size=32m --tmpfs /tmp:rw,exec,size=384m
  --mount "type=volume,src=$deps,dst=/deps,readonly,volume-nocopy"
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
# Cleanup uses the returned container ID only after successful creation.
pending_name="$owner"
id="$(bounded docker create "${args[@]}" "$image" sh -eu -c '
  # Installed packages stay on the read-only retained volume; only generated
  # Astro/Vite caches live in this run-owned tmpfs dependency directory.
  mkdir /work/node_modules
  for entry in /deps/node_modules/* /deps/node_modules/.[!.]* /deps/node_modules/..?*; do
    [ -e "$entry" ] || continue
    name=${entry##*/}
    case "$name" in .vite|.astro) continue;; esac
    ln -s "$entry" "/work/node_modules/$name"
  done
  node -e '\''const a=require("node:assert/strict");a.equal(process.platform,"linux");a.equal(process.arch,"x64");const lock=require("./package-lock.json");a.equal(lock.packages["node_modules/astro"].version,"7.2.8");a.equal(require("astro/package.json").version,"7.2.8");require.resolve("parse5");require("esbuild").transformSync("const x=1");a.equal(require("sharp").versions.sharp,"0.35.4");require("sharp");'\''
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
' -- "$mode" "${files[@]}")"
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
