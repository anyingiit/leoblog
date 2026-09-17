// Loads and validates prod/static-site/content/minimal-launch/articles.json
// against docs/contracts/article-registry.md (sections 1.1, 1.2). See that
// contract for the authoritative rules; this module implements them exactly.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const REGISTRY_PATH = 'content/minimal-launch/articles.json';
export const CONTENT_DIR = 'content/minimal-launch';
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const APPROVAL_PATTERN = /^docs\/decisions\/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md#approved-public-text-verbatim$/;
export const MAX_ARTICLES = 32;
export const MAX_BODY_BYTES = 32768;

const HEX64 = /^[0-9a-f]{64}$/;
// The 7 kinds referenced by the contract: the control-character class, plus
// these 6 literal punctuation characters.
const FORBIDDEN_TITLE_CHARS = /[<>&"'`]/;

// The registry's first entry must always equal this exact record (002/FR-006).
const HELLO_WORLD = Object.freeze({
  slug: 'hello-world',
  title: '博客上线了',
  body_sha256: '3d5d83c9eec8bfd2a7f2911b9dde7b036696e714c79348825860e17c34b77b42',
  approval: 'docs/decisions/2026-09-14-minimal-static-launch-approval.md#approved-public-text-verbatim',
});

export class RegistryError extends Error {
  constructor(reason, slug = null) {
    super(slug ? `${reason}:${slug}` : reason);
    this.reason = reason;
    this.slug = slug;
  }
}

export function isValidTitle(title) {
  if (typeof title !== 'string') return false;
  const chars = [...title];
  if (chars.length < 1 || chars.length > 80) return false;
  for (const ch of chars) {
    const codePoint = ch.codePointAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f) return false;
    if (FORBIDDEN_TITLE_CHARS.test(ch)) return false;
  }
  if (/\s/.test(chars[0]) || /\s/.test(chars[chars.length - 1])) return false;
  return true;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  return expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

export function loadRegistry(siteRoot) {
  const registryPath = path.join(siteRoot, REGISTRY_PATH);
  const contentDir = path.join(siteRoot, CONTENT_DIR);

  // --- 1. Registry file and its fields (registry_invalid) ---
  let registryStat;
  try {
    registryStat = fs.lstatSync(registryPath);
  } catch {
    throw new RegistryError('registry_invalid');
  }
  if (!registryStat.isFile()) throw new RegistryError('registry_invalid');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    throw new RegistryError('registry_invalid');
  }
  if (!isPlainObject(data) || !hasExactKeys(data, ['version', 'articles'])) throw new RegistryError('registry_invalid');
  if (data.version !== 1) throw new RegistryError('registry_invalid');
  if (!Array.isArray(data.articles) || data.articles.length < 1 || data.articles.length > MAX_ARTICLES) {
    throw new RegistryError('registry_invalid');
  }

  const seenSlugs = new Set();
  const meta = [];
  for (const item of data.articles) {
    if (!isPlainObject(item) || !hasExactKeys(item, ['slug', 'title', 'body_sha256', 'approval'])) {
      throw new RegistryError('registry_invalid');
    }
    const {slug, title, body_sha256: bodySha256, approval} = item;
    const diagnosticSlug = typeof slug === 'string' ? slug : null;
    if (typeof slug !== 'string' || slug.length < 1 || slug.length > 64 || !SLUG_PATTERN.test(slug)) {
      throw new RegistryError('registry_invalid', diagnosticSlug);
    }
    if (seenSlugs.has(slug)) throw new RegistryError('registry_invalid', slug);
    seenSlugs.add(slug);
    if (!isValidTitle(title)) throw new RegistryError('registry_invalid', slug);
    if (typeof bodySha256 !== 'string' || !HEX64.test(bodySha256)) throw new RegistryError('registry_invalid', slug);
    if (typeof approval !== 'string' || !APPROVAL_PATTERN.test(approval)) throw new RegistryError('registry_invalid', slug);
    meta.push({slug, title, body_sha256: bodySha256, approval});
  }

  const first = meta[0];
  if (
    first.slug !== HELLO_WORLD.slug ||
    first.title !== HELLO_WORLD.title ||
    first.body_sha256 !== HELLO_WORLD.body_sha256 ||
    first.approval !== HELLO_WORLD.approval
  ) {
    throw new RegistryError('registry_invalid', first.slug);
  }

  // --- 2. Body files, in registry order (body_file_invalid, then body_hash_mismatch) ---
  const result = [];
  for (const article of meta) {
    const bodyPath = path.join(contentDir, `${article.slug}.md`);
    let bodyStat;
    try {
      bodyStat = fs.lstatSync(bodyPath);
    } catch {
      throw new RegistryError('body_file_invalid', article.slug);
    }
    if (!bodyStat.isFile()) throw new RegistryError('body_file_invalid', article.slug);

    let bytes;
    try {
      bytes = fs.readFileSync(bodyPath);
    } catch {
      throw new RegistryError('body_file_invalid', article.slug);
    }
    if (bytes.length === 0 || bytes.length > MAX_BODY_BYTES) throw new RegistryError('body_file_invalid', article.slug);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new RegistryError('body_file_invalid', article.slug);
    if (bytes.includes(0x0d) || bytes.includes(0x00)) throw new RegistryError('body_file_invalid', article.slug);
    const lastByte = bytes[bytes.length - 1];
    const secondLastByte = bytes.length >= 2 ? bytes[bytes.length - 2] : null;
    if (lastByte !== 0x0a || secondLastByte === 0x0a) throw new RegistryError('body_file_invalid', article.slug);

    let text;
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch {
      throw new RegistryError('body_file_invalid', article.slug);
    }

    if (sha256Hex(bytes) !== article.body_sha256) throw new RegistryError('body_hash_mismatch', article.slug);

    result.push({slug: article.slug, title: article.title, body: text, body_sha256: article.body_sha256, approval: article.approval});
  }

  // --- 3. Content directory entries (content_dir_unexpected_entry) ---
  let entries;
  try {
    entries = fs.readdirSync(contentDir, {withFileTypes: true});
  } catch {
    throw new RegistryError('content_dir_unexpected_entry');
  }
  const expected = new Set(['articles.json', ...meta.map(article => `${article.slug}.md`)]);
  const actual = new Set();
  for (const entry of entries) {
    if (entry.isDirectory()) throw new RegistryError('content_dir_unexpected_entry');
    actual.add(entry.name);
  }
  if (actual.size !== expected.size) throw new RegistryError('content_dir_unexpected_entry');
  for (const name of expected) if (!actual.has(name)) throw new RegistryError('content_dir_unexpected_entry');

  return result;
}
