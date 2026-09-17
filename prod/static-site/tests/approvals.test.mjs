import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ApprovalError, extractApprovedText, checkApprovals} from '../scripts/approvals.mjs';

// Only reads inside prod/static-site/: the pinned runner (verify-runner.mjs)
// copies an explicit public-source allowlist into an isolated workspace that
// does not include anything above the site package (e.g. docs/decisions/),
// so this file must not traverse out to the repo root at runtime.
const SITE_ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const APPROVALS_CLI = new URL('../scripts/approvals.mjs', import.meta.url).pathname;
const hex = bytes => createHash('sha256').update(bytes).digest('hex');

const HELLO_BODY = fs.readFileSync(path.join(SITE_ROOT, 'content/minimal-launch/hello-world.md'));
const HELLO = Object.freeze({
  slug: 'hello-world',
  title: '博客上线了',
  body_sha256: '3d5d83c9eec8bfd2a7f2911b9dde7b036696e714c79348825860e17c34b77b42',
  approval: 'docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim',
});
assert.equal(hex(HELLO_BODY), HELLO.body_sha256, 'fixture hello-world.md must match the frozen body_sha256');

const SECOND_BODY = Buffer.from('第二篇的正文，用于测试批准核对。\n', 'utf8');
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

function makeDoc({slug, title, bodyBytes, includeTitle = true, includeSlug = true, slugMarkup = 'code'}) {
  const bodyText = bodyBytes.toString('utf8').replace(/\n$/, '');
  const slugRef = slugMarkup === 'bold' ? `**${slug}**` : `\`${slug}\``;
  const bullets = (includeSlug ? `- Slug: ${slugRef}\n` : '') + (includeTitle ? `- Title: \`${title}\`\n` : '');
  return `# ${title} doc\n\n## Authority and status\n\nOwner approved the following verbatim text.\n\n## Approved public text (verbatim)\n\n${bullets}\nIntro:\n\n\`\`\`text\nshort synthetic intro\n\`\`\`\n\nArticle body:\n\n\`\`\`markdown\n${bodyText}\n\`\`\`\n\n## Architecture\n\nMore prose after the approved section.\n`;
}
const SECOND_DOC = makeDoc({slug: 'second-post', title: '第二篇文章', bodyBytes: SECOND_BODY});
// Built from the real hello-world.md bytes (which include interior "## "
// subheadings), not read from docs/decisions/ - see the SITE_ROOT note above.
const HELLO_DOC = makeDoc({slug: HELLO.slug, title: HELLO.title, bodyBytes: HELLO_BODY});

const BASE_BODY_LINES = ['First paragraph.', '', '## 小节', '', 'Second paragraph.'];
function baseDoc({includeHeading = true, includeHeadingTwice = false, includeTextBlock = true, markdownBlockCount = 1} = {}) {
  const heading = '## Approved public text (verbatim)\n';
  let doc = '# Doc title\n\n## Authority and status\n\nOwner approved the following text.\n\n';
  if (includeHeading) doc += heading + '\n';
  if (includeHeadingTwice) doc += heading + '\n';
  doc += '- Slug: `demo-slug`\n- Title: `Demo title`\n\n';
  if (includeTextBlock) doc += 'Intro:\n\n```text\nshort intro\n```\n\n';
  for (let i = 0; i < markdownBlockCount; i++) doc += 'Article body:\n\n```markdown\n' + BASE_BODY_LINES.join('\n') + '\n```\n\n';
  doc += '## Architecture\n\nMore text.\n';
  return doc;
}

function setupSite(t, registry, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approvalsite-'));
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
function twoArticleSite(t) {
  return setupSite(t, {version: 1, articles: [HELLO, secondArticle()]}, {
    'hello-world.md': HELLO_BODY,
    'second-post.md': SECOND_BODY,
  });
}
function approvalRootWith(t, secondDoc) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approvalroot-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'docs/decisions'), {recursive: true});
  fs.writeFileSync(path.join(root, 'docs/decisions/2026-09-14-minimal-static-launch-approval.md'), HELLO_DOC);
  if (secondDoc !== null) fs.writeFileSync(path.join(root, 'docs/decisions/2026-09-15-second-post-approval.md'), secondDoc);
  return root;
}
function goodApprovalRoot(t) { return approvalRootWith(t, SECOND_DOC); }
function writeJSON(dir, name, value) {
  const target = path.join(dir, name);
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  return target;
}
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

// ---- extractApprovedText ----

