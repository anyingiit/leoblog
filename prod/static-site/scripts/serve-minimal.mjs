import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
export function createPreview(root) {
root=path.resolve(root);
const files=new Map([['/','index.html'],['/posts/hello-world','posts/hello-world/index.html'],
  ['/posts/hello-world/','posts/hello-world/index.html'],['/404.html','404.html']]);
const server=http.createServer((req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  let pathname;try {
    if (!req.url.startsWith('/') || req.url.startsWith('//')) throw new Error('invalid target');
    pathname=new URL(req.url,'http://localhost').pathname;
    decodeURIComponent(pathname); // reject malformed percent encoding; never use decoded text as a file path
  }catch {res.writeHead(400);res.end();return;}
  const found=files.get(pathname);const bytes=fs.readFileSync(path.join(root,found||'404.html'));
  res.writeHead(found&&pathname!=='/404.html'?200:404,{'Content-Type':'text/html; charset=utf-8','Content-Length':bytes.length});
  res.end(req.method==='HEAD'?undefined:bytes);
});
return server;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  createPreview(process.argv[2]).listen(4173,'0.0.0.0');
}
