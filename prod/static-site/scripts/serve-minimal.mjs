import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const ROUTE_PATTERN=/^\/posts\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
function readManifestRoutes(root) {
  const manifestPath=path.join(root,'manifest.json');
  let stat;
  try {stat=fs.statSync(manifestPath);} catch {throw new Error('preview_manifest_invalid');}
  if (!stat.isFile() || stat.size>1048576) throw new Error('preview_manifest_invalid');
  let manifest;
  try {manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));} catch {throw new Error('preview_manifest_invalid');}
  if (manifest===null || typeof manifest!=='object' || Array.isArray(manifest)) throw new Error('preview_manifest_invalid');
  const routes=manifest.routes;
  if (!Array.isArray(routes) || routes.length>33 || !routes.every(r=>typeof r==='string')) throw new Error('preview_manifest_invalid');
  if (!routes.includes('/') || new Set(routes).size!==routes.length) throw new Error('preview_manifest_invalid');
  if (!routes.every(r=>r==='/'||ROUTE_PATTERN.test(r))) throw new Error('preview_manifest_invalid');
  return routes;
}
export function createPreview(root) {
  root=path.resolve(root);
  const routes=readManifestRoutes(root);
  const files=new Map([['/404.html','404.html'],['/sitemap.xml','sitemap.xml'],['/robots.txt','robots.txt']]);
  for (const r of routes) {
    if (r==='/') {files.set('/','index.html');continue;}
    const target=r.slice(1)+'/index.html';
    files.set(r,target);files.set(r+'/',target);
  }
  const server=http.createServer((req,res)=>{
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
    let pathname;try {
      if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('invalid target');
      pathname=new URL(req.url,'http://localhost').pathname;
      decodeURIComponent(pathname); // reject malformed percent encoding; never use decoded text as a file path
    }catch {res.writeHead(400);res.end();return;}
    const found=files.get(pathname);const bytes=fs.readFileSync(path.join(root,found||'404.html'));
    const contentType=pathname==='/sitemap.xml'?'application/xml; charset=utf-8':pathname==='/robots.txt'?'text/plain; charset=utf-8':'text/html; charset=utf-8';
    res.writeHead(found&&pathname!=='/404.html'?200:404,{'Content-Type':contentType,'Content-Length':bytes.length});
    res.end(req.method==='HEAD'?undefined:bytes);
  });
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  createPreview(process.argv[2]).listen(4173,'0.0.0.0');
}