test('extractApprovedText: real-shaped doc keeps an interior "## " subheading in body and excludes both fenced blocks from prose', () => {
  const {body, prose} = extractApprovedText(baseDoc());
  assert.equal(body, BASE_BODY_LINES.join('\n') + '\n');
  assert.match(body, /^## 小节$/m);
  assert.doesNotMatch(body, /Architecture/);
  assert.match(prose, /Intro:/);
  assert.doesNotMatch(prose, /short intro/);
  assert.doesNotMatch(prose, /First paragraph\./);
});

test('extractApprovedText: the real hello-world body (with several interior "## " subheadings) round-trips exactly', () => {
  const {body, prose} = extractApprovedText(HELLO_DOC);
  assert.equal(body, HELLO_BODY.toString('utf8'));
  assert.equal((body.match(/^## /gm) || []).length > 1, true, 'fixture must exercise more than one interior subheading');
  assert.match(prose, /`博客上线了`/);
  assert.match(prose, /`hello-world`/);
});

test('extractApprovedText: approval_section_invalid when there is no approval heading', () => {
  assert.throws(() => extractApprovedText(baseDoc({includeHeading: false})),
    err => err instanceof ApprovalError && err.reason === 'approval_section_invalid');
});
test('extractApprovedText: approval_section_invalid when the heading appears twice', () => {
  assert.throws(() => extractApprovedText(baseDoc({includeHeadingTwice: true})),
    err => err instanceof ApprovalError && err.reason === 'approval_section_invalid');
});
test('extractApprovedText: approval_body_missing when there is no markdown-language block', () => {
  assert.throws(() => extractApprovedText(baseDoc({markdownBlockCount: 0})),
    err => err instanceof ApprovalError && err.reason === 'approval_body_missing');
});
test('extractApprovedText: approval_body_ambiguous when there are two markdown-language blocks', () => {
  assert.throws(() => extractApprovedText(baseDoc({markdownBlockCount: 2})),
    err => err instanceof ApprovalError && err.reason === 'approval_body_ambiguous');
});
test('extractApprovedText: approval_section_invalid when a code block is never closed', () => {
  assert.throws(() => extractApprovedText('## Approved public text (verbatim)\n\n```markdown\nsome text\n'),
    err => err instanceof ApprovalError && err.reason === 'approval_section_invalid');
});
test('extractApprovedText: approval_section_invalid when the document contains \\r', () => {
  assert.throws(() => extractApprovedText('line one\r\nline two\n'),
    err => err instanceof ApprovalError && err.reason === 'approval_section_invalid');
});

// ---- checkApprovals ----

test('checkApprovals: two articles with matching approval files returns {articles: 2}', t => {
  assert.deepEqual(checkApprovals({siteRoot: twoArticleSite(t), approvalRoot: goodApprovalRoot(t)}), {articles: 2});
});

test('checkApprovals: a RegistryError from loadRegistry surfaces as the same-reason ApprovalError', t => {
  const site = setupSite(t, {version: 1, articles: []}, {});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot: goodApprovalRoot(t)}),
    err => err instanceof ApprovalError && err.reason === 'registry_invalid');
});

test('checkApprovals: approval_title_missing when prose lacks the title code span', t => {
  const site = twoArticleSite(t);
  const doc = makeDoc({slug: 'second-post', title: '第二篇文章', bodyBytes: SECOND_BODY, includeTitle: false});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot: approvalRootWith(t, doc)}),
    err => err instanceof ApprovalError && err.reason === 'approval_title_missing' && err.slug === 'second-post');
});

test('checkApprovals: approval_slug_missing when prose lacks slug code span or bold form', t => {
  const site = twoArticleSite(t);
  const doc = makeDoc({slug: 'second-post', title: '第二篇文章', bodyBytes: SECOND_BODY, includeSlug: false});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot: approvalRootWith(t, doc)}),
    err => err instanceof ApprovalError && err.reason === 'approval_slug_missing' && err.slug === 'second-post');
});

test('checkApprovals: bold slug markup **slug** is accepted', t => {
  const site = twoArticleSite(t);
  const doc = makeDoc({slug: 'second-post', title: '第二篇文章', bodyBytes: SECOND_BODY, slugMarkup: 'bold'});
  assert.deepEqual(checkApprovals({siteRoot: site, approvalRoot: approvalRootWith(t, doc)}), {articles: 2});
});

test('checkApprovals: approval_hash_mismatch when the approved text differs from the registered file', t => {
  const site = twoArticleSite(t);
  const doc = makeDoc({slug: 'second-post', title: '第二篇文章', bodyBytes: Buffer.from('不同的正文内容，与登记不符。\n', 'utf8')});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot: approvalRootWith(t, doc)}),
    err => err instanceof ApprovalError && err.reason === 'approval_hash_mismatch' && err.slug === 'second-post');
});

test('checkApprovals: approval_file_missing when the approval file does not exist', t => {
  const site = twoArticleSite(t);
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot: approvalRootWith(t, null)}),
    err => err instanceof ApprovalError && err.reason === 'approval_file_missing' && err.slug === 'second-post');
});

