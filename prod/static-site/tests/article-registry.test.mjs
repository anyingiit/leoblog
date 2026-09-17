import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadRegistry, RegistryError, isValidTitle, sha256Hex, REGISTRY_PATH, CONTENT_DIR, SLUG_PATTERN, APPROVAL_PATTERN, MAX_ARTICLES, MAX_BODY_BYTES} from '../scripts/article-registry.mjs';

const SITE_ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const HELLO_BODY = fs.readFileSync(path.join(SITE_ROOT, 'content/minimal-launch/hello-world.md'));
const HELLO = Object.freeze({
  slug: 'hello-world',
  title: '博客上线了',
  body_sha256: '3d5d83c9eec8bfd2a7f2911b9dde7b036696e714c79348825860e17c34b77b42',
  approval: 'docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim',
});
const hex = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hex(HELLO_BODY), HELLO.body_sha256, 'fixture hello-world.md must match the frozen body_sha256');

const SECOND_BODY = Buffer.from('第二篇的正文，用于测试文章登记加载器。\n', 'utf8');
const SECOND_APPROVAL = 'docs/decisions/2026-09-15-second-post-approval.md#approved-public-text-verbatim';
function secondArticle(overrides = {}) {
  return {
    slug: 'second-post',
    title: '第二篇文章',
    body_sha256: hex(SECOND_BODY),
    approval: SECOND_APPROVAL,
    ...overrides,
  };
}

// Builds a throwaway site root with content/minimal-launch/articles.json plus
// whatever files (or 'DIR' sentinels for subdirectories) are listed in `files`.
function setupSite(t, registry, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'artreg-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const contentDir = path.join(root, 'content', 'minimal-launch');
  fs.mkdirSync(contentDir, {recursive: true});
  const registryText = typeof registry === 'string' ? registry : JSON.stringify(registry) + '\n';
  fs.writeFileSync(path.join(contentDir, 'articles.json'), registryText);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(contentDir, name);
    if (content === 'DIR') fs.mkdirSync(target);
    else fs.writeFileSync(target, content);
  }
  return root;
}

function assertReason(t, registry, files, reason, slug) {
  const root = setupSite(t, registry, files);
  assert.throws(() => loadRegistry(root), err => {
    assert.ok(err instanceof RegistryError, `expected RegistryError, got ${err}`);
    assert.equal(err.reason, reason);
    if (slug !== undefined) assert.equal(err.slug, slug);
    return true;
  });
}

test('exported constants match the frozen contract', () => {
  assert.equal(REGISTRY_PATH, 'content/minimal-launch/articles.json');
  assert.equal(CONTENT_DIR, 'content/minimal-launch');
  assert.equal(MAX_ARTICLES, 32);
  assert.equal(MAX_BODY_BYTES, 32768);
  assert.ok(SLUG_PATTERN.test('hello-world'));
  assert.ok(!SLUG_PATTERN.test('Hello-World'));
  assert.ok(APPROVAL_PATTERN.test(HELLO.approval));
  assert.ok(!APPROVAL_PATTERN.test('docs/decisions/2026-09-14-x.md#wrong-anchor'));
});

test('sha256Hex hashes bytes as lowercase hex', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), createHash('sha256').update('abc').digest('hex'));
});

test('isValidTitle enforces length, control/punctuation exclusion and no leading/trailing whitespace', () => {
  assert.equal(isValidTitle('博客上线了'), true);
  assert.equal(isValidTitle('Hello World'), true); // interior space allowed
  assert.equal(isValidTitle(''), false);
  assert.equal(isValidTitle('a'.repeat(80)), true);
  assert.equal(isValidTitle('a'.repeat(81)), false);
  assert.equal(isValidTitle(' leading'), false);
  assert.equal(isValidTitle('trailing '), false);
  assert.equal(isValidTitle('has<tag>'), false);
  assert.equal(isValidTitle('has&amp'), false);
  assert.equal(isValidTitle('has"quote'), false);
  assert.equal(isValidTitle("has'quote"), false);
  assert.equal(isValidTitle('has`tick'), false);
  assert.equal(isValidTitle('has\ttab'), false);
  assert.equal(isValidTitle(123), false);
});

test('real registry loads hello-world first with matching bytes; count is not hard-coded', () => {
  const result = loadRegistry(SITE_ROOT);
  assert.equal(result[0].slug, HELLO.slug);
  assert.equal(result[0].title, HELLO.title);
  assert.equal(result[0].body_sha256, HELLO.body_sha256);
  assert.equal(result[0].approval, HELLO.approval);
  assert.equal(Buffer.from(result[0].body, 'utf8').equals(HELLO_BODY), true);
  const registryJson = JSON.parse(fs.readFileSync(path.join(SITE_ROOT, REGISTRY_PATH), 'utf8'));
  assert.equal(result.length, registryJson.articles.length);
});

test('a legitimate second article loads after hello-world, order preserved', t => {
  const root = setupSite(t, {version: 1, articles: [HELLO, secondArticle()]}, {
    'hello-world.md': HELLO_BODY,
    'second-post.md': SECOND_BODY,
  });
  const result = loadRegistry(root);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(a => a.slug), ['hello-world', 'second-post']);
  assert.equal(result[1].body, SECOND_BODY.toString('utf8'));
  assert.equal(result[1].title, '第二篇文章');
});

