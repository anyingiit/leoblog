import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'parse5';
import {prepare,validateMinimal,INTRO,hash,canonical} from '../scripts/prepare-minimal-launch.mjs';
import {loadRegistry} from '../scripts/article-registry.mjs';
import {markdownToHtml} from '../src/lib/content.mjs';
import {copyPackage,writeArticles,run} from './package-copy.mjs';
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
  assert.equal(p.posts.length,loadRegistry(root).length);assert.equal(p.posts[0].body,loadRegistry(root)[0].body);assert.equal(p.posts[0].slug,'hello-world');
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
  const registry=loadRegistry(root);
  const expectedHtmlMembers=['404.html','index.html',...registry.map(a=>`posts/${a.slug}/index.html`)].sort();
  assert.deepEqual(entries.filter(p=>p.endsWith('.html')).sort(),expectedHtmlMembers);
  assert.equal(entries.some(p=>p.endsWith('.js')||p.endsWith('.map')),false);
  const expectedMembers=new Set([...expectedHtmlMembers,'robots.txt','sitemap.xml','manifest.json']);
  assert.equal(entries.some(p=>!expectedMembers.has(p)),false);
  const marker=validateMinimal(input).marker;
  const allowedHrefs=['/',`${ORIGIN}/`,...registry.flatMap(a=>[`/posts/${a.slug}`,`${ORIGIN}/posts/${a.slug}`])];
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
            assert.equal(name,'href');assert.ok(allowedHrefs.includes(value));
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
  // Homepage lists articles newest-first (reverse registration order), each exactly once.
  {
    const home=documents['index.html'];
    let cursor=0;
    for (const entry of [...registry].reverse()) {
      const needle=`<a href="/posts/${entry.slug}">${entry.title}</a>`;
      assert.equal(home.split(needle).length-1,1,`${needle} must appear exactly once`);
      const idx=home.indexOf(needle,cursor);
      assert.ok(idx>=cursor,`expected ${needle} at or after position ${cursor} (newest-first order)`);
      cursor=idx+needle.length;
    }
  }
  const article=documents['posts/hello-world/index.html'];
  for (const part of loadRegistry(root)[0].body.trimEnd().split('\n\n')) {
    const rendered=markdownToHtml(part);assert.ok(article.includes(rendered),rendered);
  }
  assert.equal((documents['index.html'].match(/rel="canonical"/g)||[]).length,1);
  assert.ok(documents['index.html'].includes(`href="${ORIGIN}/"`));
  for (const entry of registry) {
    const page=documents[`posts/${entry.slug}/index.html`];
    assert.equal((page.match(/rel="canonical"/g)||[]).length,1);
    assert.ok(page.includes(`href="${ORIGIN}/posts/${entry.slug}"`));
  }
  assert.doesNotMatch(documents['index.html'],/noindex/i);assert.doesNotMatch(article,/noindex/i);
  assert.match(documents['404.html'],/<meta name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(documents['404.html'],/rel="canonical"/);
  const sitemap=command('tar',['-xOzf',artifact,'sitemap.xml']);
  const expectedRoutes=['/',...registry.map(a=>`/posts/${a.slug}`)].sort();
  const expectedSitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${expectedRoutes.map(r=>`<url><loc>${ORIGIN}${r}</loc></url>`).join('')}</urlset>\n`;
  assert.equal(sitemap,expectedSitemap);
  const robots=command('tar',['-xOzf',artifact,'robots.txt']);
  assert.equal(robots,`User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  const publicManifest=JSON.parse(command('tar',['-xOzf',artifact,'manifest.json']));
  assert.deepEqual(publicManifest.routes,expectedRoutes);
  const expectedFilePaths=['/404.html','/index.html',...registry.map(a=>`/posts/${a.slug}/index.html`),'/robots.txt','/sitemap.xml'].sort();
  assert.deepEqual(publicManifest.files.map(file=>file.path),expectedFilePaths);
  const publicBytes={...documents,'robots.txt':robots,'sitemap.xml':sitemap};
  for (const f of publicManifest.files) assert.equal(f.sha256,hash(publicBytes[f.path.slice(1)]));
  fs.writeFileSync(path.join(input,'publication-identity.json'),'{}');
  const bad=spawnSync(process.execPath,args,{cwd:root,env:{...process.env,LEOBLOG_PROFILE:'minimal'}});
  assert.notEqual(bad.status,0);assert.deepEqual(fs.readFileSync(artifact),first);
});
test('single-article output matches pre-change bytes',t=>{
  const work=workspace(t);
  const dest=path.join(work,'copy');
  copyPackage(root,dest);
  const helloBody=fs.readFileSync(path.join(dest,'content/minimal-launch/hello-world.md'));
  writeArticles(dest,[{slug:'hello-world',title:'博客上线了',body:helloBody}]);

  const ns=path.join(work,'ns');fs.mkdirSync(ns);
  const sourceFile=path.join(work,'source.json');
  fs.writeFileSync(sourceFile,JSON.stringify(source));
  run(process.execPath,[path.join(dest,'scripts/prepare-minimal-launch.mjs'),ns,sourceFile]);
  const input=path.join(ns,'release-1','input');

  const artifact=path.join(work,'site.tar.gz');
  run(process.execPath,[path.join(dest,'scripts/build.mjs'),input,artifact],{env:{...process.env,LEOBLOG_PROFILE:'minimal'}});
  const extract=entry=>run('tar',['-xOzf',artifact,entry]).stdout;
  const indexHtml=extract('index.html');
  const articleHtml=extract('posts/hello-world/index.html');
  const notFoundHtml=extract('404.html');

  const {marker}=validateMinimal(input,{siteRoot:dest});
  const manifestJson=JSON.parse(fs.readFileSync(path.join(input,'manifest.json'),'utf8'));
  const buildUtc=manifestJson.build_utc;
  const fill=expected=>expected.replaceAll('@@MARKER@@',marker).replaceAll('@@UTC@@',buildUtc);

  // Bytes captured from the pre-change templates (tasks.md T107 step 2), with the
  // per-build marker and build_utc replaced by placeholders. This is the contract's
  // single-article equivalence guarantee (docs/contracts/frozen-input-v2.md section 2.5):
  // rendering a lone hello-world registration must keep producing these exact bytes.
  const EXPECTED_INDEX="<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><meta name=\"leoblog-version\" content=\"@@MARKER@@\"><link rel=\"canonical\" href=\"https://douseful.eu.org/\"> <title>Leoblog</title><style>:root{font-family:system-ui,sans-serif;color:#1d2939;background:#f7f8fa}body{max-width:900px;margin:auto;padding:1rem 1.25rem;line-height:1.8}nav{border-bottom:1px solid #d0d5dd;padding:.5rem 0 1rem;margin-bottom:2rem}a{color:#175cd3}article{overflow-wrap:anywhere}time{color:#667085}</style></head><body><nav aria-label=\"主导航\"><a href=\"/\">Leoblog</a></nav><main><h1>Leoblog</h1><p>记录学习、实践与思考。先写下来，再慢慢完善。</p><article><h2><a href=\"/posts/hello-world\">博客上线了</a></h2></article></main></body></html>";
  const EXPECTED_ARTICLE="<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><meta name=\"leoblog-version\" content=\"@@MARKER@@\"><link rel=\"canonical\" href=\"https://douseful.eu.org/posts/hello-world\"> <title>博客上线了 · Leoblog</title><style>:root{font-family:system-ui,sans-serif;color:#1d2939;background:#f7f8fa}body{max-width:900px;margin:auto;padding:1rem 1.25rem;line-height:1.8}nav{border-bottom:1px solid #d0d5dd;padding:.5rem 0 1rem;margin-bottom:2rem}a{color:#175cd3}article{overflow-wrap:anywhere}time{color:#667085}</style></head><body><nav aria-label=\"主导航\"><a href=\"/\">Leoblog</a></nav><main><article><h1>博客上线了</h1><p>构建于 <time datetime=\"@@UTC@@\">@@UTC@@</time></p><div><p>先从一个可以打开、可以阅读的版本开始。</p>\n<p>这个博客会用来记录学习、实践和思考。有些内容会是整理过的文章，有些可能只是解决一个问题后留下的笔记。不必每次都有完整的结论，但希望每次记录都能留下值得回看的东西。</p>\n<h2>先把第一步走出来</h2>\n<p>搭建博客的过程中，很容易不断增加“上线前还应该完成”的事情：更完善的后台、更方便的发布流程、评论、备份，还有各种自动化工具。</p>\n<p>这些都重要，但我也希望，这里不只是一个一直在准备中的项目。</p>\n<p>所以，第一版先保持简单：一个首页、一篇文章，以及可以正常阅读的静态页面。先让内容有一个公开的位置，再通过实际使用决定下一步改进什么。</p>\n<h2>当前版本</h2>\n<p>博客目前处于静态试运行阶段，评论暂未开放。</p>\n<p>接下来会逐步完善内容更新、版本管理和开发预览流程。评论等功能也会在准备妥当后加入，而不是为了赶进度匆忙开放。</p>\n<h2>从这篇开始</h2>\n<p>这篇文章没有复杂的主题，只是为这个博客留下一个起点。</p>\n<p>后面会慢慢有新的记录。比起一次把所有东西做完，我更希望这里能够持续更新，一点一点变得更好。</p>\n<p>欢迎来看看。</p></div></article></main></body></html>";
  const EXPECTED_404="<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><meta name=\"leoblog-version\" content=\"@@MARKER@@\"> <meta name=\"robots\" content=\"noindex, nofollow\"><title>页面未找到 · Leoblog</title><style>:root{font-family:system-ui,sans-serif;color:#1d2939;background:#f7f8fa}body{max-width:900px;margin:auto;padding:1rem 1.25rem;line-height:1.8}nav{border-bottom:1px solid #d0d5dd;padding:.5rem 0 1rem;margin-bottom:2rem}a{color:#175cd3}article{overflow-wrap:anywhere}time{color:#667085}</style></head><body><nav aria-label=\"主导航\"><a href=\"/\">Leoblog</a></nav><main><h1>页面未找到</h1><p>这个地址没有页面。你可以<a href=\"/\">返回首页</a>，阅读最新文章。</p></main></body></html>";

  assert.equal(indexHtml,fill(EXPECTED_INDEX));
  assert.equal(articleHtml,fill(EXPECTED_ARTICLE));
  assert.equal(notFoundHtml,fill(EXPECTED_404));
});
