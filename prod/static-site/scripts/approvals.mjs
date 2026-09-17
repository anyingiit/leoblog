#!/usr/bin/env node
// Extracts and cross-checks owner approval records against the article
// registry. See docs/contracts/article-registry.md sections 2 and 3 for the
// authoritative rules; this module and its CLI implement them exactly.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRegistry, RegistryError, sha256Hex} from './article-registry.mjs';

export class ApprovalError extends Error {
  constructor(reason, slug = null) {
    super(slug ? `${reason}:${slug}` : reason);
    this.reason = reason;
    this.slug = slug;
  }
}

const HEADING = '## Approved public text (verbatim)';
const FENCE_OPEN = /^```([A-Za-z0-9]*)$/;
const SECTION_END = /^#{1,2} /;

export function extractApprovedText(markdown) {
  if (markdown.includes('\r')) throw new ApprovalError('approval_section_invalid');
  const lines = markdown.split('\n');

  // Single pass: classify every line as a fence-open, fence-close, block
  // content, or a line fully outside any code block.
  const kind = new Array(lines.length);
  const lang = new Array(lines.length).fill(null);
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const match = FENCE_OPEN.exec(line);
      if (match) {
        kind[i] = 'open';
        lang[i] = match[1];
        inBlock = true;
      } else {
        kind[i] = 'outside';
      }
    } else if (line === '```') {
      kind[i] = 'close';
      inBlock = false;
    } else {
      kind[i] = 'content';
    }
  }
  if (inBlock) throw new ApprovalError('approval_section_invalid');

  const headingIndexes = [];
  for (let i = 0; i < lines.length; i++) if (kind[i] === 'outside' && lines[i] === HEADING) headingIndexes.push(i);
  if (headingIndexes.length !== 1) throw new ApprovalError('approval_section_invalid');

  const start = headingIndexes[0] + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (kind[i] === 'outside' && SECTION_END.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Pair up fences globally; a block that opens before `end` always closes
  // before `end` too, because no line while inBlock is ever 'outside'.
  const blockPairs = [];
  let openIndex = -1;
  let openLang = null;
  for (let i = 0; i < lines.length; i++) {
    if (kind[i] === 'open') {
      openIndex = i;
      openLang = lang[i];
    } else if (kind[i] === 'close') {
      blockPairs.push({open: openIndex, close: i, lang: openLang});
      openIndex = -1;
      openLang = null;
    }
  }

  const markdownBlocks = blockPairs.filter(block => block.open >= start && block.close < end && block.lang === 'markdown');
  if (markdownBlocks.length === 0) throw new ApprovalError('approval_body_missing');
  if (markdownBlocks.length > 1) throw new ApprovalError('approval_body_ambiguous');
  const markdownBlock = markdownBlocks[0];
  const body = lines.slice(markdownBlock.open + 1, markdownBlock.close).join('\n') + '\n';

  const proseLines = [];
  for (let i = start; i < end; i++) if (kind[i] === 'outside') proseLines.push(lines[i]);
  return {body, prose: proseLines.join('\n')};
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  return expected.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function checkPreviousRegistry(previousPath, currentArticles) {
  let stat;
  try {
    stat = fs.lstatSync(previousPath);
  } catch {
    throw new ApprovalError('previous_registry_invalid');
  }
  if (!stat.isFile() || stat.size > 65536) throw new ApprovalError('previous_registry_invalid');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
  } catch {
    throw new ApprovalError('previous_registry_invalid');
  }
  if (!isPlainObject(data) || !hasExactKeys(data, ['version', 'articles']) || data.version !== 1 || !Array.isArray(data.articles)) {
    throw new ApprovalError('previous_registry_invalid');
  }
  for (const item of data.articles) {
    if (!isPlainObject(item) || !hasExactKeys(item, ['slug', 'title', 'body_sha256', 'approval'])) {
      throw new ApprovalError('previous_registry_invalid');
    }
    for (const key of ['slug', 'title', 'body_sha256', 'approval']) {
      if (typeof item[key] !== 'string') throw new ApprovalError('previous_registry_invalid');
    }
  }

  for (let i = 0; i < data.articles.length; i++) {
    const previous = data.articles[i];
    const current = currentArticles[i];
    if (
      !current ||
      previous.slug !== current.slug ||
      previous.title !== current.title ||
      previous.body_sha256 !== current.body_sha256 ||
      previous.approval !== current.approval
    ) {
      throw new ApprovalError('registry_not_append_only', previous.slug);
    }
  }
}

