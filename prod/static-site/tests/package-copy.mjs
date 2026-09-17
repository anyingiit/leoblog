// Shared helpers for tests that need a private, writable copy of this Astro
// package: freezing synthetic article sets and building them without ever
// touching the real content/minimal-launch/ registry or any other package
// file. Used by minimal-launch.test.mjs (single-article equivalence) and
// minimal-multi.test.mjs (multi-article rendering).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

// Registered articles in these tests reuse the one real, already-approved
// reference: article-registry.mjs only checks the approval string's shape
// (docs/reference/article-registry.md), not that the referenced document
// exists or names this particular slug, so synthetic fixtures do not need
// throwaway approval documents on disk.
const FIXED_APPROVAL = 'docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim';

// Recursively copies `root` (a package directory, typically the sandboxed
// workspace a pinned test runner already restricted to the public allowlist)
// into `dest`, excluding node_modules, then relinks node_modules by realpath
// so the copy shares the already-installed dependency tree without a second
// npm install. `dest` may already exist (e.g. from fs.mkdtempSync).
export function copyPackage(root, dest) {
  const source = fs.realpathSync(root);
  fs.mkdirSync(dest, {recursive: true});
  fs.cpSync(source, dest, {recursive: true, filter: (entry) => path.basename(entry) !== 'node_modules'});
  fs.symlinkSync(fs.realpathSync(path.join(source, 'node_modules')), path.join(dest, 'node_modules'), 'dir');
  return dest;
}

// Rewrites `dest/content/minimal-launch/` to hold exactly the given articles:
// deletes every existing entry except articles.json, writes each article's
// body file, and rewrites articles.json to register them in the given order.
// `articles` is [{slug, title, body}]; body may be a string or Buffer (the
// real hello-world.md bytes should be passed through unchanged so its
// registered body_sha256 keeps matching article-registry.mjs's frozen
// HELLO_WORLD constant).
export function writeArticles(dest, articles) {
  const contentDir = path.join(dest, 'content', 'minimal-launch');
  for (const name of fs.readdirSync(contentDir)) {
    if (name === 'articles.json') continue;
    fs.rmSync(path.join(contentDir, name));
  }
  const registry = {version: 1, articles: []};
  for (const {slug, title, body} of articles) {
    fs.writeFileSync(path.join(contentDir, `${slug}.md`), body);
    registry.articles.push({slug, title, body_sha256: crypto.createHash('sha256').update(body).digest('hex'), approval: FIXED_APPROVAL});
  }
  fs.writeFileSync(path.join(contentDir, 'articles.json'), `${JSON.stringify(registry, null, 2)}\n`);
}

// Synchronous subprocess helper: runs cmd/args to completion and throws
// (with stdout/stderr attached, and folded into the message) on a non-zero
// exit or a launch failure, so callers can just call run() for the expected
// happy path and assert.throws(() => run(...)) for expected failures.
export function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {encoding: 'utf8', timeout: 120000, ...opts});
  if (result.error) throw new Error(`command failed to start: ${cmd} ${args.join(' ')}\n${result.error.message}`);
  if (result.status !== 0) {
    const error = new Error(`command exited ${result.status}: ${cmd} ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    error.stdout = result.stdout;
    error.stderr = result.stderr;
    error.status = result.status;
    throw error;
  }
  return result;
}
