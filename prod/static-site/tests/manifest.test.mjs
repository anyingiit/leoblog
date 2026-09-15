import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { contentTypeForAsset, writeManifest } from "../src/lib/manifest.mjs";

test("manifest asset MIME policy covers accepted emitted extensions", () => {
  assert.equal(contentTypeForAsset("/_astro/app.js"), "text/javascript; charset=utf-8");
  assert.equal(contentTypeForAsset("/_astro/app.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeForAsset("/index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeForAsset("/private/secret.txt"), null);
});

test("manifest covers exact public routes and hashes every emitted file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-manifest-")); fs.mkdirSync(`${dir}/_astro`, { recursive: true }); fs.writeFileSync(`${dir}/index.html`, "home"); fs.writeFileSync(`${dir}/_astro/comments.js`, "client");
  const manifest = writeManifest(dir, ["/", "/posts/hello"]);
  assert.deepEqual(manifest.routes, ["/", "/_astro/comments.js", "/posts/hello"]);
  assert.equal(manifest.files.length, 2);
  const js = manifest.files.find((file) => file.path.endsWith("comments.js"));
  assert.equal(js.sha256, crypto.createHash("sha256").update("client").digest("hex"));
  fs.writeFileSync(`${dir}/_astro/comments.js`, "tampered");
  assert.notEqual(js.sha256, crypto.createHash("sha256").update(fs.readFileSync(`${dir}/_astro/comments.js`)).digest("hex"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("manifest excludes control files, sourcemaps, private files, and symlinked/outside entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-manifest-filter-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-manifest-outside-"));
  fs.mkdirSync(`${dir}/_astro`, { recursive: true });
  fs.mkdirSync(`${dir}/private`, { recursive: true });
  fs.writeFileSync(`${dir}/index.html`, "home");
  fs.writeFileSync(`${dir}/_astro/app.js`, "console.log('actual emitted asset')");
  fs.writeFileSync(`${dir}/_astro/app.js.map`, "source map");
  fs.writeFileSync(`${dir}/raw-public.json`, "raw");
  fs.writeFileSync(`${dir}/private/secret.txt`, "secret");
  fs.writeFileSync(`${outside}/outside.js`, "outside");
  fs.symlinkSync(`${outside}/outside.js`, `${dir}/_astro/outside.js`);
  const manifest = writeManifest(dir, ["/"]);
  assert.deepEqual(manifest.files.map((file) => file.path), ["/_astro/app.js", "/index.html"]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test("manifest serialization is deterministic and excludes the manifest itself", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leoblog-manifest-repeat-"));
  fs.writeFileSync(`${dir}/index.html`, "home");
  const first = writeManifest(dir, ["/", "/"]);
  const firstBytes = fs.readFileSync(`${dir}/manifest.json`);
  const second = writeManifest(dir, ["/"]);
  assert.deepEqual(second, first);
  assert.deepEqual(fs.readFileSync(`${dir}/manifest.json`), firstBytes);
  assert.equal(second.files.some((file) => file.path === "/manifest.json"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