test('registry_invalid: malformed JSON', t => assertReason(t, '{not valid json', {}, 'registry_invalid'));
test('registry_invalid: unexpected top-level key', t =>
  assertReason(t, {version: 1, articles: [HELLO], extra: true}, {}, 'registry_invalid'));
test('registry_invalid: wrong version', t =>
  assertReason(t, {version: 2, articles: [HELLO]}, {}, 'registry_invalid'));
test('registry_invalid: empty articles array', t =>
  assertReason(t, {version: 1, articles: []}, {}, 'registry_invalid'));
test('registry_invalid: 33 articles exceeds the cap', t =>
  assertReason(t, {version: 1, articles: new Array(33).fill(HELLO)}, {}, 'registry_invalid'));

test('registry_invalid: slug with uppercase letters', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({slug: 'Second-Post'})]}, {}, 'registry_invalid', 'Second-Post'));
test('registry_invalid: slug containing ".."', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({slug: 'second..post'})]}, {}, 'registry_invalid', 'second..post'));
test('registry_invalid: duplicate slug', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({slug: 'hello-world'})]}, {}, 'registry_invalid', 'hello-world'));

test('registry_invalid: title contains "<"', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({title: 'Bad <title>'})]}, {}, 'registry_invalid', 'second-post'));
test('registry_invalid: title has leading whitespace', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({title: ' leading'})]}, {}, 'registry_invalid', 'second-post'));
test('registry_invalid: title is empty', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({title: ''})]}, {}, 'registry_invalid', 'second-post'));

test('registry_invalid: body_sha256 not 64 lowercase hex', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: 'F'.repeat(64)})]}, {}, 'registry_invalid', 'second-post'));
test('registry_invalid: approval does not match the required pattern', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({approval: 'docs/decisions/2026-09-15-x.md#wrong'})]}, {}, 'registry_invalid', 'second-post'));

test('registry_invalid: first item is not hello-world', t =>
  assertReason(t, {version: 1, articles: [secondArticle()]}, {}, 'registry_invalid', 'second-post'));

test('body_file_invalid: body file missing', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle()]}, {'hello-world.md': HELLO_BODY}, 'body_file_invalid', 'second-post'));

test('body_file_invalid: body file is a symlink', t => {
  const root = setupSite(t, {version: 1, articles: [HELLO, secondArticle()]}, {
    'hello-world.md': HELLO_BODY,
    'second-post.md': SECOND_BODY,
  });
  const target = path.join(root, 'content/minimal-launch/second-post.md');
  fs.rmSync(target);
  fs.symlinkSync(path.join(root, 'content/minimal-launch/hello-world.md'), target);
  assert.throws(() => loadRegistry(root), err => err instanceof RegistryError && err.reason === 'body_file_invalid' && err.slug === 'second-post');
});

test('body_file_invalid: body contains \\r\\n', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(Buffer.from('a\r\nb\n'))})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': Buffer.from('a\r\nb\n')}, 'body_file_invalid', 'second-post'));

test('body_file_invalid: body has a UTF-8 BOM', t => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), SECOND_BODY]);
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_file_invalid: body ends with two newlines', t => {
  const body = Buffer.from('two trailing newlines\n\n');
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_file_invalid: body has no trailing newline', t => {
  const body = Buffer.from('no trailing newline');
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_file_invalid: body exceeds 32768 bytes', t => {
  const body = Buffer.alloc(MAX_BODY_BYTES + 1, 0x61);
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_file_invalid: body is empty', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(Buffer.alloc(0))})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': Buffer.alloc(0)}, 'body_file_invalid', 'second-post'));

test('body_file_invalid: body contains a NUL byte', t => {
  const body = Buffer.from('has\x00nul\n');
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_file_invalid: body is not valid UTF-8', t => {
  const body = Buffer.from([0xff, 0xfe, 0x0a]);
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: hex(body)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': body}, 'body_file_invalid', 'second-post');
});

test('body_hash_mismatch: declared hash does not match file bytes', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle({body_sha256: 'f'.repeat(64)})]},
    {'hello-world.md': HELLO_BODY, 'second-post.md': SECOND_BODY}, 'body_hash_mismatch', 'second-post'));

test('content_dir_unexpected_entry: extra file in content directory', t =>
  assertReason(t, {version: 1, articles: [HELLO]}, {'hello-world.md': HELLO_BODY, 'stray.txt': 'noise'}, 'content_dir_unexpected_entry'));

test('content_dir_unexpected_entry: subdirectory in content directory', t =>
  assertReason(t, {version: 1, articles: [HELLO]}, {'hello-world.md': HELLO_BODY, 'stray-dir': 'DIR'}, 'content_dir_unexpected_entry'));

test('content_dir_unexpected_entry: registered file present but not on disk still reports body_file_invalid first (T107 dependency)', t =>
  assertReason(t, {version: 1, articles: [HELLO, secondArticle()]}, {'hello-world.md': HELLO_BODY}, 'body_file_invalid', 'second-post'));