test('checkApprovals: approval_file_missing when the approval path is a symlink', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const target = path.join(approvalRoot, 'docs/decisions/2026-09-15-second-post-approval.md');
  fs.rmSync(target);
  fs.symlinkSync(path.join(approvalRoot, 'docs/decisions/2026-09-14-minimal-static-launch-approval.md'), target);
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot}),
    err => err instanceof ApprovalError && err.reason === 'approval_file_missing' && err.slug === 'second-post');
});

// ---- checkApprovals previous (append-only) ----

test('checkApprovals previous: identical registry passes', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-full.json', {version: 1, articles: [HELLO, secondArticle()]});
  assert.deepEqual(checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}), {articles: 2});
});

test('checkApprovals previous: prefix containing only the first article passes', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-first.json', {version: 1, articles: [HELLO]});
  assert.deepEqual(checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}), {articles: 2});
});

test('checkApprovals previous: an article absent from current throws registry_not_append_only', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const extra = secondArticle({slug: 'third-post', approval: 'docs/decisions/2026-09-16-third-post.md#approved-public-text-verbatim'});
  const prev = writeJSON(dir, 'prev-extra.json', {version: 1, articles: [HELLO, secondArticle(), extra]});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}),
    err => err instanceof ApprovalError && err.reason === 'registry_not_append_only' && err.slug === 'third-post');
});

test('checkApprovals previous: swapped order throws registry_not_append_only', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-swapped.json', {version: 1, articles: [secondArticle(), HELLO]});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}),
    err => err instanceof ApprovalError && err.reason === 'registry_not_append_only' && err.slug === 'second-post');
});

test('checkApprovals previous: a differing title throws registry_not_append_only', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-title.json', {version: 1, articles: [HELLO, secondArticle({title: '改过的标题'})]});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}),
    err => err instanceof ApprovalError && err.reason === 'registry_not_append_only' && err.slug === 'second-post');
});

test('checkApprovals previous: a symlinked previous file throws previous_registry_invalid', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const real = writeJSON(dir, 'prev-real.json', {version: 1, articles: [HELLO]});
  const link = path.join(dir, 'prev-link.json');
  fs.symlinkSync(real, link);
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [link]}),
    err => err instanceof ApprovalError && err.reason === 'previous_registry_invalid');
});

test('checkApprovals previous: corrupted JSON throws previous_registry_invalid', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-bad.json', '{not valid json');
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}),
    err => err instanceof ApprovalError && err.reason === 'previous_registry_invalid');
});

test('checkApprovals previous: an unexpected top-level key throws previous_registry_invalid', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prev = writeJSON(dir, 'prev-extra-key.json', {version: 1, articles: [HELLO], note: 'x'});
  assert.throws(() => checkApprovals({siteRoot: site, approvalRoot, previous: [prev]}),
    err => err instanceof ApprovalError && err.reason === 'previous_registry_invalid');
});

// ---- CLI ----

function runCli(args) {
  return spawnSync(process.execPath, [APPROVALS_CLI, ...args], {encoding: 'utf8', timeout: 20000});
}

test('CLI: success prints the ok line and exits 0', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const r = runCli(['check', '--site', site, '--root', approvalRoot]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '{"approvals":"ok","articles":2}\n');
});

test('CLI: failure prints the failed line with reason and exits 1', t => {
  const site = twoArticleSite(t);
  const approvalRoot = approvalRootWith(t, null);
  const r = runCli(['check', '--site', site, '--root', approvalRoot]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '{"approvals":"failed","slug":"second-post","reason":"approval_file_missing"}\n');
});

test('CLI: two --previous flags with valid prefixes exits 0', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const dir = tempDir(t);
  const prevA = writeJSON(dir, 'a.json', {version: 1, articles: [HELLO]});
  const prevB = writeJSON(dir, 'b.json', {version: 1, articles: [HELLO, secondArticle()]});
  const r = runCli(['check', '--site', site, '--root', approvalRoot, '--previous', prevA, '--previous', prevB]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '{"approvals":"ok","articles":2}\n');
});

test('CLI: argument problems exit 2 with empty stdout', t => {
  const site = twoArticleSite(t);
  const approvalRoot = goodApprovalRoot(t);
  const cases = [
    ['check', '--site', 'relative-site', '--root', approvalRoot],
    ['check', '--site', site],
    ['check', '--site', site, '--root', approvalRoot, 'extra'],
    ['check', '--site', path.join(site, 'does-not-exist'), '--root', approvalRoot],
    ['check', '--site', site, '--root', approvalRoot, '--previous'],
    ['check', '--site', site, '--root', approvalRoot, '--previous', 'relative-previous.json'],
  ];
  for (const args of cases) {
    const r = runCli(args);
    assert.equal(r.status, 2, `args=${JSON.stringify(args)} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(r.stdout, '', `args=${JSON.stringify(args)}`);
  }
});
