import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'parse5';
import {prepare,validateMinimal,BODY,INTRO,hash,canonical} from '../scripts/prepare-minimal-launch.mjs';
import {markdownToHtml} from '../src/lib/content.mjs';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const ORIGIN='https://douseful.eu.org';
const source={git_sha:'b'.repeat(40),dirty_sha256:'c'.repeat(64)}; // tests only
function workspace(t) {const p=fs.mkdtempSync(path.join(os.tmpdir(),'minimal-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
function command(bin,args,env={},diagnostic) {
  const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',timeout:120000,
    env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1',...env}});
  if (diagnostic) {diagnostic(`stdout:\n${r.stdout}`);diagnostic(`stderr:\n${r.stderr}`);}
  assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;
}
test('exact input, generation restart, stale lock and tamper rejection',t=>{
  const ns=workspace(t);const a=prepare(ns,source);assert.equal(a.generation,1);
  assert.match(a.build_utc,/Z$/);validateMinimal(a.input);
  const p=JSON.parse(fs.readFileSync(path.join(a.input,'public.json'),'utf8'));
  assert.equal(p.posts.length,1);assert.equal(p.posts[0].body,BODY);assert.equal(p.posts[0].slug,'hello-world');
  assert.equal(p.posts[0].title,'博客上线了');assert.deepEqual(p.media,[]);assert.deepEqual(p.approved,[]);assert.deepEqual(p.timeline.events,[]);
  assert.equal(prepare(ns,source).generation,2);
  fs.mkdirSync(path.join(ns,'release-3'));assert.equal(prepare(ns,source).generation,4);
  fs.mkdirSync(path.join(ns,'.allocation-lock'));assert.throws(()=>prepare(ns,source));
  fs.writeFileSync(path.join(a.input,'public.json'),canonical({...p,posts:[]}));assert.throws(()=>validateMinimal(a.input));
  assert.equal(markdownToHtml('<script>alert(1)</script>'),'<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(markdownToHtml('" onload="evil'),'<p>&quot; onload=&quot;evil</p>');
});
test('minimal two-build inventory, actual rendered text and destinations; failed build preserves artifact',t=>{
  const ns=workspace(t);const {input}=prepare(ns,source);const artifact=path.join(ns,'site.tar.gz');
  const args=[path.join(root,'scripts/build.mjs'),input,artifact];
  t.diagnostic(JSON.stringify({packageRoot:root,cwd:process.cwd(),profile:'minimal',
    sourceFiles:['src/minimal/pages/index.astro','src/minimal/pages/404.astro','src/minimal/pages/posts/[slug].astro'].map(file=>({file,exists:fs.existsSync(path.join(root,file))}))}));
  command(process.execPath,args,{LEOBLOG_PROFILE:'minimal'},message=>t.diagnostic(message));const first=fs.readFileSync(artifact);
  command(process.execPath,args,{LEOBLOG_PROFILE:'minimal'});assert.equal(hash(first),hash(fs.readFileSync(artifact)));
  const entries=command('tar',['-tzf',artifact]).trim().split('\n').map(p=>p.replace(/^\.\//,''));
  t.diagnostic(`artifact entries: ${JSON.stringify(entries)}`);
  t.diagnostic(`two minimal artifact builds SHA-256: ${hash(first)}`);
  assert.deepEqual(entries.filter(p=>p.endsWith('.html')).sort(),['404.html','index.html','posts/hello-world/index.html']);
  assert.equal(entries.some(p=>p.endsWith('.js')||p.endsWith('.map')),false);
  assert.equal(entries.some(p=>!['404.html','index.html','posts/hello-world/index.html','robots.txt','sitemap.xml','manifest.json'].includes(p)),false);
  const marker=validateMinimal(input).marker;
  const documents={};
  for (const entry of entries.filter(p=>p.endsWith('.html'))) {
    const html=command('tar',['-xOzf',artifact,entry]);documents[entry]=html;
    assert.ok(html.includes(`name="leoblog-version" content="${marker}"`));
    const visit=node=>{
      if (node.tagName) {
        assert.equal(['script','form','iframe','object','embed','base'].includes(node.tagName),false);
        for (const {name,value} of node.attrs||[]) {
          assert.equal(name.startsWith('on'),false);assert.notEqual(name,'srcdoc');
          if (['href','src','action','poster','data','srcset'].includes(name)) {
            assert.equal(name,'href');assert.ok(['/','/posts/hello-world',`${ORIGIN}/`,`${ORIGIN}/posts/hello-world`].includes(value));
            const u=new URL(value,'https://approved.example');assert.ok(['https://approved.example',ORIGIN].includes(u.origin));
          }
        }
        if (node.tagName==='style') {
          // This minimal profile has a fixed resource-free style literal, no CSS assets.
          const css=(node.childNodes||[]).map(n=>n.value||'').join('');
          assert.doesNotMatch(css,/@import|url\s*\(/i);
        }
      }
      for (const child of node.childNodes||[]) visit(child);
    };visit(parse(html));
    assert.doesNotMatch(html,/fixture-private-provenance|leoblog\.example\.invalid/);
  }
  assert.ok(documents['index.html'].includes(INTRO));
  const article=documents['posts/hello-world/index.html'];
  for (const part of BODY.trimEnd().split('\n\n')) {
    const rendered=markdownToHtml(part);assert.ok(article.includes(rendered),rendered);
  }
  assert.equal((documents['index.html'].match(/rel="canonical"/g)||[]).length,1);
  assert.ok(documents['index.html'].includes(`href="${ORIGIN}/"`));
  assert.equal((article.match(/rel="canonical"/g)||[]).length,1);
  assert.ok(article.includes(`href="${ORIGIN}/posts/hello-world"`));
  assert.doesNotMatch(documents['index.html'],/noindex/i);assert.doesNotMatch(article,/noindex/i);
  assert.match(documents['404.html'],/<meta name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(documents['404.html'],/rel="canonical"/);
  const sitemap=command('tar',['-xOzf',artifact,'sitemap.xml']);
  assert.equal(sitemap,`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/posts/hello-world</loc></url></urlset>\n`);
  const robots=command('tar',['-xOzf',artifact,'robots.txt']);
  assert.equal(robots,`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  const publicManifest=JSON.parse(command('tar',['-xOzf',artifact,'manifest.json']));
  assert.deepEqual(publicManifest.routes,['/','/posts/hello-world']);
  assert.deepEqual(publicManifest.files.map(file=>file.path),['/404.html','/index.html','/posts/hello-world/index.html','/robots.txt','/sitemap.xml']);
  const publicBytes={...documents,'robots.txt':robots,'sitemap.xml':sitemap};
  for (const f of publicManifest.files) assert.equal(f.sha256,hash(publicBytes[f.path.slice(1)]));
  fs.writeFileSync(path.join(input,'publication-identity.json'),'{}');
  const bad=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,LEOBLOG_PROFILE:'minimal'}});
  assert.notEqual(bad.status,0);assert.deepEqual(fs.readFileSync(artifact),first);
});
