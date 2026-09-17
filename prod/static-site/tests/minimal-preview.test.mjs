import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {createPreview} from '../scripts/serve-minimal.mjs';
import {markdownToHtml} from '../src/lib/content.mjs';
test('real preview GET HEAD useful 404 method and malformed-target isolation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'minimal-http-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'posts/hello-world'),{recursive:true});
  fs.mkdirSync(path.join(root,'posts/second-post'),{recursive:true});
  const escaped=markdownToHtml('<script>alert(1)</script>');
  const home='<h1>Leoblog</h1><a href="/posts/hello-world">博客上线了</a>';
  const article='<h1>博客上线了</h1>'+escaped;
  const secondPost='<h1>第二篇文章</h1><p>second post body</p>';
  const missing='<h1>页面未找到</h1><a href="/">返回首页</a>';
  const sitemap='<?xml version="1.0"?><urlset/>';
  const robots='User-agent: *\n';
  const manifest=JSON.stringify({version:1,routes:['/','/posts/hello-world','/posts/second-post'],files:[]});
  for (const [name,body] of [['index.html',home],['posts/hello-world/index.html',article],
    ['posts/second-post/index.html',secondPost],['404.html',missing],['sitemap.xml',sitemap],
    ['robots.txt',robots],['manifest.json',manifest]])
    fs.writeFileSync(path.join(root,name),body);
  const server=createPreview(root);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
  const port=server.address().port;
  const request=(target,method='GET')=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:target,method,agent:false},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });req.setTimeout(2000,()=>req.destroy(new Error('preview request timeout')));
    req.on('error',reject);req.end();
  });
  for (const [target,status,body] of [['/',200,home],['/posts/hello-world',200,article],
    ['/posts/hello-world/',200,article],['/posts/second-post',200,secondPost],
    ['/posts/second-post/',200,secondPost],['/404.html',404,missing],['/not-present',404,missing],
    ['/timeline',404,missing],['/sessions',404,missing],['/archive',404,missing],
    ['/api/comments',404,missing],['/manifest.json',404,missing],['/%3Cscript%3E',404,missing]]) {
    const get=await request(target);assert.equal(get.status,status);assert.equal(get.body,body);
    assert.equal(get.headers['content-type'],'text/html; charset=utf-8');
    assert.equal(Number(get.headers['content-length']),Buffer.byteLength(body));
    const head=await request(target,'HEAD');assert.equal(head.status,status);assert.equal(head.body,'');
    assert.equal(head.headers['content-length'],get.headers['content-length']);
  }
  for (const [target,body,type] of [['/sitemap.xml',sitemap,'application/xml; charset=utf-8'],['/robots.txt',robots,'text/plain; charset=utf-8']]) {
    const get=await request(target);assert.equal(get.status,200);assert.equal(get.body,body);assert.equal(get.headers['content-type'],type);
    const head=await request(target,'HEAD');assert.equal(head.status,200);assert.equal(head.body,'');assert.equal(head.headers['content-type'],type);
  }
  for (const method of ['POST','PUT','DELETE']) assert.equal((await request('/',method)).status,405);
  for (const target of ['/%ZZ','//evil.example/','http://evil.example/'])
    assert.equal((await request(target)).status,400);
  assert.equal((await request('/')).body,home,'malformed requests do not stop listener');
  assert.ok(article.includes('&lt;script&gt;'));assert.equal(article.includes('<script>'),false);
});
test('createPreview rejects a missing malformed or out-of-contract manifest.json',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'minimal-http-invalid-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const rejected=err=>err instanceof Error && err.message==='preview_manifest_invalid';
  const manifestPath=path.join(root,'manifest.json');
  assert.throws(()=>createPreview(root),rejected,'missing manifest.json');
  fs.writeFileSync(manifestPath,'{not valid json');
  assert.throws(()=>createPreview(root),rejected,'manifest.json is not valid JSON');
  fs.writeFileSync(manifestPath,JSON.stringify({version:1,routes:['/posts/hello-world'],files:[]}));
  assert.throws(()=>createPreview(root),rejected,'routes missing /');
  fs.writeFileSync(manifestPath,JSON.stringify({version:1,routes:['/','/timeline'],files:[]}));
  assert.throws(()=>createPreview(root),rejected,'routes containing /timeline');
  fs.writeFileSync(manifestPath,JSON.stringify({version:1,routes:['/','/posts/../x'],files:[]}));
  assert.throws(()=>createPreview(root),rejected,'routes containing /posts/../x');
  fs.writeFileSync(manifestPath,JSON.stringify({version:1,routes:['/','/posts/hello-world','/posts/hello-world'],files:[]}));
  assert.throws(()=>createPreview(root),rejected,'duplicate routes');
});
