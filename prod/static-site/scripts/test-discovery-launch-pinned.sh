#!/usr/bin/env bash
# Build a fresh discovery candidate twice, then exercise the real launcher in validate mode.
set -Eeuo pipefail
site="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(git -C "$site" rev-parse --show-toplevel)"
private="$site/.t044-release-private"
launcher_private="$repo/.static-launch-private-20260914"
python3 - "$private" "$launcher_private" <<'PY'
import os,pathlib,stat,sys
for raw in sys.argv[1:]:
 p=pathlib.Path(raw)
 try: p.mkdir(mode=0o700)
 except FileExistsError: pass
 s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o700 or p.is_symlink(): raise SystemExit(1)
PY
run="$private/candidate-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"; mkdir -m 700 "$run"
mkdir -m 700 "$run/source" "$run/namespace" "$run/artifacts" "$run/temp" "$run/state" "$run/control"
owner="t044-candidate-$(date +%s)-$$-$RANDOM"
image=node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
volume="${owner}-deps"; id=''; pending_name=''; owns_volume=0
bounded(){ perl -e 'alarm shift; exec @ARGV or die $!' 20 "$@"; }
cleanup(){
  rc=$?; trap - EXIT INT TERM
  if [[ -z "$id" && -n "$pending_name" ]]; then
    recovered="$(bounded docker inspect --format '{{.Id}} {{index .Config.Labels "leoblog.owner"}}' "$pending_name" 2>/dev/null)" || recovered=''
    if [[ "$recovered" == *" $owner" && "${recovered% *}" =~ ^[0-9a-f]{64}$ ]]; then id="${recovered% *}"; fi
  fi
  if [[ -n "$id" ]]; then bounded docker rm -f "$id" >/dev/null || rc=1; fi
  if (( ! owns_volume )); then
    label="$(bounded docker volume inspect --format '{{index .Labels "leoblog.owner"}}' "$volume" 2>/dev/null)" || label=''
    [[ "$label" == "$owner" ]] && owns_volume=1
  fi
  if (( owns_volume )); then bounded docker volume rm "$volume" >/dev/null || rc=1; fi
  exit "$rc"
}
trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM
wait_container(){
  bounded docker start "$id" >/dev/null; local deadline=$((SECONDS+360))
  while [[ "$(bounded docker inspect --format '{{.State.Running}}' "$id")" == true ]]; do
    if ((SECONDS>=deadline)); then bounded docker logs "$id"; return 124; fi
    sleep 1
  done
  bounded docker logs "$id"
  [[ "$(bounded docker inspect --format '{{.State.ExitCode}}' "$id")" == 0 ]]
}

# The candidate binds committed public source plus the three publisher integration files.
git -C "$repo" diff HEAD --quiet -- prod/static-site prod/ops/static-launch/Preflight.php \
  prod/laravel/app/Services/Pages/PagesPreparedAssetUploader.php prod/laravel/tests/StaticLaunch/PreflightTest.php docs/decisions
[[ -z "$(git -C "$repo" ls-files --others --exclude-standard -- prod/static-site prod/ops/static-launch/Preflight.php prod/laravel/app/Services/Pages/PagesPreparedAssetUploader.php prod/laravel/tests/StaticLaunch/PreflightTest.php docs/decisions)" ]]
git -C "$repo" archive HEAD prod/static-site | tar -x -C "$run/source" --strip-components=2
mkdir -m 700 "$run/approvals" "$run/previous"
git -C "$repo" archive HEAD docs/decisions | tar -x -C "$run/approvals"
previous_args=()
n=0
for tag in $(git -C "$repo" tag --list 'source/v*'); do
  if git -C "$repo" cat-file -e "$tag:prod/static-site/content/minimal-launch/articles.json" 2>/dev/null; then
    n=$((n + 1))
    git -C "$repo" show "$tag:prod/static-site/content/minimal-launch/articles.json" > "$run/previous/$n.json"
    previous_args+=(--previous "$run/previous/$n.json")
  fi
