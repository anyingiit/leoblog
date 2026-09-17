// Multi-article rendering coverage for the frozen input v2 format (002/SC-005):
// proves that registering more than the one real hello-world article renders
// correctly, without ever touching the real content/minimal-launch/ registry.
// Every build here runs against a private copyPackage() copy so this file can
// freely freeze synthetic article sets (see tests/package-copy.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'parse5';
import {validateMinimal, INTRO} from '../scripts/prepare-minimal-launch.mjs';
import {copyPackage, writeArticles, run} from './package-copy.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const ORIGIN = 'https://douseful.eu.org';
const source = {git_sha: 'd'.repeat(40), dirty_sha256: 'e'.repeat(64)}; // tests only
const FORBIDDEN_TAGS = ['script', 'form', 'iframe', 'object', 'embed', 'base'];

function workspace(t) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'minimal-multi-'));
  t.after(() => fs.rmSync(p, {recursive: true, force: true}));
  return p;
}

function extractText(archive, entry) {
  return run('tar', ['-xOzf', archive, entry]).stdout;
}

function expectedSitemap(paths) {
  const sorted = [...paths].sort();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sorted.map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`).join('')}</urlset>\n`;
}

function realHelloWorldBody(dest) {
  return fs.readFileSync(path.join(dest, 'content/minimal-launch/hello-world.md'));
}

