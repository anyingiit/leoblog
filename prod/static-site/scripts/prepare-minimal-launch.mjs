import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPublicationIdentity} from '../src/lib/identity.mjs';
export const INTRO = '记录学习、实践与思考。先写下来，再慢慢完善。';
export const BODY = `先从一个可以打开、可以阅读的版本开始。

这个博客会用来记录学习、实践和思考。有些内容会是整理过的文章，有些可能只是解决一个问题后留下的笔记。不必每次都有完整的结论，但希望每次记录都能留下值得回看的东西。

## 先把第一步走出来

搭建博客的过程中，很容易不断增加“上线前还应该完成”的事情：更完善的后台、更方便的发布流程、评论、备份，还有各种自动化工具。

这些都重要，但我也希望，这里不只是一个一直在准备中的项目。

所以，第一版先保持简单：一个首页、一篇文章，以及可以正常阅读的静态页面。先让内容有一个公开的位置，再通过实际使用决定下一步改进什么。

## 当前版本

博客目前处于静态试运行阶段，评论暂未开放。

接下来会逐步完善内容更新、版本管理和开发预览流程。评论等功能也会在准备妥当后加入，而不是为了赶进度匆忙开放。

## 从这篇开始

这篇文章没有复杂的主题，只是为这个博客留下一个起点。

后面会慢慢有新的记录。比起一次把所有东西做完，我更希望这里能够持续更新，一点一点变得更好。

欢迎来看看。
`;
const approval_reference = 'docs/superpowers/specs/2026-09-14-minimal-static-launch-design.md#approved-public-text-verbatim';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value)) + '\n';
}
const fail = () => { throw new Error('minimal_input_invalid'); };
function sourceValid(s) {
  if (!s || Object.keys(s).sort().join(',') !== 'dirty_sha256,git_sha' ||
      !/^[a-f0-9]{40}$/.test(s.git_sha) || !/^[a-f0-9]{64}$/.test(s.dirty_sha256)) fail();
}
function snapshot(s, utc) {
  return {version:1, git_sha:s.git_sha, posts:[{slug:'hello-world',title:'博客上线了',
    summary:'',tags:[],published_at:utc,body:BODY,sha:hash(BODY)}],
    timeline:{events:[]},media:[],approved:[]};
}
function manifest(s, utc, content_sha) {
  return {version:1,provenance:'owner-static',approval_reference,body_sha256:hash(BODY),
    content_sha,...s,build_utc:utc};
}
function syncDir(p) { const fd=fs.openSync(p,'r'); try {fs.fsyncSync(fd);} finally {fs.closeSync(fd);} }
function write(p, bytes) {
  const fd=fs.openSync(p,'wx',0o600);
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
function trustedDirectory(p) {
  if (!path.isAbsolute(p) || path.resolve(p)!==p || p==='/') fail();
  let current='/';
  for (const part of p.slice(1).split('/')) {
    current=path.join(current,part);
    if (!fs.lstatSync(current).isDirectory()) fail();
  }
}
export function validateMinimal(dir) {
  const identity=loadPublicationIdentity(dir);
  if (fs.readdirSync(dir).sort().join(',')!=='manifest.json,public.json,publication-identity.json') fail();
  for (const name of fs.readdirSync(dir)) if (!fs.lstatSync(path.join(dir,name)).isFile()) fail();
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  const s={git_sha:m.git_sha,dirty_sha256:m.dirty_sha256}; sourceValid(s);
  if (typeof m.build_utc!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.build_utc) ||
      new Date(m.build_utc).toISOString()!==m.build_utc) fail();
  const expected=canonical(snapshot(s,m.build_utc));
  if (fs.readFileSync(path.join(dir,'public.json'),'utf8')!==expected ||
      fs.readFileSync(path.join(dir,'manifest.json'),'utf8')!==canonical(manifest(s,m.build_utc,hash(expected)))) fail();
  return identity;
}
export function prepare(namespace,source) {
  sourceValid(source); trustedDirectory(namespace);
  const bodyPath=fileURLToPath(new URL('../content/minimal-launch/hello-world.md',import.meta.url));
  if (!fs.lstatSync(bodyPath).isFile() || !fs.readFileSync(bodyPath).equals(Buffer.from(BODY))) fail();
  const lock=path.join(namespace,'.allocation-lock'); fs.mkdirSync(lock,{mode:0o700});
  // No finally unlock: any uncertain write/fsync leaves a lock and allocation for review.
  syncDir(namespace);
  let generation=0;
  for (const name of fs.readdirSync(namespace)) {
    if (name==='.allocation-lock') continue;
    if (!/^release-[1-9][0-9]*$/.test(name) || !fs.lstatSync(path.join(namespace,name)).isDirectory()) fail();
    const n=Number(name.slice(8)); if (!Number.isSafeInteger(n)) fail(); generation=Math.max(generation,n);
  }
  generation++; if (!Number.isSafeInteger(generation)) fail();
  const release=path.join(namespace,`release-${generation}`); fs.mkdirSync(release,{mode:0o700}); syncDir(namespace);
  const pending=path.join(release,'input.pending'); fs.mkdirSync(pending,{mode:0o700});
  const utc=new Date().toISOString(); const publicBytes=canonical(snapshot(source,utc));
  const manifestBytes=canonical(manifest(source,utc,hash(publicBytes)));
  write(path.join(pending,'public.json'),publicBytes); write(path.join(pending,'manifest.json'),manifestBytes);
  write(path.join(pending,'publication-identity.json'),canonical({version:1,generation,
    content_sha:hash(publicBytes),approval_manifest_hash:hash(manifestBytes)}));
  syncDir(pending); fs.renameSync(pending,path.join(release,'input')); syncDir(release);
  validateMinimal(path.join(release,'input')); fs.rmdirSync(lock); syncDir(namespace);
  return {input:path.join(release,'input'),generation,build_utc:utc};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.length!==4) fail();
  console.log(JSON.stringify(prepare(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8')))));
}