done
node "$run/source/scripts/approvals.mjs" check --site "$run/source" --root "$run/approvals" ${previous_args[@]+"${previous_args[@]}"} | tee "$run/approvals.json"
python3 - "$repo" "$run" <<'PY'
import hashlib,json,pathlib,subprocess,sys
repo,run=map(pathlib.Path,sys.argv[1:])
files={str(p.relative_to(run/'source')):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((run/'source').rglob('*')) if p.is_file()}
support={p:hashlib.sha256((repo/p).read_bytes()).hexdigest() for p in [
 'prod/ops/static-launch/Preflight.php','prod/laravel/app/Services/Pages/PagesPreparedAssetUploader.php','prod/laravel/tests/StaticLaunch/PreflightTest.php']}
approvals={str(p.relative_to(run/'approvals')):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((run/'approvals').rglob('*')) if p.is_file()}
identity={'git_sha':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),
 'dirty_sha256':hashlib.sha256(json.dumps({'files':files,'support':support,'approvals':approvals},sort_keys=True,separators=(',',':')).encode()).hexdigest()}
(run/'source-files.json').write_text(json.dumps(files,sort_keys=True,indent=2)+'\n')
(run/'support-files.json').write_text(json.dumps(support,sort_keys=True,indent=2)+'\n')
(run/'approvals-files.json').write_text(json.dumps(approvals,sort_keys=True,indent=2)+'\n')
(run/'source-identity.json').write_text(json.dumps(identity,sort_keys=True,separators=(',',':'))+'\n')
PY
node "$run/source/scripts/prepare-minimal-launch.mjs" "$run/namespace" "$run/source-identity.json" > "$run/freeze.json"
input="$run/namespace/release-1/input"

if bounded docker volume inspect "$volume" >/dev/null 2>&1; then echo 'refusing existing dependency volume' >&2; exit 1; fi
bounded docker volume create --label "leoblog.owner=$owner" "$volume" >/dev/null
[[ "$(bounded docker volume inspect --format '{{index .Labels "leoblog.owner"}}' "$volume")" == "$owner" ]]; owns_volume=1
pending_name="${owner}-install"
id="$(bounded docker create --name "$pending_name" --label "leoblog.owner=$owner" --pull never --platform linux/amd64 \
 --read-only --memory 1024m --memory-swap 1024m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,exec,size=384m \
 --mount "type=volume,src=$volume,dst=/deps" --mount "type=bind,src=$run/source/package.json,dst=/input/package.json,readonly" \
 --mount "type=bind,src=$run/source/package-lock.json,dst=/input/package-lock.json,readonly" -w /deps "$image" \
 sh -ec 'cp /input/package*.json .; npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/npm')"
wait_container > "$run/install.log" 2>&1; bounded docker rm "$id" >/dev/null; id=''; pending_name=''
pending_name="$owner"
id="$(bounded docker create --name "$pending_name" --label "leoblog.owner=$owner" --pull never --platform linux/amd64 --network none \
 --read-only --memory 1024m --memory-swap 1024m --cpus 1 --pids-limit 128 --tmpfs /tmp:rw,exec,size=384m \
 --mount "type=volume,src=$volume,dst=/deps,readonly,volume-nocopy" --mount "type=bind,src=$run/source,dst=/source,readonly" \
 --mount "type=bind,src=$input,dst=/input,readonly" --mount "type=bind,src=$run/artifacts,dst=/output" \
 -e ASTRO_TELEMETRY_DISABLED=1 -w /tmp "$image" sh -ec '
 cp -a /source /tmp/site; mkdir /tmp/site/node_modules
 for entry in /deps/node_modules/* /deps/node_modules/.[!.]* /deps/node_modules/..?*; do
   [ -e "$entry" ] || continue; name=${entry##*/}; case "$name" in .vite|.astro) continue;; esac
   ln -s "$entry" "/tmp/site/node_modules/$name"
 done
 cd /tmp/site; node -e '\''const a=require("node:assert/strict");a.equal(require("astro/package.json").version,"7.2.8");a.equal(require("sharp").versions.sharp,"0.35.4")'\''
 LEOBLOG_PROFILE=minimal timeout -s KILL 120 node scripts/build.mjs /input /output/site.tar.gz
 LEOBLOG_PROFILE=minimal timeout -s KILL 120 node scripts/build.mjs /input /output/site-second.tar.gz
 cmp /output/site.tar.gz /output/site-second.tar.gz; sha256sum /output/site.tar.gz /output/site-second.tar.gz')"
