import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadPublicationIdentity} from '../src/lib/identity.mjs';
import {loadRegistry, RegistryError} from './article-registry.mjs';
export const INTRO = '记录学习、实践与思考。先写下来，再慢慢完善。';
const packageRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
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
function loadRegistryOrFail(siteRoot) {
  try {
    return loadRegistry(siteRoot);
  } catch (err) {
    if (err instanceof RegistryError) throw new Error(`minimal_input_invalid:${err.reason}`);
    throw err;
  }
}
function snapshot(source, utc, articles) {
  return {version:1, git_sha:source.git_sha,
    posts: articles.map(a => ({slug:a.slug,title:a.title,summary:'',tags:[],published_at:utc,body:a.body,sha:hash(a.body)})),
    timeline:{events:[]}, media:[], approved:[]};
}
function manifest(source, utc, contentSha, articles) {
  return {version:2, provenance:'owner-static',
    articles: articles.map(a => ({slug:a.slug,approval_reference:a.approval,body_sha256:a.body_sha256})),
    content_sha:contentSha, ...source, build_utc:utc};
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
export function validateMinimal(dir, {siteRoot = packageRoot} = {}) {
  const identity=loadPublicationIdentity(dir);
  if (fs.readdirSync(dir).sort().join(',')!=='manifest.json,public.json,publication-identity.json') fail();
  for (const name of fs.readdirSync(dir)) if (!fs.lstatSync(path.join(dir,name)).isFile()) fail();
  const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  if (m.version!==2) fail();
  const s={git_sha:m.git_sha,dirty_sha256:m.dirty_sha256}; sourceValid(s);
  if (typeof m.build_utc!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.build_utc) ||
      new Date(m.build_utc).toISOString()!==m.build_utc) fail();
  const articles=loadRegistryOrFail(siteRoot);
  const expected=canonical(snapshot(s,m.build_utc,articles));
  if (fs.readFileSync(path.join(dir,'public.json'),'utf8')!==expected ||
      fs.readFileSync(path.join(dir,'manifest.json'),'utf8')!==canonical(manifest(s,m.build_utc,hash(expected),articles))) fail();
  return identity;
}
export function prepare(namespace, source, {siteRoot = packageRoot} = {}) {
  sourceValid(source); trustedDirectory(namespace);
  const articles=loadRegistryOrFail(siteRoot);
  const utc=new Date().toISOString();
  const publicBytes=canonical(snapshot(source,utc,articles));
  if (Buffer.byteLength(publicBytes)>65536) throw new Error('minimal_input_too_large');
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
  const manifestBytes=canonical(manifest(source,utc,hash(publicBytes),articles));
  write(path.join(pending,'public.json'),publicBytes); write(path.join(pending,'manifest.json'),manifestBytes);
  write(path.join(pending,'publication-identity.json'),canonical({version:1,generation,
    content_sha:hash(publicBytes),approval_manifest_hash:hash(manifestBytes)}));
  syncDir(pending); fs.renameSync(pending,path.join(release,'input')); syncDir(release);
  validateMinimal(path.join(release,'input'),{siteRoot}); fs.rmdirSync(lock); syncDir(namespace);
  return {input:path.join(release,'input'),generation,build_utc:utc};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.length!==4) fail();
  console.log(JSON.stringify(prepare(process.argv[2],JSON.parse(fs.readFileSync(process.argv[3],'utf8')))));
}
