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
  const escaped=markdownToHtml('<script>alert(1)</script>');
  const home='<h1>Leoblog</h1><a href="/posts/hello-world">博客上线了</a>';
  const article='<h1>博客上线了</h1>'+escaped;
  const missing='<h1>页面未找到</h1><a href="/">返回首页</a>';
  for (const [name,body] of [['index.html',home],['posts/hello-world/index.html',article],['404.html',missing]])
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
    ['/posts/hello-world/',200,article],['/404.html',404,missing],['/not-present',404,missing],
    ['/timeline',404,missing],['/sessions',404,missing],['/archive',404,missing],
    ['/api/comments',404,missing],['/%3Cscript%3E',404,missing]]) {
    const get=await request(target);assert.equal(get.status,status);assert.equal(get.body,body);
    assert.equal(get.headers['content-type'],'text/html; charset=utf-8');
    assert.equal(Number(get.headers['content-length']),Buffer.byteLength(body));
    const head=await request(target,'HEAD');assert.equal(head.status,status);assert.equal(head.body,'');
    assert.equal(head.headers['content-length'],get.headers['content-length']);
  }
  for (const method of ['POST','PUT','DELETE']) assert.equal((await request('/',method)).status,405);
  for (const target of ['/%ZZ','//evil.example/','http://evil.example/'])
    assert.equal((await request(target)).status,400);
  assert.equal((await request('/')).body,home,'malformed requests do not stop listener');
  assert.ok(article.includes('&lt;script&gt;'));assert.equal(article.includes('<script>'),false);
});
