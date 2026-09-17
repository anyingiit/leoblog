import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const runner = new URL('../scripts/test-minimal-pinned.sh', import.meta.url).pathname;
const repo=path.resolve(path.dirname(runner),'../../..');
for (const target of [runner]) for (const scenario of ['volume','container','install-ack','main-ack']) test(`${path.basename(target)} safely handles ${scenario}`, t => {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'t039-ownership-'))); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ownedId='a'.repeat(64);
  fs.writeFileSync(path.join(dir,'docker'),`#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$1 $2" in
  'volume inspect')
    if [ "$SCENARIO" = volume ]; then echo foreign; exit 0; fi
    if [ -f "$STATE" ]; then cat "$STATE"; exit 0; fi
    exit 1;;
  'volume create') echo "\${4#leoblog.owner=}" > "$STATE"; echo owned-volume; exit 0;;
  'volume rm') exit 0;;
  'create '*)
    if [ "$SCENARIO" = main-ack ] && [ ! -f "$COUNT" ]; then touch "$COUNT"; echo "$OWNED_ID"; exit 0; fi
    exit 1;;
  'inspect '*)
    case "$3" in
      '{{.State.Running}}') echo false;;
      '{{.State.ExitCode}}') echo 0;;
      *) if [ "$SCENARIO" = install-ack ] || [ "$SCENARIO" = main-ack ]; then printf '%s %s\\n' "$OWNED_ID" "$(cat "$STATE")"; else echo "$OWNED_ID foreign"; fi;;
    esac; exit 0;;
  'start '*|'logs '*|'rm '*|'cp '*) exit 0;;
  *) exit 1;;
esac
`,{mode:0o755});
  const r=spawnSync('bash',[target],{encoding:'utf8',timeout:10000,cwd:repo,env:{...process.env,PATH:dir+':'+process.env.PATH,CALLS:path.join(dir,'calls'),STATE:path.join(dir,'state'),COUNT:path.join(dir,'count'),SCENARIO:scenario,OWNED_ID:ownedId}});
  assert.notEqual(r.status,0);
  assert.ok(fs.existsSync(path.join(dir,'calls')),r.stderr);
  const calls=fs.readFileSync(path.join(dir,'calls'),'utf8');
  if(scenario==='volume') assert.doesNotMatch(calls,/^(volume (create|rm)|rm) /m,'must not reuse or delete preexisting volume');
  else if(scenario==='container') {
    assert.match(calls,/^create /m,'must reach simulated container name collision');
    assert.doesNotMatch(calls,/^rm /m,'must not delete foreign-label container');
  } else {
    assert.match(calls,new RegExp(`^rm -f ${ownedId}$`,'m'),'must reconcile owned resource after lost create acknowledgement');
    assert.match(calls,/^volume rm /m,'must reap owned dependencies after container recovery');
    assert.doesNotMatch(calls,/^rm (?:-f )?(?:minimal-ui|t039-candidate)/m,'must remove by immutable ID, never guessed name');
  }
});