function checkArticleApproval(article, approvalRoot, approvalRootReal) {
  const hashPos = article.approval.indexOf('#');
  const relativePath = article.approval.slice(0, hashPos);
  const approvalFile = path.join(approvalRoot, relativePath);

  let stat;
  try {
    stat = fs.lstatSync(approvalFile);
  } catch {
    throw new ApprovalError('approval_file_missing', article.slug);
  }
  if (!stat.isFile()) throw new ApprovalError('approval_file_missing', article.slug);

  let real;
  try {
    real = fs.realpathSync(approvalFile);
  } catch {
    throw new ApprovalError('approval_file_missing', article.slug);
  }
  if (real !== approvalRootReal && !real.startsWith(approvalRootReal + path.sep)) {
    throw new ApprovalError('approval_file_missing', article.slug);
  }
  if (stat.size > 1024 * 1024) throw new ApprovalError('approval_file_missing', article.slug);

  let bytes;
  try {
    bytes = fs.readFileSync(approvalFile);
  } catch {
    throw new ApprovalError('approval_file_missing', article.slug);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new ApprovalError('approval_file_missing', article.slug);
  }

  let extracted;
  try {
    extracted = extractApprovedText(text);
  } catch (err) {
    if (err instanceof ApprovalError) throw new ApprovalError(err.reason, article.slug);
    throw err;
  }
  const {body, prose} = extracted;

  if (!prose.includes('`' + article.title + '`')) throw new ApprovalError('approval_title_missing', article.slug);
  if (!prose.includes('`' + article.slug + '`') && !prose.includes('**' + article.slug + '**')) {
    throw new ApprovalError('approval_slug_missing', article.slug);
  }
  if (sha256Hex(Buffer.from(body, 'utf8')) !== article.body_sha256) {
    throw new ApprovalError('approval_hash_mismatch', article.slug);
  }
}

export function checkApprovals({siteRoot, approvalRoot, previous = []}) {
  let articles;
  try {
    articles = loadRegistry(siteRoot);
  } catch (err) {
    if (err instanceof RegistryError) throw new ApprovalError(err.reason, err.slug);
    throw err;
  }

  for (const previousPath of previous) checkPreviousRegistry(previousPath, articles);

  const approvalRootReal = fs.realpathSync(approvalRoot);
  for (const article of articles) checkArticleApproval(article, approvalRoot, approvalRootReal);

  return {articles: articles.length};
}

const USAGE = 'usage: node approvals.mjs check --site <abs dir> --root <abs dir> [--previous <abs file>]...\n';

function parseArgs(argv) {
  if (argv.length < 5) return null;
  if (argv[0] !== 'check' || argv[1] !== '--site' || argv[3] !== '--root') return null;
  const site = argv[2];
  const root = argv[4];
  const previous = [];
  let i = 5;
  while (i < argv.length) {
    if (argv[i] !== '--previous' || i + 1 >= argv.length) return null;
    previous.push(argv[i + 1]);
    i += 2;
  }
  if (!path.isAbsolute(site) || !path.isAbsolute(root)) return null;
  for (const previousPath of previous) if (!path.isAbsolute(previousPath)) return null;

  let siteStat;
  let rootStat;
  try {
    siteStat = fs.statSync(site);
  } catch {
    return null;
  }
  try {
    rootStat = fs.statSync(root);
  } catch {
    return null;
  }
  if (!siteStat.isDirectory() || !rootStat.isDirectory()) return null;
  return {site, root, previous};
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  try {
    const {articles} = checkApprovals({siteRoot: parsed.site, approvalRoot: parsed.root, previous: parsed.previous});
    process.stdout.write(JSON.stringify({approvals: 'ok', articles}) + '\n');
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof ApprovalError) {
      process.stdout.write(JSON.stringify({approvals: 'failed', slug: err.slug, reason: err.reason}) + '\n');
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
