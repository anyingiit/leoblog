import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadSnapshot, snapshotToSite, markdownToHtml } from "../src/lib/content.mjs";

const fixture = {
  version: 1,
  git_sha: "private-git-sha-must-not-ship",
  posts: [{ slug: "hello", title: "Hello", summary: "Summary", tags: ["one"], published_at: "2026-01-01", body: "# Safe\n\n<script>alert(1)</script>" }],
  timeline: { events: [{ title: "Launch", status: "done", desc: "Public" }] },
  media: [{ object_key: "media/immutable/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", content_type: "image/png", size: 3, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  approved: [
    { kind: "session", id: "s1", data: { title: "Reviewed session", summary: "redacted" } },
    { kind: "archive", id: "a1", data: { slug: "a1", title: "Reviewed archive", body: "redacted" } },
  ],
};

test("accepts the Laravel public snapshot whitelist and strips private provenance", () => {
  const site = snapshotToSite(fixture);
  assert.equal(site.posts[0].slug, "hello");
  assert.equal("git_sha" in site, false);
  assert.equal("git_sha" in site.posts[0], false);
});

test("rejects malformed, draft, and unknown snapshot fields", () => {
  assert.throws(() => loadSnapshot(JSON.stringify({ ...fixture, private: "leak" })), /unknown/i);
  assert.throws(() => loadSnapshot(JSON.stringify({ ...fixture, posts: [{ ...fixture.posts[0], status: "draft" }] })), /unknown/i);
  assert.throws(() => loadSnapshot(JSON.stringify({ ...fixture, approved: [{ kind: "session", id: "s1", data: { email: "secret" } }] })), /private/i);
});

test("rejects a tampered snapshot when the Laravel content hash is supplied", () => {
  const raw = JSON.stringify(fixture);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  assert.doesNotThrow(() => loadSnapshot(raw, hash));
  assert.throws(() => loadSnapshot(raw + " ", hash), /hash mismatch/);
});

test("fixture follows the actual Laravel public_json top-level schema", () => {
  const site = loadSnapshot("tests/fixtures/public-snapshot.json");
  assert.deepEqual(Object.keys(site).sort(), ["approved", "git_sha", "media", "posts", "timeline", "version"]);
  assert.deepEqual(Object.keys(site.posts[0]).sort(), ["body", "published_at", "slug", "summary", "tags", "title"] .sort().concat([]));
  assert.equal(site.approved[0].kind, "session");
  assert.equal(site.approved[1].kind, "archive");
});

test("renders markdown headings at their declared levels and escapes markup", () => {
  assert.equal(markdownToHtml("# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six"), "<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>\n<h4>Four</h4>\n<h5>Five</h5>\n<h6>Six</h6>");
  assert.equal(markdownToHtml("<script>alert(1)</script> & \"quoted\""), "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;</p>");
});
