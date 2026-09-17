// Data-layer coverage for the frozen input v2 format (docs/contracts/frozen-input-v2.md
// section 1). Unlike minimal-launch.test.mjs, this file only imports Node builtins and
// this package's scripts/ and src/lib/, so it runs directly on the host (no Astro).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepare, validateMinimal, hash, canonical} from '../scripts/prepare-minimal-launch.mjs';
import {loadRegistry, sha256Hex} from '../scripts/article-registry.mjs';

const packageRoot = path.resolve(new URL('..', import.meta.url).pathname);
const source = {git_sha: 'b'.repeat(40), dirty_sha256: 'c'.repeat(64)}; // tests only

// macOS resolves os.tmpdir() through a symlink (/var -> /private/var). prepare()'s
// trustedDirectory() walks every path component with lstat and rejects a symlinked
// one, so every temp dir this file hands to prepare()/validateMinimal() is realpath
// resolved first.
function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function namespace(t) {
  const p = tempDir('minimal-content-ns-');
  t.after(() => fs.rmSync(p, {recursive: true, force: true}));
  return p;
}

// Builds a throwaway site root with content/minimal-launch/articles.json plus the
// given body files: just enough of the real package layout for loadRegistry() to
// accept it as a siteRoot.
function siteRootWith(t, articles, files) {
  const root = tempDir('minimal-content-site-');
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const contentDir = path.join(root, 'content', 'minimal-launch');
  fs.mkdirSync(contentDir, {recursive: true});
  fs.writeFileSync(path.join(contentDir, 'articles.json'), JSON.stringify({version: 1, articles}) + '\n');
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(contentDir, name), bytes);
  return root;
}

const HELLO_BODY = fs.readFileSync(path.join(packageRoot, 'content/minimal-launch/hello-world.md'));
// The registry's frozen first entry (002/FR-006). Duplicated here rather than
// imported since article-registry.mjs keeps its HELLO_WORLD constant private.
const HELLO = Object.freeze({
  slug: 'hello-world',
  title: '博客上线了',
  body_sha256: sha256Hex(HELLO_BODY),
  approval: 'docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim',
});

function syntheticArticle(slug, title, bodyBytes) {
  return {
    slug,
    title,
    body_sha256: sha256Hex(bodyBytes),
    approval: `docs/decisions/2026-09-16-${slug}-approval.md#approved-public-text-verbatim`,
  };
}

test('real registry: manifest v2 shape, articles mapping, post fields, public.json size cap', t => {
  const ns = namespace(t);
  const a = prepare(ns, source);
  const registry = loadRegistry(packageRoot);
  const manifestJson = JSON.parse(fs.readFileSync(path.join(a.input, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifestJson).sort(),
    ['articles', 'build_utc', 'content_sha', 'dirty_sha256', 'git_sha', 'provenance', 'version']);
  assert.equal(manifestJson.version, 2);
  assert.deepEqual(manifestJson.articles,
    registry.map(r => ({slug: r.slug, approval_reference: r.approval, body_sha256: r.body_sha256})));
  const publicRaw = fs.readFileSync(path.join(a.input, 'public.json'), 'utf8');
  assert.ok(Buffer.byteLength(publicRaw) <= 65536, `public.json is ${Buffer.byteLength(publicRaw)} bytes`);
  const publicJson = JSON.parse(publicRaw);
  assert.equal(publicJson.posts.length, registry.length);
  for (const post of publicJson.posts) {
    assert.equal(post.published_at, manifestJson.build_utc);
    assert.equal(post.sha, hash(post.body));
  }
});

test('a manifest.json tampered into the old v1 shape is rejected as minimal_input_invalid', t => {
  const ns = namespace(t);
  const a = prepare(ns, source);
  const m2 = JSON.parse(fs.readFileSync(path.join(a.input, 'manifest.json'), 'utf8'));
  const v1Shape = {
    version: 1,
    provenance: m2.provenance,
    approval_reference: m2.articles[0].approval_reference,
    body_sha256: m2.articles[0].body_sha256,
    content_sha: m2.content_sha,
    git_sha: m2.git_sha,
    dirty_sha256: m2.dirty_sha256,
    build_utc: m2.build_utc,
  };
  const v1Bytes = canonical(v1Shape);
  fs.writeFileSync(path.join(a.input, 'manifest.json'), v1Bytes);
  // publication-identity.json's hash must still match the tampered manifest.json,
  // or loadPublicationIdentity() fails first with an unrelated "hashes do not
  // match" error instead of the minimal_input_invalid this test is after.
  const identityPath = path.join(a.input, 'publication-identity.json');
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  identity.approval_manifest_hash = hash(v1Bytes);
  fs.writeFileSync(identityPath, canonical(identity));
  assert.throws(() => validateMinimal(a.input), err => err.message.startsWith('minimal_input_invalid'));
});

test('a temporary site root with a second article: prepare follows registry order, validateMinimal needs the matching siteRoot', t => {
  const secondBody = Buffer.from('第二篇的正文，用于冻结输入 v2 测试。\n', 'utf8');
  const second = syntheticArticle('second-post', 'Second Post', secondBody);
  const siteRoot = siteRootWith(t, [HELLO, second], {
    'hello-world.md': HELLO_BODY,
    'second-post.md': secondBody,
  });
  const ns = namespace(t);
  const a = prepare(ns, source, {siteRoot});
  const publicJson = JSON.parse(fs.readFileSync(path.join(a.input, 'public.json'), 'utf8'));
  assert.equal(publicJson.posts.length, 2);
  assert.deepEqual(publicJson.posts.map(p => p.slug), ['hello-world', 'second-post']);
  validateMinimal(a.input, {siteRoot}); // must not throw
  assert.throws(() => validateMinimal(a.input)); // defaults to the real (single-article) registry
});

test('combined bodies over 65536 bytes make prepare fail closed before touching the namespace', t => {
  const bigBody = char => Buffer.from(char.repeat(29999) + '\n', 'utf8');
  const bodies = {one: bigBody('x'), two: bigBody('y'), three: bigBody('z')};
  const articles = [
    HELLO,
    syntheticArticle('synthetic-one', 'Synthetic One', bodies.one),
    syntheticArticle('synthetic-two', 'Synthetic Two', bodies.two),
    syntheticArticle('synthetic-three', 'Synthetic Three', bodies.three),
  ];
  const siteRoot = siteRootWith(t, articles, {
    'hello-world.md': HELLO_BODY,
    'synthetic-one.md': bodies.one,
    'synthetic-two.md': bodies.two,
    'synthetic-three.md': bodies.three,
  });
  const ns = namespace(t);
  assert.throws(() => prepare(ns, source, {siteRoot}), err => err.message === 'minimal_input_too_large');
  assert.deepEqual(fs.readdirSync(ns), []);
});

test('a body file that does not hash to its registry entry is rejected as minimal_input_invalid:body_hash_mismatch', t => {
  const declared = Buffer.from('登记声明的正文。\n', 'utf8');
  const onDisk = Buffer.from('磁盘上实际的正文，和登记的哈希不一致。\n', 'utf8');
  const second = syntheticArticle('second-post', 'Second Post', declared);
  const siteRoot = siteRootWith(t, [HELLO, second], {
    'hello-world.md': HELLO_BODY,
    'second-post.md': onDisk,
  });
  const ns = namespace(t);
  assert.throws(() => prepare(ns, source, {siteRoot}), err => err.message === 'minimal_input_invalid:body_hash_mismatch');
});