test('minimal profile renders a registered multi-article set with two byte-identical builds', (t) => {
  const work = workspace(t);
  const dest = path.join(work, 'copy');
  copyPackage(root, dest);
  const helloBody = realHelloWorldBody(dest);
  const secondBody = '第二篇测试文章的正文，用于验证脚本文本会被转义。\n\n<script>alert(1)</script>\n\n## 小节\n\n小节说明文字。\n';
  const thirdBody = '第三篇笔记的正文内容，仅用于测试多篇渲染。\n';
  const articles = [
    {slug: 'hello-world', title: '博客上线了', body: helloBody},
    {slug: 'second-post', title: '第二篇测试文章', body: secondBody},
    {slug: 'third-note', title: '第三篇笔记', body: thirdBody},
  ];
  writeArticles(dest, articles);

  const ns = path.join(work, 'ns');
  fs.mkdirSync(ns);
  const sourceFile = path.join(work, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  run(process.execPath, [path.join(dest, 'scripts/prepare-minimal-launch.mjs'), ns, sourceFile]);
  const input = path.join(ns, 'release-1', 'input');

  const firstArtifact = path.join(work, 'first.tar.gz');
  const secondArtifact = path.join(work, 'second.tar.gz');
  const buildEnv = {env: {...process.env, LEOBLOG_PROFILE: 'minimal'}};
  run(process.execPath, [path.join(dest, 'scripts/build.mjs'), input, firstArtifact], buildEnv);
  run(process.execPath, [path.join(dest, 'scripts/build.mjs'), input, secondArtifact], buildEnv);
  assert.deepEqual(fs.readFileSync(firstArtifact), fs.readFileSync(secondArtifact), 'two builds of the same frozen input must be byte-identical');

  const entries = run('tar', ['-tzf', firstArtifact]).stdout.trim().split('\n').map((p) => p.replace(/^\.\//, ''));
  assert.deepEqual(
    entries.slice().sort(),
    ['404.html', 'index.html', 'manifest.json', 'posts/hello-world/index.html', 'posts/second-post/index.html', 'posts/third-note/index.html', 'robots.txt', 'sitemap.xml'].sort(),
  );

  const {marker} = validateMinimal(input, {siteRoot: dest});
  const documents = {};
  for (const entry of entries.filter((p) => p.endsWith('.html'))) documents[entry] = extractText(firstArtifact, entry);

  for (const [name, html] of Object.entries(documents)) {
    assert.equal((html.match(/name="leoblog-version"/gi) || []).length, 1, `${name} must have exactly one marker meta tag`);
    assert.ok(html.includes(`name="leoblog-version" content="${marker}"`), `${name} marker must match validateMinimal()`);
  }

  const manifestJson = JSON.parse(extractText(firstArtifact, 'manifest.json'));
  assert.deepEqual(manifestJson.routes, ['/', '/posts/hello-world', '/posts/second-post', '/posts/third-note']);

  const sitemap = extractText(firstArtifact, 'sitemap.xml');
  assert.equal(sitemap, expectedSitemap(['/', '/posts/hello-world', '/posts/second-post', '/posts/third-note']));

  // Homepage lists articles newest-first (reverse registration order), each exactly once.
  const home = documents['index.html'];
  let cursor = 0;
  for (const article of [...articles].reverse()) {
    const needle = `<a href="/posts/${article.slug}">${article.title}</a>`;
    assert.equal(home.split(needle).length - 1, 1, `${needle} must appear exactly once`);
    const idx = home.indexOf(needle, cursor);
    assert.ok(idx >= cursor, `expected ${needle} at or after position ${cursor} (newest-first order)`);
    cursor = idx + needle.length;
  }
  assert.ok(home.includes(INTRO));

  for (const article of articles) {
    const page = documents[`posts/${article.slug}/index.html`];
    assert.equal((page.match(/rel="canonical"/g) || []).length, 1);
    assert.ok(page.includes(`href="${ORIGIN}/posts/${article.slug}"`));
    assert.ok(page.includes(`<h1>${article.title}</h1>`));
  }

  const secondPage = documents['posts/second-post/index.html'];
  assert.ok(secondPage.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  for (const forbidden of ['<script', '<form', '<iframe']) assert.equal(secondPage.includes(forbidden), false);

  for (const [name, html] of Object.entries(documents)) {
    const visit = (node) => {
      if (node.tagName) assert.equal(FORBIDDEN_TAGS.includes(node.tagName), false, `${name} must not contain <${node.tagName}>`);
      for (const child of node.childNodes || []) visit(child);
    };
    visit(parse(html));
  }
});

test('minimal freeze rejects a registered article with no body file (body_file_invalid)', (t) => {
  const work = workspace(t);
  const dest = path.join(work, 'copy');
  copyPackage(root, dest);
  const helloBody = realHelloWorldBody(dest);
  writeArticles(dest, [
    {slug: 'hello-world', title: '博客上线了', body: helloBody},
    {slug: 'second-post', title: '第二篇测试文章', body: '第二篇的正文，用于负例测试。\n'},
  ]);
  fs.rmSync(path.join(dest, 'content/minimal-launch/second-post.md'));

  const ns = path.join(work, 'ns');
  fs.mkdirSync(ns);
  const sourceFile = path.join(work, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  assert.throws(
    () => run(process.execPath, [path.join(dest, 'scripts/prepare-minimal-launch.mjs'), ns, sourceFile]),
    (err) => typeof err.stderr === 'string' && err.stderr.includes('minimal_input_invalid:body_file_invalid'),
  );
});

test('minimal freeze rejects a body file with no registry entry (content_dir_unexpected_entry)', (t) => {
  const work = workspace(t);
  const dest = path.join(work, 'copy');
  copyPackage(root, dest);
  const helloBody = realHelloWorldBody(dest);
  writeArticles(dest, [{slug: 'hello-world', title: '博客上线了', body: helloBody}]);
  fs.writeFileSync(path.join(dest, 'content/minimal-launch/stray-extra.md'), '多余的正文文件，没有登记。\n');

  const ns = path.join(work, 'ns');
  fs.mkdirSync(ns);
  const sourceFile = path.join(work, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  assert.throws(
    () => run(process.execPath, [path.join(dest, 'scripts/prepare-minimal-launch.mjs'), ns, sourceFile]),
    (err) => typeof err.stderr === 'string' && err.stderr.includes('content_dir_unexpected_entry'),
  );
});

test('minimal freeze rejects a body file whose bytes no longer match the registered hash (body_hash_mismatch)', (t) => {
  const work = workspace(t);
  const dest = path.join(work, 'copy');
  copyPackage(root, dest);
  const helloBody = realHelloWorldBody(dest);
  writeArticles(dest, [
    {slug: 'hello-world', title: '博客上线了', body: helloBody},
    {slug: 'second-post', title: '第二篇测试文章', body: '第二篇的正文，用于负例测试。\n'},
  ]);
  fs.appendFileSync(path.join(dest, 'content/minimal-launch/second-post.md'), '被篡改但未更新哈希的追加内容。\n');

  const ns = path.join(work, 'ns');
  fs.mkdirSync(ns);
  const sourceFile = path.join(work, 'source.json');
  fs.writeFileSync(sourceFile, JSON.stringify(source));
  assert.throws(
    () => run(process.execPath, [path.join(dest, 'scripts/prepare-minimal-launch.mjs'), ns, sourceFile]),
    (err) => typeof err.stderr === 'string' && err.stderr.includes('body_hash_mismatch'),
  );
});