wait_container > "$run/build.log" 2>&1
bounded docker rm "$id" >/dev/null; id=''; pending_name=''
[[ -f "$run/artifacts/site.tar.gz" && ! -L "$run/artifacts/site.tar.gz" && -f "$run/artifacts/site-second.tar.gz" && ! -L "$run/artifacts/site-second.tar.gz" ]]

python3 - "$input" "$run/artifacts/site.tar.gz" "$run/temp" "$run/control/release.json" <<'PY'
import hashlib,json,os,pathlib,re,stat,sys,tarfile
inp,artifact,temp,out=map(pathlib.Path,sys.argv[1:])
canonical=lambda v:(json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
read=lambda p,n:p.read_bytes() if p.is_file() and not p.is_symlink() and p.stat().st_size<=n else (_ for _ in ()).throw(ValueError())
public_b,manifest_b,identity_b=[read(inp/n,65536) for n in ('public.json','manifest.json','publication-identity.json')]
public,manifest,identity=map(json.loads,(public_b,manifest_b,identity_b))
if any(canonical(v)!=b for v,b in ((public,public_b),(manifest,manifest_b),(identity,identity_b))): raise ValueError()
if not all(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', p['slug']) for p in public['posts']): raise ValueError()
sha=lambda b:hashlib.sha256(b).hexdigest(); content=sha(public_b); approval=sha(manifest_b)
if identity!={'version':1,'generation':identity.get('generation'),'content_sha':content,'approval_manifest_hash':approval}: raise ValueError()
expected={'404.html','index.html','manifest.json','robots.txt','sitemap.xml'} | {f"posts/{p['slug']}/index.html" for p in public['posts']}
with tarfile.open(artifact,'r:gz') as tar:
 members=tar.getmembers(); names=[m.name.removeprefix('./') for m in members]
 if set(names)!=expected or len(names)!=len(expected) or not all(m.isfile() for m in members): raise ValueError()
 index=tar.extractfile(members[names.index('index.html')]).read()
row={'version':1,'account_id':'c5260698746cd322513744d6e420fb1c','project_id':'0e31041a-e78b-4020-97b2-473b85ed8b1f','project_name':'leoblog-prod',
 'branch':'main','production_branch':'main','environment':'production','origin':'https://leoblog-prod.pages.dev/','git_sha':manifest['git_sha'],
 'dirty_sha256':manifest['dirty_sha256'],'generation':identity['generation'],'build_utc':manifest['build_utc'],'content_sha256':content,
 'input_manifest_sha256':approval,'marker':sha(f"{identity['generation']}\n{content}\n{approval}".encode()),'input_dir':'/launch/input',
 'artifact_root':'/launch/artifacts','artifact_path':'/launch/artifacts/site.tar.gz','artifact_hash':sha(read(artifact,67108864)),
 'artifact_size':artifact.stat().st_size,'index_sha256':sha(index),'temp_root':'/launch/tmp'}
fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f:f.write(canonical(row));f.flush();os.fsync(f.fileno())
PY
bash "$repo/prod/ops/static-launch/launch.sh" validate "$run/state" "$run/control/release.json" "$input" "$run/artifacts" "$run/temp" > "$run/validate.json"
cmp "$run/artifacts/site.tar.gz" "$run/artifacts/site-second.tar.gz"
python3 - "$run" <<'PY'
import hashlib,json,pathlib,sys
r=pathlib.Path(sys.argv[1]); sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
release=json.loads((r/'control/release.json').read_text()); result=json.loads((r/'validate.json').read_text())
if result.get('state')!='validated' or result.get('release_sha256')!=sha(r/'control/release.json'): raise SystemExit(1)
articles=json.loads((r/'approvals.json').read_text())['articles']
print(json.dumps({'candidate':str(r),'git_sha':release['git_sha'],'dirty_sha256':release['dirty_sha256'],
 'artifact_sha256':release['artifact_hash'],'artifact_size':release['artifact_size'],'release_sha256':result['release_sha256'],
 'marker':release['marker'],'state':'validated','articles':articles},sort_keys=True,separators=(',',':')))
PY
